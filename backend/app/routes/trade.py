import logging
import secrets
import time
from decimal import Decimal
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine import Q
from app.models import Transaction, Holding, User, Lot, ShortPosition
from app.utils.market_hours import validate_order_timing, is_market_open, get_market_status_message, get_market_session, is_market_holiday
from app.utils.cache import cache as app_cache
# Import the centralized, cached function for all stock data lookups
from .stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logger = logging.getLogger(__name__)
trade_bp = Blueprint('trade', __name__)

# Maximum order constraints
MAX_ORDER_QUANTITY = 100000  # Maximum shares per order
MAX_ORDER_VALUE = 10000000  # Maximum order value in rupees (1 crore)

# --- Helper Functions ---

def _generate_idempotency_key():
    """Generate a unique idempotency key for order deduplication."""
    return secrets.token_urlsafe(32)


def _resolve_idempotency_key(data: dict | None) -> str:
    """Prefer a client-supplied idempotency key when available."""
    if isinstance(data, dict):
        provided_key = data.get('idempotency_key') or data.get('client_order_id')
        if provided_key:
            return str(provided_key)
    return _generate_idempotency_key()


def _validate_advanced_order_params(order_type: str, data: dict) -> tuple[bool, str]:
    """
    Validate parameters specific to advanced order types.
    
    Returns:
        tuple: (is_valid, error_message)
    """
    if order_type == 'STOP_LOSS':
        stop_loss_price = data.get('stop_loss_price')
        if not stop_loss_price or float(stop_loss_price) <= 0:
            return False, "Stop-loss price is required and must be positive"
    
    elif order_type == 'STOP_LIMIT':
        stop_loss_price = data.get('stop_loss_price')
        limit_price = data.get('price')
        if not stop_loss_price or float(stop_loss_price) <= 0:
            return False, "Trigger price is required for stop-limit orders"
        if not limit_price or float(limit_price) <= 0:
            return False, "Limit price is required for stop-limit orders"
    
    elif order_type == 'TRAILING_STOP':
        trailing_pct = data.get('trailing_stop_pct')
        if not trailing_pct or float(trailing_pct) <= 0 or float(trailing_pct) > 50:
            return False, "Trailing stop percentage must be between 0 and 50"
    
    elif order_type == 'BRACKET':
        stop_loss_price = data.get('stop_loss_price')
        target_price = data.get('target_price')
        if not stop_loss_price or float(stop_loss_price) <= 0:
            return False, "Stop-loss price is required for bracket orders"
        if not target_price or float(target_price) <= 0:
            return False, "Target price is required for bracket orders"
    
    return True, ""


def _create_lot_from_buy(user, symbol, quantity, price, transaction, product_type='CNC'):
    """Create a lot entry for FIFO tracking when buying shares."""
    lot = Lot(
        user=user,
        symbol=symbol,
        quantity=quantity,
        original_quantity=quantity,
        purchase_price=price,
        purchase_date=datetime.utcnow(),
        purchase_transaction=transaction,
        product_type=product_type,
        is_active=True
    )
    lot.save()
    logger.info(f"Created lot: {quantity} shares of {symbol} @{price} ({product_type})")
    return lot


def _match_lots_for_sell(user, symbol, sell_quantity, product_type='CNC'):
    """
    Match lots in FIFO order for a sell transaction.
    Returns list of (lot, matched_quantity) tuples and total cost basis.
    Validates lot-holding consistency.
    """
    lots_to_match = []
    remaining_qty = sell_quantity
    total_cost_basis = Decimal('0')
    
    # Get lots in FIFO order (oldest first)
    available_lots = Lot.objects(
        user=user,
        symbol=symbol,
        product_type=product_type,
        quantity__gt=0,
        is_active=True
    ).order_by('purchase_date')
    
    # Validate lot consistency with holdings - REJECT on inconsistency
    total_lot_qty = sum(lot.quantity for lot in available_lots)
    holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
    holding_qty = holding.quantity if holding else 0
    
    if total_lot_qty != holding_qty:
        logger.error(
            f"CRITICAL LOT CONSISTENCY ERROR: User {user.client_id} {symbol} {product_type} - "
            f"Lot total: {total_lot_qty}, Holding: {holding_qty}"
        )
        # REJECT transaction to prevent data corruption propagation
        raise ValueError(
            f"Data inconsistency detected. Lot total: {total_lot_qty}, "
            f"Holding: {holding_qty}. Transaction rejected. Please contact support."
        )
    
    for lot in available_lots:
        if remaining_qty <= 0:
            break
        
        qty_from_lot = min(remaining_qty, lot.quantity)
        lots_to_match.append((lot, qty_from_lot))
        
        cost_from_lot = Decimal(str(lot.purchase_price)) * Decimal(qty_from_lot)
        total_cost_basis += cost_from_lot
        
        remaining_qty -= qty_from_lot
    
    return lots_to_match, total_cost_basis, remaining_qty


def _update_lots_after_sell(lots_to_match):
    """Update lot quantities after a sell transaction."""
    for lot, qty_sold in lots_to_match:
        lot.quantity -= qty_sold
        if lot.quantity == 0:
            lot.is_active = False
        lot.save()
        logger.debug(f"Updated lot {lot.id}: sold {qty_sold}, remaining {lot.quantity}")


