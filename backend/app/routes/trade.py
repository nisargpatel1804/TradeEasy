import logging
import secrets
from decimal import Decimal
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine import Q
from app.models import Transaction, Holding, User
from app.services.trade_executor import TradeExecutor
from app.services.market_time import validate_order_timing, is_market_open, get_market_status_message, get_market_session, is_market_holiday
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
    """Validate parameters specific to advanced order types."""
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

def _validate_and_process_trade_request(action: str, data: dict) -> tuple[dict, int]:
    """
    Centralized validation and price fetching.
    Determines if order should be EXECUTED immediately or marked PENDING.
    """
    symbol_input = data.get('symbol')
    quantity_input = data.get('quantity')
    order_type = str(data.get('order_type', 'MARKET')).upper()
    product_type = str(data.get('product_type', 'CNC')).upper()

    # 1. Basic Inputs
    if not symbol_input or not isinstance(quantity_input, int) or quantity_input <= 0:
        return {"success": False, "message": "A valid symbol and a positive integer quantity are required."}, 400
    
    if quantity_input > MAX_ORDER_QUANTITY:
        return {"success": False, "message": f"Order quantity exceeds maximum limit of {MAX_ORDER_QUANTITY:,} shares."}, 400
    
    if product_type not in ['CNC', 'MIS']:
        return {"success": False, "message": "Invalid product type. Must be 'CNC' (delivery) or 'MIS' (intraday)."}, 400
    
    valid_order_types = ['MARKET', 'LIMIT', 'STOP_LOSS', 'STOP_LIMIT', 'BRACKET', 'TRAILING_STOP']
    if order_type not in valid_order_types:
        return {"success": False, "message": f"Invalid order type. Must be one of: {', '.join(valid_order_types)}."}, 400
    
    # 2. Circuit Breaker Check
    if order_type in ['LIMIT', 'STOP_LIMIT'] and data.get('price'):
        limit_price = float(data.get('price'))
        api_data_preview = get_stock_data_from_api(symbol_input)
        if api_data_preview and api_data_preview.get('ltp', 0) > 0:
            current_price = float(api_data_preview['ltp'])
            price_deviation = abs((limit_price - current_price) / current_price) * 100
            if price_deviation > 20:
                return {
                    "success": False,
                    "message": f"Order price deviates {price_deviation:.1f}% from current price. Max 20% allowed."
                }, 400

    # 3. Advanced Params
    is_valid, error_msg = _validate_advanced_order_params(order_type, data)
    if not is_valid:
        return {"success": False, "message": error_msg}, 400

    # 4. Market Hours
    is_timing_valid, timing_message = validate_order_timing(order_type, product_type)
    if not is_timing_valid:
        return {"success": False, "message": timing_message}, 400

    quantity = int(quantity_input)

    # 5. Live Data
    api_data = get_stock_data_from_api(symbol_input)
    if not api_data:
        return {"success": False, "message": f"Instrument '{format_symbol(symbol_input)}' is not available."}, 404

    current_ltp = Decimal(str(api_data.get('ltp', 0)))
    if current_ltp <= 0:
        return {"success": False, "message": "Could not fetch valid market price."}, 502

    estimated_value = current_ltp * Decimal(quantity)
    if estimated_value > Decimal(str(MAX_ORDER_VALUE)):
        return {"success": False, "message": f"Order value exceeds limit of \u20b9{MAX_ORDER_VALUE:,}."}, 400

    # 6. Determine Status & Price
    execution_price = None
    status = "PENDING"
    
    if order_type == 'MARKET':
        execution_price = current_ltp
        status = "EXECUTED"
    
    elif order_type == 'LIMIT':
        limit_price = Decimal(str(data.get('price', 0)))
        if limit_price <= 0:
            return {"success": False, "message": "Price required for LIMIT orders."}, 400
        
        # Check if marketable immediately
        if action == 'BUY' and current_ltp <= limit_price:
            execution_price = current_ltp # Buy at market (lower than limit)
            status = "EXECUTED"
        elif action == 'SELL' and current_ltp >= limit_price:
            execution_price = current_ltp # Sell at market (higher than limit)
            status = "EXECUTED"
        else:
            execution_price = limit_price
            status = "PENDING"
    
    elif order_type == 'STOP_LOSS':
        stop_trigger = data.get('stop_loss_price')
        if not stop_trigger:
            return {"success": False, "message": "Stop-loss trigger required."}, 400
        execution_price = Decimal(str(stop_trigger))
        status = "PENDING"

    elif order_type == 'STOP_LIMIT':
        execution_price = Decimal(str(data.get('price', current_ltp)))
        status = "PENDING"

    elif order_type == 'TRAILING_STOP':
        execution_price = current_ltp
        status = "PENDING"
    
    elif order_type == 'BRACKET':
        execution_price = current_ltp
        status = "EXECUTED"

    total_amount = execution_price * Decimal(quantity)

    if product_type == 'MIS' and status == 'PENDING':
        return {"success": False, "message": "Intraday (MIS) orders must execute immediately (Market/Marketable Limit)."}, 400

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
        }
    }, 200