def _validate_and_process_trade_request(action: str, data: dict) -> tuple[dict, int]:
    """
    Centralized validation and price fetching for all trade orders.
    Supports advanced order types, product types, and market hours validation.
    """
    symbol_input = data.get('symbol')
    quantity_input = data.get('quantity')
    order_type = str(data.get('order_type', 'MARKET')).upper()
    product_type = str(data.get('product_type', 'CNC')).upper()

    # --- Step 1: Validate Basic Inputs ---
    if not symbol_input or not isinstance(quantity_input, int) or quantity_input <= 0:
        return {"success": False, "message": "A valid symbol and a positive integer quantity are required."}, 400
    
    # Validate maximum order size
    if quantity_input > MAX_ORDER_QUANTITY:
        return {"success": False, "message": f"Order quantity exceeds maximum limit of {MAX_ORDER_QUANTITY:,} shares."}, 400
    
    # Validate product type
    if product_type not in ['CNC', 'MIS']:
        return {"success": False, "message": "Invalid product type. Must be 'CNC' (delivery) or 'MIS' (intraday)."}, 400
    
    # Validate order type
    valid_order_types = ['MARKET', 'LIMIT', 'STOP_LOSS', 'STOP_LIMIT', 'BRACKET', 'TRAILING_STOP']
    if order_type not in valid_order_types:
        return {"success": False, "message": f"Invalid order type. Must be one of: {', '.join(valid_order_types)}."}, 400
    
    # Validate circuit breaker limits for limit/stop orders
    if order_type in ['LIMIT', 'STOP_LIMIT'] and data.get('price'):
        limit_price = float(data.get('price'))
        # Fetch current price first for validation
        api_data_preview = get_stock_data_from_api(symbol_input)
        if api_data_preview and api_data_preview.get('ltp', 0) > 0:
            current_price = float(api_data_preview['ltp'])
            price_deviation = abs((limit_price - current_price) / current_price) * 100
            
            # Apply 20% circuit limit (standard for most stocks)
            if price_deviation > 20:
                return {
                    "success": False,
                    "message": f"Order price ₹{limit_price:.2f} deviates {price_deviation:.1f}% from current price ₹{current_price:.2f}. Maximum allowed: 20% (circuit limit)."
                }, 400

    # Validate advanced order parameters
    is_valid, error_msg = _validate_advanced_order_params(order_type, data)
    if not is_valid:
        return {"success": False, "message": error_msg}, 400

    # --- Step 2: Market Hours Validation ---
    # Auto-convert MARKET orders to LIMIT during POST_MARKET session
    session = get_market_session()
    original_order_type = order_type
    was_auto_converted = False
    
    if session == 'POST_MARKET' and order_type == 'MARKET' and product_type == 'CNC':
        # Fetch current price to use as limit price
        api_data_preview = get_stock_data_from_api(symbol_input)
        if api_data_preview and api_data_preview.get('ltp', 0) > 0:
            order_type = 'LIMIT'
            data['price'] = str(api_data_preview['ltp'])
            was_auto_converted = True
            logger.info(f"Auto-converted MARKET order to LIMIT at ₹{data['price']} for AMO")
    
    is_timing_valid, timing_message = validate_order_timing(order_type, product_type)
    if not is_timing_valid:
        return {"success": False, "message": timing_message}, 400

    quantity = int(quantity_input)

    # --- Step 3: Fetch Live Data Using Centralized Cached Function ---
    api_data = get_stock_data_from_api(symbol_input)
    if not api_data:
        return {"success": False, "message": f"Instrument '{format_symbol(symbol_input)}' is not available for trading."}, 404

    # --- Step 4: Determine Execution Price ---
    current_ltp = Decimal(str(api_data.get('ltp', 0)))
    if current_ltp <= 0:
        return {"success": False, "message": f"Could not fetch a valid market price for '{format_symbol(symbol_input)}'. Trading may be halted."}, 502

    # Validate maximum order value
    estimated_value = current_ltp * Decimal(quantity)
    if estimated_value > Decimal(str(MAX_ORDER_VALUE)):
        return {"success": False, "message": f"Order value \u20b9{float(estimated_value):,.2f} exceeds maximum limit of \u20b9{MAX_ORDER_VALUE:,}."}, 400

    # For immediate execution orders (MARKET and qualifying LIMIT)
    execution_price = None
    status = "PENDING"  # Default for orders that need processing
    
    # Check if this is an AMO (After Market Order) - should always be pending
    is_amo = (session == 'POST_MARKET')
    
    if order_type == 'MARKET':
        # Market orders execute immediately at LTP (only during market hours)
        execution_price = current_ltp
        status = "PENDING" if is_amo else "EXECUTED"
    
    elif order_type == 'LIMIT':
        limit_price = Decimal(str(data.get('price', 0)))
        if limit_price <= 0:
            return {"success": False, "message": "A positive limit price is required for LIMIT orders."}, 400
        
        if is_amo:
            # AMO orders always go to pending, regardless of price
            execution_price = limit_price
            status = "PENDING"
        else:
            # Check if limit order can execute immediately (during market hours)
            if action == 'BUY' and current_ltp <= limit_price:
                execution_price = current_ltp  # Execute at market price (better than limit)
                status = "EXECUTED"
            elif action == 'SELL' and current_ltp >= limit_price:
                execution_price = current_ltp  # Execute at market price (better than limit)
                status = "EXECUTED"
            else:
                # Limit order goes to pending
                execution_price = limit_price
                status = "PENDING"
    
    elif order_type == 'STOP_LOSS':
        # Reserve funds based on the trigger price to avoid underfunded executions
        stop_trigger = data.get('stop_loss_price')
        if stop_trigger is None:
            return {"success": False, "message": "Stop-loss trigger price is required."}, 400
        execution_price = Decimal(str(stop_trigger))
        status = "PENDING"

    elif order_type == 'STOP_LIMIT':
        # Stop-limit always uses the provided limit price for reservation math
        execution_price = Decimal(str(data.get('price', current_ltp)))
        status = "PENDING"

    elif order_type == 'TRAILING_STOP':
        # Trailing stops trail the live market, so reserve at current price
        execution_price = current_ltp
        status = "PENDING"
    
    elif order_type == 'BRACKET':
        # Bracket orders: entry executes immediately during market hours, pending for AMO
        execution_price = current_ltp
        status = "PENDING" if is_amo else "EXECUTED"

    total_amount = execution_price * Decimal(quantity)

    if product_type == 'MIS' and status == 'PENDING':
        return {
            "success": False,
            "message": "Intraday (MIS) orders must execute immediately. Adjust the price or switch to CNC."
        }, 400

    # --- Step 5: Return Processed Trade Data ---
    return {
        "success": True,
        "data": {
            "symbol": f"{api_data['symbol']}.{api_data['exchange']}",
            "quantity": quantity,
            "execution_price": execution_price,
            "total_amount": total_amount,
            "order_type": order_type,
            "product_type": product_type,
            "status": status,
            "stop_loss_price": data.get('stop_loss_price'),
            "target_price": data.get('target_price'),
            "trailing_stop_pct": data.get('trailing_stop_pct'),
            "current_ltp": current_ltp,
            "was_auto_converted": was_auto_converted
        }
    }, 200


def _execute_buy_order(user, trade_data, idempotency_key):
    """Execute a buy order, optionally cover shorts, and report purchased quantity."""
    symbol = trade_data['symbol']
    execution_price = Decimal(str(trade_data['execution_price']))
    product_type = trade_data['product_type']
    remaining_quantity = int(trade_data['quantity'])
    total_cost = execution_price * Decimal(remaining_quantity)

    # CRITICAL FIX #3: Atomic balance check to prevent race condition
    # Use MongoDB's atomic update to check and deduct balance in one operation
    result = User.objects(
        id=user.id,
        balance__gte=float(total_cost)  # Atomic check: balance must be sufficient
    ).update_one(
        dec__balance=float(total_cost)  # Atomic decrement
    )
    
    if result == 0 or result is None:
        raise ValueError(f"Insufficient funds. Required: ₹{float(total_cost):.2f}. Please refresh and try again.")
    
    # Reload user to get updated balance
    user.reload()
    user_balance = Decimal(str(user.balance))
    shares_added = 0
    shares_covered = 0

    # Cover existing short positions first for MIS buys
    if product_type == 'MIS':
        short_position = ShortPosition.objects(
            user=user,
            symbol=symbol,
            is_active=True
        ).first()

        if short_position:
            qty_to_cover = min(remaining_quantity, short_position.quantity)
            if qty_to_cover > 0:
                cover_cost = execution_price * Decimal(qty_to_cover)
                
                # Calculate P&L for visibility but settle using the actual buyback cost
                short_price = Decimal(str(short_position.short_price))
                pnl = (short_price - execution_price) * Decimal(qty_to_cover)
                
                if user_balance < cover_cost:
                    raise ValueError(f"Insufficient funds to cover short position. Required: ₹{float(cover_cost):.2f}, Available: ₹{float(user_balance):.2f}")

                user_balance -= cover_cost
                short_position.quantity -= qty_to_cover
                if short_position.quantity == 0:
                    short_position.is_active = False
                short_position.save()

                shares_covered = qty_to_cover
                remaining_quantity -= qty_to_cover

                logger.info(f"Covered short position: {qty_to_cover} of {symbol}, P&L: ₹{float(pnl):.2f}")

                if remaining_quantity == 0:
                    user.balance = float(user_balance)
                    user.save()
                    return {"shares_added": 0, "shares_covered": shares_covered}

    if remaining_quantity > 0:
        total_amount = execution_price * Decimal(remaining_quantity)
        if user_balance < total_amount:
            raise ValueError("Insufficient funds to complete this purchase")

        holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
        if holding:
            # CRITICAL FIX #16: Reload holding to prevent race condition with concurrent orders
            holding.reload()
            old_total_cost = Decimal(str(holding.average_price)) * Decimal(holding.quantity)
            new_total_cost = old_total_cost + total_amount
            new_quantity = holding.quantity + remaining_quantity
            if new_quantity <= 0:
                logger.error(f"CRITICAL: Non-positive quantity detected for holding {symbol}")
                raise ValueError("Invalid holding state: non-positive quantity")

            holding.quantity = new_quantity
            holding.average_price = float(new_total_cost / Decimal(new_quantity))
            holding.save()
        else:
            holding = Holding(
                user=user,
                symbol=symbol,
                quantity=remaining_quantity,
                average_price=float(execution_price),
                product_type=product_type
            )
            holding.save()

        user_balance -= total_amount
        shares_added = remaining_quantity

    # CRITICAL FIX #18: Reload user to prevent race condition with concurrent trades
    user.reload()
    user.balance = float(user_balance)
    if user.balance < -0.01:
        logger.error(f"CRITICAL: Negative balance detected for user {user.client_id}: {user.balance}")
        raise ValueError("Invalid account state: negative balance")

    user.save()
    return {"shares_added": shares_added, "shares_covered": shares_covered}


def _execute_sell_order(user, trade_data, idempotency_key, allow_short=False):
    """Execute a sell order and update holdings, lots, and balance.
    NOTE: Partial sells are NOT allowed - user must have enough shares or explicitly short sell."""
    symbol = trade_data['symbol']
    quantity = int(trade_data['quantity'])
    price = Decimal(str(trade_data['execution_price']))
    product_type = trade_data['product_type']
    
    holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
    reserved_qty = holding.reserved_quantity if holding else 0
    on_hand_qty = holding.quantity if holding else 0
    available_qty = max(0, on_hand_qty - reserved_qty)

    # Check if this is a pure short sell (no holdings)
    if available_qty == 0:
        if allow_short and product_type == 'MIS':
            # Pure short sell - all quantity goes to short position
            short_qty = quantity
            shares_from_holding = 0
        else:
            raise ValueError(f"No {symbol} shares available to sell. For short selling, use MIS (Intraday) and enable short sell option.")
    # Check if user has enough shares
    elif available_qty < quantity:
        # Insufficient shares - do NOT allow partial sell
        if reserved_qty > 0:
            raise ValueError(
                f"Insufficient shares to sell. You have {on_hand_qty} {symbol} shares, but {reserved_qty} are reserved for pending orders. "
                f"Available: {available_qty}, Required: {quantity}. Cancel pending orders or reduce quantity."
            )
        else:
            raise ValueError(
                f"Insufficient shares to sell. You have {available_qty} {symbol} shares, but trying to sell {quantity}. "
                f"Reduce quantity to {available_qty} or less."
            )
    else:
        # User has enough shares - normal sell from holdings
        shares_from_holding = quantity
        short_qty = 0

    # Sell shares backed by holdings
    if shares_from_holding > 0:
        lots_to_match, cost_basis, remaining = _match_lots_for_sell(
            user, symbol, shares_from_holding, product_type
        )

        if remaining > 0:
            logger.warning(f"Could not match {remaining} shares for sell - data inconsistency")

        _update_lots_after_sell(lots_to_match)

        # CRITICAL FIX #19: Reload user and holding to prevent race conditions
        user.reload()
        if holding:
            holding.reload()
        
        proceeds_from_holding = price * Decimal(shares_from_holding)
        user.balance += float(proceeds_from_holding)

        holding.quantity -= shares_from_holding
        if holding.quantity < 0:
            logger.error(f"CRITICAL: Negative holding quantity for {symbol}: {holding.quantity}")
            raise ValueError("Data corruption: negative holding quantity")

        if holding.quantity == 0 and holding.reserved_quantity == 0:
            holding.delete()
            holding = None
        else:
            holding.save()

    # Handle explicitly requested short selling for MIS product
    if short_qty > 0:
        short_position = ShortPosition.objects(
            user=user,
            symbol=symbol,
            is_active=True
        ).first()

        if short_position:
            # CRITICAL FIX #20: Reload short position to prevent race condition
            short_position.reload()
            old_total = Decimal(str(short_position.short_price)) * Decimal(short_position.quantity)
            new_total = old_total + (price * Decimal(short_qty))
            new_quantity = short_position.quantity + short_qty
            short_position.quantity = new_quantity
            short_position.short_price = float(new_total / Decimal(new_quantity))
            short_position.save()
        else:
            short_position = ShortPosition(
                user=user,
                symbol=symbol,
                quantity=short_qty,
                short_price=float(price),
                is_active=True
            )
            short_position.save()

        # CRITICAL FIX #20: Reload user before balance update
        user.reload()
        short_proceeds = price * Decimal(short_qty)
        user.balance += float(short_proceeds)
        logger.info(f"Created/updated short position: {short_qty} of {symbol} @{price}")

    user.save()