# --- API Routes ---

@trade_bp.route('/buy', methods=['POST'])
@login_required
def buy():
    """Handles a buy order using TradeExecutor."""
    data = request.get_json() or {}
    result, status_code = _validate_and_process_trade_request('BUY', data)
    
    if status_code != 200:
        return jsonify(result), status_code

    trade_data = result['data']
    idempotency_key = _resolve_idempotency_key(data)
    
    # Pre-check funds for immediate feedback (Executor does atomic check, but this saves a DB hit)
    user = current_user
    if trade_data['status'] == 'EXECUTED':
        # Check against available balance
        if user.balance < trade_data['total_amount']:
            return jsonify({"success": False, "message": "Insufficient funds."}), 402
            
        # DELEGATE TO EXECUTOR
        response = TradeExecutor.execute_buy(
            user_id=user.id,
            symbol=trade_data['symbol'],
            quantity=trade_data['quantity'],
            price=trade_data['execution_price'],
            product_type=trade_data['product_type'],
            order_type=trade_data['order_type'],
            idempotency_key=idempotency_key
        )
    else:
        # PENDING ORDER
        available = Decimal(str(user.balance)) - Decimal(str(user.reserved_balance))
        if available < trade_data['total_amount']:
            return jsonify({"success": False, "message": "Insufficient available funds (some funds are reserved)."}), 402

        response = TradeExecutor.create_pending_order(
            user_id=user.id,
            symbol=trade_data['symbol'],
            action='BUY',
            quantity=trade_data['quantity'],
            price=trade_data['execution_price'],
            order_type=trade_data['order_type'],
            product_type=trade_data['product_type'],
            stop_loss_price=trade_data['stop_loss_price'],
            target_price=trade_data['target_price'],
            trailing_stop_pct=trade_data['trailing_stop_pct'],
            idempotency_key=idempotency_key,
            bracket_order_type='ENTRY' if trade_data['order_type'] == 'BRACKET' else None
        )

    if response.get('success'):
        return jsonify(response), 200
    else:
        return jsonify(response), 400 if "Insufficient" in response.get('message', '') else 500


@trade_bp.route('/sell', methods=['POST'])
@login_required
def sell():
    """Handles a sell order using TradeExecutor."""
    data = request.get_json() or {}
    result, status_code = _validate_and_process_trade_request('SELL', data)
    
    if status_code != 200:
        return jsonify(result), status_code
    
    trade_data = result['data']
    idempotency_key = _resolve_idempotency_key(data)
    
    # Determine Short Selling
    user_requested_short = bool(data.get('allow_short'))
    allow_short = (
        trade_data['product_type'] == 'MIS'
        and is_market_open()
        and user_requested_short
    )

    if trade_data['status'] == 'EXECUTED':
        # DELEGATE TO EXECUTOR
        response = TradeExecutor.execute_sell(
            user_id=current_user.id,
            symbol=trade_data['symbol'],
            quantity=trade_data['quantity'],
            price=trade_data['execution_price'],
            product_type=trade_data['product_type'],
            order_type=trade_data['order_type'],
            idempotency_key=idempotency_key,
            allow_short=allow_short
        )
    else:
        # PENDING ORDER
        response = TradeExecutor.create_pending_order(
            user_id=current_user.id,
            symbol=trade_data['symbol'],
            action='SELL',
            quantity=trade_data['quantity'],
            price=trade_data['execution_price'],
            order_type=trade_data['order_type'],
            product_type=trade_data['product_type'],
            stop_loss_price=trade_data['stop_loss_price'],
            target_price=trade_data['target_price'],
            trailing_stop_pct=trade_data['trailing_stop_pct'],
            idempotency_key=idempotency_key,
            bracket_order_type='ENTRY' if trade_data['order_type'] == 'BRACKET' else None
        )

    if response.get('success'):
        return jsonify(response), 200
    else:
        return jsonify(response), 400 if "Insufficient" in response.get('message', '') else 500