def _create_bracket_order_legs(user, entry_transaction, trade_data):
    """Create stop-loss and target legs for a bracket order.
    CRITICAL: Also reserve the shares for these pending sell legs.
    """
    symbol = trade_data['symbol']
    quantity = trade_data['quantity']
    stop_loss_price = trade_data.get('stop_loss_price')
    target_price = trade_data.get('target_price')
    product_type = trade_data['product_type']
    
    # Determine opposite action for legs
    entry_action = entry_transaction.action
    exit_action = 'SELL' if entry_action == 'BUY' else 'BUY'
    
    # CRITICAL FIX #13: For SELL legs, reserve the shares in holding
    if exit_action == 'SELL':
        holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
        if not holding or holding.quantity < quantity:
            raise ValueError(f"Insufficient shares in holding to create bracket order protection legs")
        
        # Reserve shares for BOTH stop-loss and target legs
        # (they will compete, and only one will execute)
        # We only need to reserve once since only one leg can execute
        # But we track that 2 legs are using the same reserved quantity
        reserved_qty_needed = quantity
        
        if holding.quantity - holding.reserved_quantity < reserved_qty_needed:
            raise ValueError(f"Insufficient unreserved shares for bracket order legs")
        
        # CRITICAL FIX #25: Reload holding to prevent race condition
        holding.reload()
        holding.reserved_quantity += reserved_qty_needed
        holding.save()
        logger.info(f"Reserved {reserved_qty_needed} shares for bracket order legs")
    
    # Create stop-loss leg
    if stop_loss_price:
        stop_loss_txn = Transaction(
            user=user,
            symbol=symbol,
            action=exit_action,
            quantity=quantity,
            price=float(stop_loss_price),
            status='PENDING',
            order_type='STOP_LOSS',
            product_type=product_type,
            stop_loss_price=float(stop_loss_price),
            parent_order_id=str(entry_transaction.id),
            bracket_order_type='STOP_LOSS',
            idempotency_key=_generate_idempotency_key()
        )
        stop_loss_txn.save()
        logger.info(f"Created stop-loss leg for bracket order: {symbol} @{stop_loss_price}")
    
    # Create target leg
    if target_price:
        target_txn = Transaction(
            user=user,
            symbol=symbol,
            action=exit_action,
            quantity=quantity,
            price=float(target_price),
            status='PENDING',
            order_type='LIMIT',
            product_type=product_type,
            target_price=float(target_price),
            parent_order_id=str(entry_transaction.id),
            bracket_order_type='TARGET',
            idempotency_key=_generate_idempotency_key()
        )
        target_txn.save()
        logger.info(f"Created target leg for bracket order: {symbol} @{target_price}")


# --- API Routes ---

@trade_bp.route('/buy', methods=['POST'])
@login_required
def buy():
    """Handles a buy order with support for advanced order types and intraday trading."""
    data = request.get_json() or {}
    result, status_code = _validate_and_process_trade_request('BUY', data)
    
    if status_code != 200:
        return jsonify(result), status_code

    trade_data = result['data']
    user = User.objects.get(id=current_user.id)
    
    # Generate or reuse idempotency key
    idempotency_key = _resolve_idempotency_key(data)
    
    # For orders that execute immediately
    if trade_data['status'] == 'EXECUTED':
        # Check idempotency before execution
        existing_txn = Transaction.objects(idempotency_key=idempotency_key).first()
        if existing_txn:
            logger.warning(f"Duplicate order detected (idempotency key: {idempotency_key}). Returning existing order.")
            return jsonify({
                "success": True,
                "message": "Order already executed (duplicate request detected).",
                "order_id": str(existing_txn.id),
                "new_balance": float(user.balance),
                "product_type": trade_data['product_type'],
                "duplicate": True
            }), 200
        
        # Check if user has sufficient unreserved funds
        available_cash = Decimal(str(user.balance)) - Decimal(str(user.reserved_balance))
        if available_cash < trade_data['total_amount']:
            return jsonify({
                "success": False,
                "message": (
                    f"Insufficient available funds. Required: \u20b9{float(trade_data['total_amount']):,.2f}, "
                    f"Available: \u20b9{float(available_cash):,.2f} (\u20b9{user.reserved_balance:,.2f} reserved)."
                )
            }), 402

        try:
            # Execute the buy order and capture how many shares were actually added
            execution_result = _execute_buy_order(user, trade_data, idempotency_key)
            
            # Create transaction record
            transaction = Transaction(
                user=user,
                action='BUY',
                symbol=trade_data['symbol'],
                quantity=trade_data['quantity'],
                price=float(trade_data['execution_price']),
                status='EXECUTED',
                order_type=trade_data['order_type'],
                product_type=trade_data['product_type'],
                idempotency_key=idempotency_key,
                execution_date=datetime.utcnow()
            )
            transaction.save()
            
            # Create lot(s) only for newly added shares (ignore pure short covers)
            if execution_result.get('shares_added'):
                _create_lot_from_buy(
                    user,
                    trade_data['symbol'],
                    execution_result['shares_added'],
                    float(trade_data['execution_price']),
                    transaction,
                    trade_data['product_type']
                )
            
            # Create bracket legs with proper rollback on failure
            bracket_legs_created = False
            if trade_data['order_type'] == 'BRACKET' and execution_result.get('shares_added'):
                try:
                    _create_bracket_order_legs(user, transaction, trade_data)
                    bracket_legs_created = True
                except Exception as leg_error:
                    logger.error(f"CRITICAL: Failed to create bracket order legs: {leg_error}", exc_info=True)
                    # Complete rollback of all changes
                    try:
                        # Rollback transaction
                        transaction.delete()
                        
                        # Rollback holding
                        holding = Holding.objects(user=user, symbol=trade_data['symbol'], product_type=trade_data['product_type']).first()
                        shares_added = execution_result.get('shares_added', 0)
                        if holding and shares_added > 0:
                            holding.quantity -= shares_added
                            if holding.quantity <= 0:
                                holding.delete()
                            else:
                                # Recalculate average price
                                old_total = (Decimal(str(holding.average_price)) * Decimal(holding.quantity + shares_added))
                                purchase_cost = Decimal(str(trade_data['execution_price'])) * Decimal(shares_added)
                                holding.average_price = float((old_total - purchase_cost) / Decimal(holding.quantity))
                                holding.save()
                        
                        # Rollback lot
                        lots_to_delete = Lot.objects(user=user, purchase_transaction=transaction)
                        lots_to_delete.delete()
                        
                        # CRITICAL FIX #4: Rollback balance correctly
                        user.reload()
                        user.balance += float(trade_data['total_amount'])
                        user.save()
                        
                        logger.info(f"Successfully rolled back bracket order for user {user.client_id}")
                    except Exception as rollback_error:
                        logger.critical(f"ROLLBACK FAILED for bracket order: {rollback_error}", exc_info=True)
                    
                    return jsonify({
                        "success": False,
                        "message": "Failed to create bracket order protection legs. Order cancelled and rolled back."
                    }), 500
            
            logger.info(f"BUY order executed for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']} ({trade_data['product_type']})")
            
            # HIGH PRIORITY FIX #7: Invalidate user profile/balance cache
            app_cache.invalidate_pattern(f"route:get_profile:user:{current_user.id}")
            app_cache.invalidate_pattern(f"route:get_portfolio:user:{current_user.id}")
            
            return jsonify({
                "success": True,
                "message": "Buy order executed successfully.",
                "order_id": str(transaction.id),
                "new_balance": float(user.balance),
                "product_type": trade_data['product_type']
            }), 200

        except Exception as e:
            logger.error(f"Error executing BUY for {user.client_id}: {e}", exc_info=True)
            # Note: This is for immediate execution orders, not pending orders
            # No reserved balance to release for immediate execution as it's deducted directly
            return jsonify({"success": False, "message": f"Trade execution failed: {str(e)}"}), 500
    
    else:
        # Create pending order (will be processed by order_processor)
        # Use Decimal for reserved_balance calculations
        available_balance = Decimal(str(user.balance)) - Decimal(str(user.reserved_balance))
        if available_balance < trade_data['total_amount']:
            return jsonify({
                "success": False, 
                "message": f"Insufficient available funds. Required: ₹{float(trade_data['total_amount']):.2f}, Available: ₹{float(available_balance):.2f} (Reserved: ₹{user.reserved_balance:.2f})"
            }), 402
        
        # Check for duplicate pending orders
        existing_txn = Transaction.objects(idempotency_key=idempotency_key).first()
        if existing_txn:
            logger.warning(f"Duplicate pending buy order detected (idempotency key: {idempotency_key})")
            return jsonify({
                "success": True,
                "message": "Order already placed (duplicate request detected).",
                "order_id": str(existing_txn.id),
                "status": existing_txn.status,
                "duplicate": True
            }), 200
        
        reservation_amount = Decimal(str(trade_data['total_amount']))
        reservation_successful = False
        try:
            # Reserve the balance for this pending order (using Decimal precision)
            # CRITICAL FIX #21: Reload user to get latest state before reservation
            user.reload()
            current_reserved = Decimal(str(user.reserved_balance))
            user.reserved_balance = float(current_reserved + reservation_amount)
            user.save()
            reservation_successful = True
            
            transaction = Transaction(
                user=user,
                action='BUY',
                symbol=trade_data['symbol'],
                quantity=trade_data['quantity'],
                price=float(trade_data['execution_price']),
                status='PENDING',
                order_type=trade_data['order_type'],
                product_type=trade_data['product_type'],
                stop_loss_price=float(trade_data['stop_loss_price']) if trade_data.get('stop_loss_price') else None,
                target_price=float(trade_data['target_price']) if trade_data.get('target_price') else None,
                trailing_stop_pct=float(trade_data['trailing_stop_pct']) if trade_data.get('trailing_stop_pct') else None,
                idempotency_key=idempotency_key
            )
            transaction.save()
            
            # NOTE: Lots and holdings are NOT created here for pending orders
            # They will be created by order_processor.py when the order actually executes
            # This prevents premature lot allocation for orders that might be cancelled
            
            # Determine appropriate success message
            session = get_market_session()
            if session == 'POST_MARKET':
                from app.utils.market_hours import get_next_trading_day
                next_day = get_next_trading_day()
                base_msg = f"After Market Order (AMO) placed successfully. Will execute on {next_day.strftime('%Y-%m-%d')} at market open."
                if trade_data.get('was_auto_converted'):
                    message = f"{base_msg} (Market order converted to Limit at ₹{trade_data['execution_price']:.2f})"
                else:
                    message = base_msg
            else:
                message = f"Buy order placed successfully. Order is pending execution."
            
            logger.info(f"Pending BUY order created for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']}")
            
            return jsonify({
                "success": True,
                "message": message,
                "order_id": str(transaction.id),
                "status": "pending",
                "order_type": trade_data['order_type']
            }), 200
            
        except Exception as e:
            logger.error(f"Error creating pending BUY for {user.client_id}: {e}", exc_info=True)
            # CRITICAL FIX #10: Roll back reserved balance on any failure
            if reservation_successful:
                try:
                    user.reload()
                    updated_reserved = Decimal(str(user.reserved_balance)) - reservation_amount
                    user.reserved_balance = float(max(updated_reserved, Decimal('0')))
                    user.save()
                    logger.info(f"Rolled back reserved balance ₹{float(reservation_amount):.2f} after error")
                except Exception as rollback_error:
                    logger.critical(f"CRITICAL: Failed to roll back reserved balance for BUY order: {rollback_error}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to place order: {str(e)}"}), 500