@trade_bp.route('/cancel-order/<order_id>', methods=['DELETE'])
@login_required
def cancel_order(order_id):
    """Cancel a pending order via TradeExecutor."""
    response = TradeExecutor.cancel_order(current_user.id, order_id)
    
    status = 200 if response.get('success') else 400
    if not response.get('success') and "not found" in response.get('message', '').lower():
        status = 404
        
    return jsonify(response), status


@trade_bp.route('/exit-plan', methods=['PATCH'])
@login_required
def update_exit_plan():
    """
    Create or update stoploss/target exit plan for an active holding.
    Delegates to TradeExecutor.modify_exit_plan for atomic OCO creation.
    """
    data = request.get_json() or {}

    symbol = data.get('symbol')
    if not symbol:
        return jsonify({"success": False, "message": "Symbol is required."}), 400

    product_type = (data.get('product_type') or 'CNC').upper()
    stop_order_id = data.get('stop_order_id')
    target_order_id = data.get('target_order_id')

    if not is_market_open():
        return jsonify({
            "success": False,
            "message": "Modify/exit is allowed only during market hours."
        }), 400

    try:
        stop_loss_price = float(data.get('stop_loss_price')) if data.get('stop_loss_price') else None
        target_price = float(data.get('target_price')) if data.get('target_price') else None
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Stoploss and target must be valid numbers."}), 400

    if not stop_loss_price and not target_price:
        return jsonify({"success": False, "message": "At least one of Stop Loss or Target price is required."}), 400

    # Ensure holding exists
    holding = Holding.objects(user=current_user, symbol=symbol, product_type=product_type).first()
    if not holding or holding.quantity <= 0:
        return jsonify({"success": False, "message": f"No active holding found for {symbol}."}), 404

    # --- Cancellation Logic for Existing Orders ---
    # Since modifying OCO is complex (sharing reservation), the safest way is to
    # CANCEL existing plans and create new ones with the remaining available quantity.
    
    if stop_order_id:
        TradeExecutor.cancel_order(current_user.id, stop_order_id)
    if target_order_id:
        TradeExecutor.cancel_order(current_user.id, target_order_id)
    
    # Reload holding to get fresh available quantity after cancellations
    holding.reload()
    available_qty = holding.quantity - holding.reserved_quantity
    
    if available_qty <= 0:
        return jsonify({"success": False, "message": "No available shares to protect (all reserved)."}), 400

    # --- Create New Plan via Executor ---
    response = TradeExecutor.modify_exit_plan(
        user_id=current_user.id,
        symbol=symbol,
        available_qty=available_qty,
        stop_price=stop_loss_price,
        target_price=target_price,
        product_type=product_type
    )

    if response.get('success'):
        return jsonify(response), 200
    else:
        return jsonify(response), 400


@trade_bp.route('/market-status', methods=['GET'])
def market_status():
    """Get current market status."""
    try:
        status_message = get_market_status_message()
        is_open = is_market_open()
        session = get_market_session()
        is_holiday = is_market_holiday()
        
        return jsonify({
            "success": True,
            "is_market_open": is_open,
            "session": session,
            "is_holiday": is_holiday,
            "status_message": status_message,
            "can_place_orders": bool(is_open),
        }), 200
    except Exception as e:
        logger.error(f"Error fetching market status: {e}", exc_info=True)
        return jsonify({"success": False, "message": "Failed to fetch market status"}), 500