@trade_bp.route('/sell', methods=['POST'])
@login_required
def sell():
    """Handles a sell order with support for short selling (MIS only) and advanced order types."""
    data = request.get_json() or {}
    result, status_code = _validate_and_process_trade_request('SELL', data)
    
    if status_code != 200:
        return jsonify(result), status_code
    
    trade_data = result['data']
    user = User.objects.get(id=current_user.id)
    
    # Generate or reuse idempotency key
    idempotency_key = _resolve_idempotency_key(data)
    
    # Determine if short selling is allowed based on market session and user preference
    user_requested_short = bool(data.get('allow_short'))
    allow_short = (
        trade_data['product_type'] == 'MIS'
        and is_market_open()
        and user_requested_short
    )
    
    # For orders that execute immediately
    if trade_data['status'] == 'EXECUTED':
        # Check idempotency before execution
        existing_txn = Transaction.objects(idempotency_key=idempotency_key).first()
        if existing_txn:
            logger.warning(f"Duplicate sell order detected (idempotency key: {idempotency_key}). Returning existing order.")
            return jsonify({
                "success": True,
                "message": "Order already executed (duplicate request detected).",
                "order_id": str(existing_txn.id),
                "new_balance": float(user.balance),
                "product_type": trade_data['product_type'],
                "duplicate": True
            }), 200
        
        try:
            # Execute the sell order
            _execute_sell_order(user, trade_data, idempotency_key, allow_short=allow_short)
            
            # Create transaction record
            transaction = Transaction(
                user=user,
                action='SELL',
                symbol=trade_data['symbol'],
                quantity=trade_data['quantity'],
                price=float(trade_data['execution_price']),
                status='EXECUTED',
                order_type=trade_data['order_type'],
                product_type=trade_data['product_type'],
                idempotency_key=idempotency_key,
                execution_date=datetime.utcnow()
            )
            transaction.save()
            
            # If bracket order, create stop-loss and target legs
            if trade_data['order_type'] == 'BRACKET':
                _create_bracket_order_legs(user, transaction, trade_data)
            
            logger.info(f"SELL order executed for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']} ({trade_data['product_type']})")
            
            # HIGH PRIORITY FIX #7: Invalidate user profile/balance cache
            app_cache.invalidate_pattern(f"route:get_profile:user:{current_user.id}")
            app_cache.invalidate_pattern(f"route:get_portfolio:user:{current_user.id}")
            
            return jsonify({
                "success": True,
                "message": "Sell order executed successfully.",
                "order_id": str(transaction.id),
                "new_balance": float(user.balance),
                "product_type": trade_data['product_type']
            }), 200

        except ValueError as ve:
            return jsonify({"success": False, "message": str(ve)}), 400
        except Exception as e:
            logger.error(f"Error executing SELL for {user.client_id}: {e}", exc_info=True)
            return jsonify({"success": False, "message": f"Trade execution failed: {str(e)}"}), 500
    
    else:
        # Create pending order
        # Check for duplicate pending orders FIRST before any state changes
        existing_txn = Transaction.objects(idempotency_key=idempotency_key).first()
        if existing_txn:
            logger.warning(f"Duplicate pending sell order detected (idempotency key: {idempotency_key})")
            return jsonify({
                "success": True,
                "message": "Order already placed (duplicate request detected).",
                "order_id": str(existing_txn.id),
                "status": existing_txn.status,
                "duplicate": True
            }), 200
        
        # Validate user has sufficient shares (accounting for pending sells)
        product_type = trade_data['product_type']
        reserved_adjustments = []
        if product_type == 'CNC':
            # CNC sell requires existing holdings
            holding = Holding.objects(user=user, symbol=trade_data['symbol'], product_type='CNC').first()
            total_qty = holding.quantity if holding else 0
            reserved_qty = holding.reserved_quantity if holding else 0
            
            # CRITICAL FIX #24: available_qty = total - reserved (already accounts for pending sells)
            # The reserved_quantity field tracks ALL pending sell orders
            available_qty = total_qty - reserved_qty
            
            # Validate we have enough unreserved shares
            truly_available = available_qty
            
            if truly_available < trade_data['quantity']:
                return jsonify({
                    "success": False,
                    "message": (
                        f"Insufficient available shares. Total: {total_qty}, "
                        f"Reserved: {reserved_qty}, "
                        f"Available: {truly_available}, Required: {trade_data['quantity']}"
                    )
                }), 400
            
            # Update reserved_quantity in holding
            if holding:
                # CRITICAL FIX #23 & #25: Reload before update to prevent race condition
                holding.reload()
                holding.reserved_quantity += trade_data['quantity']
                holding.save()
                reserved_adjustments.append((holding, trade_data['quantity']))
                
        elif product_type == 'MIS':
            # MIS allows short selling during market hours, but pending orders need holdings
            # Short selling is only allowed for immediate execution during market hours
            holding = Holding.objects(user=user, symbol=trade_data['symbol'], product_type='MIS').first()
            total_qty = holding.quantity if holding else 0
            reserved_qty = holding.reserved_quantity if holding else 0
            
            # CRITICAL FIX #24: available_qty = total - reserved (already accounts for pending sells)
            # The reserved_quantity field tracks ALL pending sell orders
            available_qty = total_qty - reserved_qty
            truly_available = available_qty
            
            if truly_available < trade_data['quantity']:
                return jsonify({
                    "success": False,
                    "message": (
                        f"Insufficient MIS shares for pending order. Total: {total_qty}, "
                        f"Reserved: {reserved_qty}, "
                        f"Available: {truly_available}. Short selling only allowed during market hours."
                    )
                }), 400
            
            # Update reserved_quantity in holding
            if holding:
                # CRITICAL FIX #23 & #25: Reload before update to prevent race condition
                holding.reload()
                holding.reserved_quantity += trade_data['quantity']
                holding.save()
                reserved_adjustments.append((holding, trade_data['quantity']))
        
        try:
            transaction = Transaction(
                user=user,
                action='SELL',
                symbol=trade_data['symbol'],
                quantity=trade_data['quantity'],
                price=float(trade_data['execution_price']),
                status='PENDING',
                order_type=trade_data['order_type'],
                product_type=trade_data['product_type'],
                stop_loss_price=float(trade_data['stop_loss_price']) if trade_data.get('stop_loss_price') else None,
                target_price=float(trade_data['target_price']) if trade_data.get('target_price') else None,
                trailing_stop_pct=float(trade_data['trailing_stop_pct']) if trade_data.get('trailing_stop_pct') else None,
                idempotency_key=idempotency_key
            )
            transaction.save()
            
            # NOTE: Holdings and lot updates are NOT done here for pending orders
            # They will be processed by order_processor.py when the order executes
            # This prevents premature deduction for orders that might be cancelled
            
            # Determine appropriate success message
            session = get_market_session()
            if session == 'POST_MARKET':
                from app.utils.market_hours import get_next_trading_day
                next_day = get_next_trading_day()
                base_msg = f"After Market Order (AMO) placed successfully. Will execute on {next_day.strftime('%Y-%m-%d')} at market open."
                if trade_data.get('was_auto_converted'):
                    message = f"{base_msg} (Market order converted to Limit at ₹{trade_data['execution_price']:.2f})"
                else:
                    message = base_msg
            else:
                message = f"Sell order placed successfully. Order is pending execution."
            
            logger.info(f"Pending SELL order created for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']}")
            
            return jsonify({
                "success": True,
                "message": message,
                "order_id": str(transaction.id),
                "status": "pending",
                "order_type": trade_data['order_type']
            }), 200
            
        except Exception as e:
            logger.error(f"Error creating pending SELL for {user.client_id}: {e}", exc_info=True)
            # CRITICAL FIX #10: Roll back any reserved quantities that were incremented before the failure
            for holding, qty in reserved_adjustments:
                try:
                    holding.reload()
                    holding.reserved_quantity = max(0, holding.reserved_quantity - qty)
                    holding.save()
                    logger.info(f"Rolled back reserved quantity {qty} for holding {holding.symbol} after SELL failure")
                except Exception as rollback_error:
                    logger.critical(f"CRITICAL: Failed to roll back reserved quantity for {holding.symbol}: {rollback_error}", exc_info=True)
            return jsonify({"success": False, "message": f"Failed to place order: {str(e)}"}), 500


@trade_bp.route('/market-status', methods=['GET'])
def market_status():
    """Get current market status and trading hours information."""
    try:
        from app.utils.market_hours import MarketSession
        
        status_message = get_market_status_message()
        is_open = is_market_open()
        session = get_market_session()
        is_holiday = is_market_holiday()
        
        return jsonify({
            "success": True,
            "is_market_open": is_open,
            "session": session,  # Already a string
            "is_holiday": is_holiday,
            "status_message": status_message,
            "can_place_orders": True,  # API always accepts orders (validated later)
            "regular_hours": "9:15 AM - 3:30 PM IST",
            "pre_market": "9:00 AM - 9:15 AM IST",
            "post_market": "3:40 PM onwards (AMO)"
        }), 200
    except Exception as e:
        logger.error(f"Error fetching market status: {e}", exc_info=True)
        return jsonify({"success": False, "message": "Failed to fetch market status"}), 500


@trade_bp.route('/exit-plan', methods=['PATCH'])
@login_required
def update_exit_plan():
    """Create or update stoploss/target exit plan for an active holding.

    Expected payload:
      - symbol (required)
      - product_type (optional, default CNC)
      - stop_order_id (optional)
      - target_order_id (optional)
      - stop_loss_price (required)
      - target_price (required)
    """
    data = request.get_json() or {}

    symbol = data.get('symbol')
    if not symbol:
        return jsonify({"success": False, "message": "Symbol is required."}), 400

    product_type = (data.get('product_type') or 'CNC').upper()
    stop_order_id = data.get('stop_order_id')
    target_order_id = data.get('target_order_id')

    try:
        stop_loss_price = float(data.get('stop_loss_price'))
        target_price = float(data.get('target_price'))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Stoploss and target must be valid numbers."}), 400

    if stop_loss_price <= 0 or target_price <= 0:
        return jsonify({"success": False, "message": "Stoploss and target must be positive."}), 400

    # Ensure holding exists (we only allow exit-plan edits for active holdings)
    holding = Holding.objects(user=current_user, symbol=symbol, product_type=product_type).first()
    if not holding:
        return jsonify({"success": False, "message": f"No active holding found for {symbol} ({product_type})."}), 404

    available_qty = int(getattr(holding, 'quantity', 0) or 0) - int(getattr(holding, 'reserved_quantity', 0) or 0)
    if int(getattr(holding, 'quantity', 0) or 0) <= 0:
        return jsonify({"success": False, "message": "Holding quantity is zero."}), 400

    def _get_pending_by_id(order_id):
        if not order_id:
            return None
        try:
            return Transaction.objects(id=order_id, user=current_user, status='PENDING').first()
        except Exception:
            return None

    stop_txn = _get_pending_by_id(stop_order_id)
    target_txn = _get_pending_by_id(target_order_id)

    # Fallback lookup if ids not supplied
    if not stop_txn:
        stop_txn = Transaction.objects(
            user=current_user,
            status='PENDING',
            action='SELL',
            symbol=symbol,
            product_type=product_type,
        ).filter(Q(order_type='STOP_LOSS') | Q(bracket_order_type='STOP_LOSS')).order_by('-transaction_date').first()

    if not target_txn:
        target_txn = Transaction.objects(
            user=current_user,
            status='PENDING',
            action='SELL',
            symbol=symbol,
            product_type=product_type,
        ).filter(Q(bracket_order_type='TARGET') | (Q(order_type='LIMIT') & Q(target_price__ne=None))).order_by('-transaction_date').first()

    # If there is no existing exit plan, create bracket-style SELL legs (OCO) for the holding.
    # This allows users to set stoploss/target directly after an executed BUY (holding exists).
    if not stop_txn and not target_txn:
        if available_qty <= 0:
            return jsonify({
                "success": False,
                "message": "No available quantity to protect (all shares are already reserved by pending sells)."
            }), 400

        # Reserve once for both legs (they compete; only one can execute).
        holding.reload()
        available_after_reload = int(getattr(holding, 'quantity', 0) or 0) - int(getattr(holding, 'reserved_quantity', 0) or 0)
        if available_after_reload < available_qty:
            available_qty = available_after_reload
        if available_qty <= 0:
            return jsonify({
                "success": False,
                "message": "No available quantity to protect."
            }), 400

        holding.reserved_quantity += int(available_qty)
        holding.save()

        parent_key = f"EXITPLAN:{current_user.id}:{symbol}:{product_type}:{int(time.time() * 1000)}"

        stop_txn = Transaction(
            user=current_user,
            symbol=symbol,
            action='SELL',
            quantity=int(available_qty),
            price=float(stop_loss_price),
            status='PENDING',
            order_type='STOP_LOSS',
            product_type=product_type,
            stop_loss_price=float(stop_loss_price),
            parent_order_id=parent_key,
            bracket_order_type='STOP_LOSS',
            idempotency_key=_generate_idempotency_key(),
        )
        stop_txn.save()

        target_txn = Transaction(
            user=current_user,
            symbol=symbol,
            action='SELL',
            quantity=int(available_qty),
            price=float(target_price),
            status='PENDING',
            order_type='LIMIT',
            product_type=product_type,
            target_price=float(target_price),
            parent_order_id=parent_key,
            bracket_order_type='TARGET',
            idempotency_key=_generate_idempotency_key(),
        )
        target_txn.save()

    if stop_txn:
        if stop_txn.action != 'SELL' or stop_txn.symbol != symbol or (getattr(stop_txn, 'product_type', 'CNC') or 'CNC') != product_type:
            return jsonify({"success": False, "message": "Stoploss order does not match the selected holding."}), 400
        stop_txn.stop_loss_price = float(stop_loss_price)
        stop_txn.price = float(stop_loss_price)
        stop_txn.save()

    if target_txn:
        if target_txn.action != 'SELL' or target_txn.symbol != symbol or (getattr(target_txn, 'product_type', 'CNC') or 'CNC') != product_type:
            return jsonify({"success": False, "message": "Target order does not match the selected holding."}), 400
        target_txn.target_price = float(target_price)
        target_txn.price = float(target_price)
        target_txn.save()

    # Invalidate portfolio cache so UI reflects updates immediately
    app_cache.invalidate_pattern(f"route:get_portfolio:user:{current_user.id}")

    return jsonify({
        "success": True,
        "message": "Exit plan updated successfully.",
        "exit_plan": {
            "stop_order_id": str(stop_txn.id) if stop_txn else None,
            "stop_loss_price": float(stop_txn.stop_loss_price) if stop_txn and stop_txn.stop_loss_price else None,
            "target_order_id": str(target_txn.id) if target_txn else None,
            "target_price": float(target_txn.target_price) if target_txn and target_txn.target_price else None,
        }
    }), 200


@trade_bp.route('/cancel-order/<order_id>', methods=['DELETE'])
@login_required
def cancel_order(order_id):
    """Cancel a pending order."""
    try:
        transaction = Transaction.objects(id=order_id, user=current_user).first()
        
        if not transaction:
            return jsonify({"success": False, "message": "Order not found"}), 404
        
        if transaction.status != 'PENDING':
            return jsonify({"success": False, "message": "Only pending orders can be cancelled"}), 400

        user = User.objects(id=current_user.id).first()
        if not user:
            logger.error(f"User {current_user.id} not found while cancelling order {order_id}")
            return jsonify({"success": False, "message": "Unable to load account data for cancellation."}), 500
        
        # Release reserved balance if this is a BUY order
        if transaction.action == 'BUY':
            # CRITICAL FIX #7: Use correct price based on order type
            # For LIMIT, STOP_LIMIT orders: use limit price
            # For MARKET, STOP_LOSS, TRAILING_STOP: use transaction price
            order_price = Decimal(str(transaction.price))
            total_amount = order_price * Decimal(transaction.quantity)
            # CRITICAL FIX #22: Reload user before updating reserved_balance
            user.reload()
            user.reserved_balance = max(0, user.reserved_balance - float(total_amount))
            user.save()
            logger.info(f"Released reserved balance ₹{float(total_amount):.2f} for cancelled BUY order {order_id}")
        
        # Release reserved_quantity if this is a SELL order
        elif transaction.action == 'SELL':
            holding = Holding.objects(
                user=current_user,
                symbol=transaction.symbol,
                product_type=transaction.product_type if hasattr(transaction, 'product_type') else 'CNC'
            ).first()
            if holding and holding.reserved_quantity >= transaction.quantity:
                holding.reserved_quantity -= transaction.quantity
                holding.save()
                logger.info(f"Released reserved quantity {transaction.quantity} for cancelled SELL order {order_id}")
        
        transaction.status = 'CANCELLED'
        transaction.save()
        
        # Validate bracket order cancellation logic
        if transaction.parent_order_id:
            # Check if this is a protection leg (stop-loss or target)
            if transaction.bracket_order_type in ('STOP_LOSS', 'TARGET'):
                # Find and validate parent order status
                parent_order = Transaction.objects(id=transaction.parent_order_id).first()
                if parent_order and parent_order.status == 'EXECUTED':
                    logger.warning(
                        f"CANCELLATION WARNING: User {current_user.client_id} cancelling protection leg "
                        f"{transaction.bracket_order_type} while parent order is EXECUTED. Position will be unprotected!"
                    )
            
            # Cancel sibling legs
            sibling_legs = Transaction.objects(
                user=current_user,
                parent_order_id=transaction.parent_order_id,
                status='PENDING'
            )
            for leg in sibling_legs:
                if str(leg.id) != order_id:
                    # CRITICAL FIX #11: Release reserved resources for sibling legs too
                    if leg.action == 'BUY':
                        leg_price = Decimal(str(leg.price))
                        leg_amount = leg_price * Decimal(leg.quantity)
                        user.reload()
                        user.reserved_balance = max(0, user.reserved_balance - float(leg_amount))
                        logger.info(f"Released reserved balance ₹{float(leg_amount):.2f} for cancelled sibling leg {leg.id}")
                    elif leg.action == 'SELL':
                        leg_holding = Holding.objects(
                            user=current_user,
                            symbol=leg.symbol,
                            product_type=leg.product_type if hasattr(leg, 'product_type') else 'CNC'
                        ).first()
                        if leg_holding and leg_holding.reserved_quantity >= leg.quantity:
                            leg_holding.reserved_quantity -= leg.quantity
                            leg_holding.save()
                            logger.info(f"Released reserved quantity {leg.quantity} for cancelled sibling leg {leg.id}")
                    
                    leg.status = 'CANCELLED'
                    leg.save()
            
            # Save user after all balance adjustments
            if transaction.parent_order_id:
                user.save()
        
        logger.info(f"Order {order_id} cancelled by user {current_user.client_id}")
        
        return jsonify({
            "success": True,
            "message": "Order cancelled successfully",
            "order_id": order_id
        }), 200
        
    except Exception as e:
        logger.error(f"Error cancelling order {order_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "Failed to cancel order"}), 500

