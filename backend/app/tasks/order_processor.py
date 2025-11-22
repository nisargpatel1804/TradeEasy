import time
import logging
from decimal import Decimal
from threading import Thread
from datetime import datetime
from mongoengine import connect
from app import create_app
from app.models import Transaction, Holding, User, Lot, ShortPosition
from app.socket_manager import MO_WebSocket_Manager
from app.utils.market_hours import should_auto_squareoff_mis
# Import the centralized, cached function for all stock data lookups
from app.routes.stock import get_stock_data_from_api, format_symbol
from app.routes.trade import _create_bracket_order_legs

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(threadName)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OrderProcessor:
    """
    A background worker that continuously processes pending orders including:
    - LIMIT orders
    - STOP_LOSS orders
    - STOP_LIMIT orders
    - TRAILING_STOP orders
    - BRACKET order legs
    - Auto square-off for MIS positions
    
    Uses MongoDB transactions for atomic operations to prevent race conditions.
    """
    def __init__(self, interval: int = 10):
        """Initializes the processor with a check interval."""
        self.interval = interval
        self.stop_thread = False
        self.app = create_app()  # Create a Flask app instance for the thread's context
        self.trailing_stop_triggers = {}  # Track trailing stop trigger prices

    def run(self):
        """The main loop for the processor thread."""
        logger.info("🚀 Starting advanced order processor...")
        while not self.stop_thread:
            try:
                # Use the app context to ensure database and other extensions are available
                with self.app.app_context():
                    self._process_pending_orders()
                    self._check_auto_squareoff()
                    self._update_trailing_stops()
            except Exception as e:
                logger.error(f"An unexpected error occurred in the order processing loop: {e}", exc_info=True)
            
            time.sleep(self.interval)
        logger.info("🛑 Background order processor has stopped.")

    def shutdown(self):
        """Signals the processor thread to stop."""
        self.stop_thread = True

    def _process_pending_orders(self):
        """
        Fetches all pending orders and efficiently checks if any can be executed
        by batching the price lookups.
        """
        pending_orders = list(Transaction.objects(status="PENDING"))
        if not pending_orders:
            return

        logger.debug(f"Checking {len(pending_orders)} pending order(s)...")
        
        # --- Efficiently fetch prices for all unique symbols in one go ---
        unique_symbols = {format_symbol(order.symbol) for order in pending_orders}
        price_map = {}
        for symbol in unique_symbols:
            # This is fast due to the lru_cache in get_stock_data_from_api
            api_data = get_stock_data_from_api(symbol)
            if api_data and api_data.get('ltp'):
                price_map[symbol] = Decimal(str(api_data['ltp']))

        if not price_map:
            logger.warning("Could not fetch live prices for any pending orders.")
            return

        # --- Check each order against the fetched prices ---
        for order in pending_orders:
            current_price = price_map.get(format_symbol(order.symbol))
            if current_price:
                should_exec, exec_price = self._should_execute(order, current_price)
                if should_exec:
                    self._execute_order(order, exec_price)

    def _should_execute(self, order: Transaction, current_price: Decimal) -> tuple[bool, Decimal]:
        """
        Determines if an order should be executed based on its type and price.
        
        Returns:
            tuple: (should_execute: bool, execution_price: Decimal)
        """
        order_type = order.order_type
        action = order.action
        
        # LIMIT orders
        if order_type == "LIMIT":
            limit_price = Decimal(str(order.price))
            if action == "BUY" and current_price <= limit_price:
                return True, current_price  # Execute at current price (better than limit)
            if action == "SELL" and current_price >= limit_price:
                return True, current_price  # Execute at current price (better than limit)
        
        # STOP_LOSS orders
        elif order_type == "STOP_LOSS":
            stop_price = Decimal(str(order.stop_loss_price))
            if action == "BUY" and current_price >= stop_price:
                # Stop-loss buy triggers when price goes up (e.g., breakout)
                return True, current_price
            if action == "SELL" and current_price <= stop_price:
                # Stop-loss sell triggers when price goes down (e.g., stop loss)
                return True, current_price
        
        # STOP_LIMIT orders
        elif order_type == "STOP_LIMIT":
            stop_price = Decimal(str(order.stop_loss_price))
            limit_price = Decimal(str(order.price))
            
            # CRITICAL FIX #6: Correct stop-limit logic - don't execute if price gaps beyond limit
            if action == "BUY":
                # Trigger when price reaches or exceeds stop price
                if current_price >= stop_price:
                    # Only execute if current price is at or below limit
                    if current_price <= limit_price:
                        return True, current_price
                    # Price gapped above limit - order remains pending
                    # In real market, this would stay open until limit is met
                    logger.debug(f"Stop-limit BUY triggered but not filled: price {current_price} > limit {limit_price}")
                    return False, Decimal('0')
            if action == "SELL":
                # Trigger when price reaches or falls below stop price
                if current_price <= stop_price:
                    # Only execute if current price is at or above limit
                    if current_price >= limit_price:
                        return True, current_price
                    # Price gapped below limit - order remains pending
                    logger.debug(f"Stop-limit SELL triggered but not filled: price {current_price} < limit {limit_price}")
                    return False, Decimal('0')
        
        # TRAILING_STOP orders (handled in _update_trailing_stops)
        elif order_type == "TRAILING_STOP":
            # Check if trigger price has been set and hit
            if order.trailing_stop_trigger_price:
                trigger_price = Decimal(str(order.trailing_stop_trigger_price))
                if action == "SELL" and current_price <= trigger_price:
                    return True, current_price
                if action == "BUY" and current_price >= trigger_price:
                    return True, current_price
        
        return False, Decimal('0')

    def _update_trailing_stops(self):
        """Update trigger prices for trailing stop orders based on market movement."""
        trailing_orders = Transaction.objects(
            status="PENDING",
            order_type="TRAILING_STOP"
        )
        
        for order in trailing_orders:
            try:
                api_data = get_stock_data_from_api(order.symbol)
                if not api_data or not api_data.get('ltp'):
                    continue
                
                current_price = Decimal(str(api_data['ltp']))
                trail_pct = Decimal(str(order.trailing_stop_pct)) / Decimal('100')
                
                if order.action == "SELL":
                    # For sell orders: trigger trails below highest price
                    # If price goes up, move stop-loss up
                    new_trigger = current_price * (Decimal('1') - trail_pct)
                    
                    # Initialize or update trigger price
                    if not order.trailing_stop_trigger_price:
                        order.trailing_stop_trigger_price = float(new_trigger)
                        order.save()
                        logger.info(f"Initialized trailing stop for SELL {order.symbol}: trigger @ {new_trigger}")
                    else:
                        old_trigger = Decimal(str(order.trailing_stop_trigger_price))
                        # Only move trigger up, never down
                        if new_trigger > old_trigger:
                            order.trailing_stop_trigger_price = float(new_trigger)
                            order.save()
                            logger.info(f"Updated trailing stop for SELL {order.symbol}: {old_trigger} -> {new_trigger}")
                
                elif order.action == "BUY":
                    # For buy orders: trigger trails above lowest price
                    # If price goes down, move stop-loss down
                    new_trigger = current_price * (Decimal('1') + trail_pct)
                    
                    if not order.trailing_stop_trigger_price:
                        order.trailing_stop_trigger_price = float(new_trigger)
                        order.save()
                        logger.info(f"Initialized trailing stop for BUY {order.symbol}: trigger @ {new_trigger}")
                    else:
                        old_trigger = Decimal(str(order.trailing_stop_trigger_price))
                        # Only move trigger down, never up
                        if new_trigger < old_trigger:
                            order.trailing_stop_trigger_price = float(new_trigger)
                            order.save()
                            logger.info(f"Updated trailing stop for BUY {order.symbol}: {old_trigger} -> {new_trigger}")
            
            except Exception as e:
                logger.error(f"Error updating trailing stop for order {order.id}: {e}", exc_info=True)

    def _check_auto_squareoff(self):
        """
        Auto square-off MIS (intraday) positions before market close.
        Executes at 3:25 PM IST (5 minutes before market close).
        """
        if not should_auto_squareoff_mis():
            return
        
        logger.info("⏰ Auto square-off time reached for MIS positions...")
        
        try:
            # Square off all active MIS holdings
            mis_holdings = Holding.objects(product_type='MIS')
            for holding in mis_holdings:
                self._squareoff_holding(holding, reason="AUTO_SQUAREOFF")
            
            # Cover all active short positions
            short_positions = ShortPosition.objects(is_active=True)
            for short_pos in short_positions:
                self._cover_short_position(short_pos, reason="AUTO_SQUAREOFF")
            
            # CRITICAL FIX #8: Cancel pending MIS orders and release reserves
            pending_mis_orders = Transaction.objects(
                status="PENDING",
                product_type="MIS"
            )
            for order in pending_mis_orders:
                try:
                    # Release reserved balance for BUY orders
                    if order.action == "BUY":
                        user = User.objects(id=order.user.id).first()
                        if user:
                            reserved_amount = Decimal(str(order.price)) * Decimal(order.quantity)
                            user.reserved_balance = max(0, float(Decimal(str(user.reserved_balance)) - reserved_amount))
                            user.save()
                            logger.info(f"Released reserved balance ₹{float(reserved_amount):.2f} for cancelled MIS order {order.id}")
                    # Release reserved quantity for SELL orders
                    elif order.action == "SELL":
                        holding = Holding.objects(user=order.user, symbol=order.symbol, product_type='MIS').first()
                        if holding and holding.reserved_quantity >= order.quantity:
                            holding.reserved_quantity -= order.quantity
                            holding.save()
                            logger.info(f"Released reserved quantity {order.quantity} for cancelled MIS order {order.id}")
                    
                    order.status = "cancelled"
                    order.save()
                    logger.info(f"Cancelled pending MIS order {order.id} during auto square-off")
                except Exception as cancel_error:
                    logger.error(f"Error cancelling MIS order {order.id} during auto square-off: {cancel_error}", exc_info=True)
        
        except Exception as e:
            logger.error(f"Error during auto square-off: {e}", exc_info=True)

    def _squareoff_holding(self, holding: Holding, reason="MANUAL"):
        """Square off an MIS holding by selling all shares.
        Handle market closure and suspended stocks.
        """
        try:
            user = holding.user
            symbol = holding.symbol
            quantity = holding.quantity
            
            # Get current market price
            api_data = get_stock_data_from_api(symbol)
            is_synthetic_price = False
            if not api_data or not api_data.get('ltp'):
                logger.error(f"CRITICAL: Cannot square off {symbol}: no market price available")
                # Use last known price or average price as fallback
                current_price = Decimal(str(holding.average_price))
                is_synthetic_price = True
                logger.warning(f"Using average price {current_price} for emergency square-off of {symbol}")
            else:
                # Check if stock is suspended or halted
                if api_data.get('issuspended') == 'Y' or api_data.get('isbanscrip') == 'Y':
                    logger.error(f"CRITICAL: Stock {symbol} is suspended/banned during square-off")
                    # Use last traded price or average as fallback
                    current_price = Decimal(str(holding.average_price))
                    is_synthetic_price = True
                    logger.warning(f"Using average price {current_price} for suspended stock square-off")
                else:
                    current_price = Decimal(str(api_data['ltp']))
            
            total_proceeds = current_price * Decimal(quantity)
            
            # Update user balance
            user.balance += float(total_proceeds)
            
            # Match and update lots for P&L calculation
            lots_to_match, cost_basis, remaining = self._match_lots_for_sell(
                user, symbol, quantity, 'MIS'
            )
            self._update_lots_after_sell(lots_to_match)
            
            # Create transaction record
            # Mark synthetic transactions for manual verification
            order_type_marker = 'MARKET_SYNTHETIC' if is_synthetic_price else 'MARKET'
            txn = Transaction(
                user=user,
                symbol=symbol,
                action='SELL',
                quantity=quantity,
                price=float(current_price),
                status='EXECUTED',
                order_type=order_type_marker,
                product_type='MIS',
                execution_date=datetime.utcnow()
            )
            txn.save()
            
            # Delete holding
            holding.delete()
            user.save()
            
            logger.info(f"✅ {reason}: Squared off MIS holding {symbol} x{quantity} @{current_price}")
        
        except Exception as e:
            logger.error(f"Error squaring off holding {holding.symbol}: {e}", exc_info=True)

    def _cover_short_position(self, short_pos: ShortPosition, reason="MANUAL"):
        """Cover a short position by buying back shares.
        Handle market closure and suspended stocks.
        """
        try:
            user = short_pos.user
            symbol = short_pos.symbol
            quantity = short_pos.quantity
            short_price = Decimal(str(short_pos.short_price))
            
            # Get current market price
            api_data = get_stock_data_from_api(symbol)
            is_synthetic_price = False
            if not api_data or not api_data.get('ltp'):
                logger.error(f"CRITICAL: Cannot cover short {symbol}: no market price available")
                # Use short price as fallback (break-even)
                current_price = short_price
                is_synthetic_price = True
                logger.warning(f"Using short price {current_price} for emergency short cover of {symbol}")
            else:
                # Check if stock is suspended or halted
                if api_data.get('issuspended') == 'Y' or api_data.get('isbanscrip') == 'Y':
                    logger.error(f"CRITICAL: Stock {symbol} is suspended/banned during short cover")
                    current_price = short_price
                    is_synthetic_price = True
                    logger.warning(f"Using short price {current_price} for suspended stock short cover")
                else:
                    current_price = Decimal(str(api_data['ltp']))
            
            total_cost = current_price * Decimal(quantity)
            
            # Calculate P&L (profit if price went down) for reporting only
            pnl = (short_price - current_price) * Decimal(quantity)
            
            user.balance -= float(total_cost)
            
            # Create transaction record
            # Mark synthetic transactions for manual verification
            order_type_marker = 'MARKET_SYNTHETIC' if is_synthetic_price else 'MARKET'
            txn = Transaction(
                user=user,
                symbol=symbol,
                action='BUY',
                quantity=quantity,
                price=float(current_price),
                status='EXECUTED',
                order_type=order_type_marker,
                product_type='MIS',
                execution_date=datetime.utcnow()
            )
            txn.save()
            
            # Close short position
            short_pos.is_active = False
            short_pos.save()
            user.save()
            
            logger.info(f"✅ {reason}: Covered short position {symbol} x{quantity} @{current_price}, P&L: {pnl}")
        
        except Exception as e:
            logger.error(f"Error covering short position {short_pos.symbol}: {e}", exc_info=True)

    def _match_lots_for_sell(self, user, symbol, quantity, product_type):
        """Match lots in FIFO order for selling.
        Validates lot consistency.
        """
        lots_to_match = []
        remaining_qty = quantity
        total_cost_basis = Decimal('0')
        
        available_lots = Lot.objects(
            user=user,
            symbol=symbol,
            product_type=product_type,
            quantity__gt=0,
            is_active=True
        ).order_by('purchase_date')
        
        # Validate total lot quantity
        total_lot_qty = sum(lot.quantity for lot in available_lots)
        holding = Holding.objects(user=user, symbol=symbol, product_type=product_type).first()
        holding_qty = holding.quantity if holding else 0
        
        if total_lot_qty != holding_qty:
            logger.error(
                f"LOT CONSISTENCY ERROR: User {user.client_id} {symbol} {product_type} - "
                f"Lot total: {total_lot_qty}, Holding: {holding_qty}"
            )
            # Use the minimum to prevent over-selling
            if quantity > min(total_lot_qty, holding_qty):
                raise ValueError(f"Data inconsistency detected. Cannot sell {quantity} shares.")
        
        for lot in available_lots:
            if remaining_qty <= 0:
                break
            
            qty_from_lot = min(remaining_qty, lot.quantity)
            lots_to_match.append((lot, qty_from_lot))
            
            cost_from_lot = Decimal(str(lot.purchase_price)) * Decimal(qty_from_lot)
            total_cost_basis += cost_from_lot
            
            remaining_qty -= qty_from_lot
        
        return lots_to_match, total_cost_basis, remaining_qty

    def _update_lots_after_sell(self, lots_to_match):
        """Update lot quantities after selling."""
        for lot, qty_sold in lots_to_match:
            lot.quantity -= qty_sold
            if lot.quantity == 0:
                lot.is_active = False
            lot.save()

    def _execute_order(self, order: Transaction, execution_price: Decimal):
        """
        Executes a pending order and updates all relevant database records.
        Uses idempotency key to prevent duplicate executions.
        Improved atomic operation handling.
        """
        try:
            # CRITICAL FIX #5: Check idempotency before execution
            if order.idempotency_key:
                existing_executed = Transaction.objects(
                    idempotency_key=order.idempotency_key,
                    status="EXECUTED"
                ).first()
                if existing_executed and str(existing_executed.id) != str(order.id):
                    logger.error(f"Duplicate execution detected! Order {order.id} has same idempotency key as {existing_executed.id}")
                    # Release reserved resources before marking as failed
                    if order.action == "BUY":
                        user = order.user
                        reserved_amount = Decimal(str(order.price)) * Decimal(order.quantity)
                        user.reserved_balance = max(0, float(Decimal(str(user.reserved_balance)) - reserved_amount))
                        user.save()
                    elif order.action == "SELL":
                        holding = Holding.objects(user=order.user, symbol=order.symbol, product_type=order.product_type).first()
                        if holding and holding.reserved_quantity >= order.quantity:
                            holding.reserved_quantity -= order.quantity
                            holding.save()
                    order.status = "failed"
                    order.save()
                    return
            
            # Atomic status update with validation
            # This prevents two threads from executing the same order
            result = Transaction.objects(id=order.id, status="PENDING").update_one(
                set__status="processing"
            )
            
            if result == 0:
                # Order was already processed or cancelled by another thread
                logger.debug(f"Order {order.id} already processed or cancelled")
                return
            
            # Must reload to get fresh data after atomic update
            order.reload()
            if order.status != "processing":
                logger.warning(f"Order {order.id} status changed after reload: {order.status}")
                return
            
            # Validate stock is still tradeable
            api_data = get_stock_data_from_api(order.symbol)
            if not api_data:
                logger.error(f"Stock {order.symbol} not found or delisted. Failing order {order.id}")
                order.status = "failed"
                order.save()
                return
            
            # Check if stock is suspended or halted
            if api_data.get('issuspended') == 'Y' or api_data.get('isbanscrip') == 'Y':
                logger.error(f"Stock {order.symbol} is suspended/banned. Failing order {order.id}")
                order.status = "failed"
                order.save()
                return

            user = User.objects(id=order.user.id).first()
            if not user:
                logger.error(f"User for order {order.id} not found. Failing order.")
                order.status = "failed"
                order.save()
                return

            total_amount = execution_price * Decimal(order.quantity)
            product_type = order.product_type if hasattr(order, 'product_type') else 'CNC'
            
            # Track whether we need to release reserved balance
            should_release_reserved = (order.action == "BUY")
            execution_successful = False
            reserved_released = False
            reserved_amount = Decimal(str(order.price if getattr(order, 'price', None) else execution_price)) * Decimal(order.quantity)

            try:
                # Execute based on action
                if order.action == "BUY":
                    # Release the exact amount we reserved at order placement
                    current_reserved_balance = Decimal(str(user.reserved_balance))
                    user.reserved_balance = float(max(current_reserved_balance - reserved_amount, Decimal('0')))
                    reserved_released = True

                    user_balance = Decimal(str(user.balance))
                    quantity_remaining = order.quantity
                    shares_added = 0

                    if user_balance < total_amount:
                        logger.warning(
                            f"Insufficient funds for order {order.id}. Required: {total_amount}, Available: {user.balance}. Failing order."
                        )
                        order.status = "failed"
                        order.save()
                        user.save()
                        return

                    # Cover short positions first for MIS
                    if product_type == 'MIS':
                        short_pos = ShortPosition.objects(
                            user=user,
                            symbol=order.symbol,
                            is_active=True
                        ).first()

                        if short_pos:
                            qty_to_cover = min(quantity_remaining, short_pos.quantity)
                            if qty_to_cover > 0:
                                cover_cost = execution_price * Decimal(qty_to_cover)
                                
                                # Track P&L for logging, but settle using the actual buyback cost
                                short_price = Decimal(str(short_pos.short_price))
                                pnl = (short_price - execution_price) * Decimal(qty_to_cover)

                                if user_balance < cover_cost:
                                    raise ValueError(
                                        f"Insufficient funds to cover short position. Required: {float(cover_cost):.2f}, Available: {float(user_balance):.2f}"
                                    )

                                user_balance -= cover_cost
                                short_pos.quantity -= qty_to_cover
                                if short_pos.quantity == 0:
                                    short_pos.is_active = False
                                short_pos.save()
                                
                                quantity_remaining -= qty_to_cover
                                logger.info(f"Covered short via order {order.id}: {qty_to_cover} of {order.symbol}, P&L: {pnl}")
                                
                                if quantity_remaining == 0:
                                    user.balance = float(user_balance)
                                    user.save()
                                    order.status = "EXECUTED"
                                    order.price = float(execution_price)
                                    order.execution_date = datetime.utcnow()
                                    order.save()
                                    self._cancel_bracket_legs(order)
                                    execution_successful = True
                                    return

                    if quantity_remaining > 0:
                        total_cost = execution_price * Decimal(quantity_remaining)
                        if user_balance < total_cost:
                            raise ValueError("Insufficient funds to complete order")

                        user_balance -= total_cost

                        holding = Holding.objects(user=user, symbol=order.symbol, product_type=product_type).first()
                        if holding:
                            # CRITICAL FIX #26: Reload to prevent race condition with concurrent orders
                            holding.reload()
                            old_total_cost = Decimal(str(holding.average_price)) * Decimal(holding.quantity)
                            new_total_cost = old_total_cost + total_cost
                            holding.quantity += quantity_remaining
                            holding.average_price = float(new_total_cost / Decimal(holding.quantity))
                            holding.save()
                        else:
                            holding = Holding(
                                user=user,
                                symbol=order.symbol,
                                quantity=quantity_remaining,
                                average_price=float(execution_price),
                                product_type=product_type
                            )
                            holding.save()

                        shares_added = quantity_remaining

                        lot = Lot(
                            user=user,
                            symbol=order.symbol,
                            quantity=shares_added,
                            original_quantity=shares_added,
                            purchase_price=float(execution_price),
                            purchase_date=datetime.utcnow(),
                            purchase_transaction=order,
                            product_type=product_type,
                            is_active=True
                        )
                        lot.save()

                    user.balance = float(user_balance)

                elif order.action == "SELL":
                    # Re-validate holdings before execution (holdings may have changed since order placed)
                    holding = Holding.objects(user=user, symbol=order.symbol, product_type=product_type).first()
                    
                    if not holding or holding.quantity < order.quantity:
                        logger.warning(f"Insufficient shares for order {order.id}. Failing order.")
                        order.status = "failed"
                        order.save()
                        # CRITICAL FIX #2: Release reserved_quantity on failed sell
                        if holding and holding.reserved_quantity >= order.quantity:
                            holding.reserved_quantity -= order.quantity
                            holding.save()
                            logger.info(f"Released reserved quantity {order.quantity} for failed order {order.id}")
                        return

                    # Normal sell
                    lots_to_match, cost_basis, remaining = self._match_lots_for_sell(
                        user, order.symbol, order.quantity, product_type
                    )
                    self._update_lots_after_sell(lots_to_match)
                    
                    user.balance += float(total_amount)
                    holding.quantity -= order.quantity
                    
                    # CRITICAL FIX #2: Always release reserved_quantity on successful sell
                    if holding.reserved_quantity >= order.quantity:
                        holding.reserved_quantity -= order.quantity
                        logger.debug(f"Released reserved quantity {order.quantity} for order {order.id}")
                    else:
                        logger.warning(f"Reserved quantity mismatch for {order.symbol}: reserved={holding.reserved_quantity}, selling={order.quantity}")
                        holding.reserved_quantity = max(0, holding.reserved_quantity)
                    
                    # Validate no negative quantities
                    if holding.quantity < 0:
                        logger.error(f"CRITICAL: Negative holding quantity for {order.symbol}: {holding.quantity}")
                        raise ValueError("Data corruption: negative holding quantity")
                    
                    if holding.quantity == 0:
                        holding.delete()
                    else:
                        holding.save()
                
                # Finalize transaction
                order.status = "EXECUTED"
                # CRITICAL FIX #9: Preserve original price, store execution price separately
                if not order.original_price:
                    order.original_price = order.price  # Store original limit/stop price
                order.price = float(execution_price)  # Update to actual execution price
                order.execution_date = datetime.utcnow()
                
                user.save()
                order.save()
                
                # Mark execution as successful
                execution_successful = True
                
                logger.info(f"✅ Executed order {order.id}: {order.action} {order.quantity} of {order.symbol} @{execution_price}")

                # Ensure AMO bracket entries spawn their protection legs after delayed execution
                if order.order_type == "BRACKET" and not order.parent_order_id:
                    self._ensure_bracket_protection(order)
                
                # If this is a bracket order leg, cancel the other leg
                if order.parent_order_id:
                    self._cancel_bracket_legs(order)
                
            except Exception as inner_e:
                # Ensure reserved balance is released on failure
                logger.error(f"Error during order execution: {inner_e}", exc_info=True)
                execution_successful = False
                # Mark order as failed before cleanup
                try:
                    order.reload()
                    if order.status == "processing":
                        order.status = "failed"
                        order.save()
                except Exception as mark_error:
                    logger.error(f"Could not mark order {order.id} as failed: {mark_error}", exc_info=True)
                raise  # Re-raise to outer exception handler
            
            finally:
                # Always release reserved balance/quantity on failure
                if not execution_successful:
                    if should_release_reserved and not reserved_released:
                        try:
                            user.reload()  # Get fresh user data
                            updated_reserved = Decimal(str(user.reserved_balance)) - reserved_amount
                            user.reserved_balance = float(max(updated_reserved, Decimal('0')))
                            user.save()
                            logger.info(f"Released reserved balance ₹{float(reserved_amount):.2f} for failed order {order.id}")
                        except Exception as cleanup_error:
                            logger.critical(f"CRITICAL: Failed to release reserved balance: {cleanup_error}", exc_info=True)
                    
                    # Release reserved_quantity for failed sell orders
                    if order.action == "SELL":
                        try:
                            holding = Holding.objects(user=user, symbol=order.symbol, product_type=product_type).first()
                            if holding and holding.reserved_quantity >= order.quantity:
                                holding.reserved_quantity -= order.quantity
                                holding.save()
                                logger.info(f"Released reserved quantity {order.quantity} for failed sell order {order.id}")
                        except Exception as cleanup_error:
                            logger.critical(f"CRITICAL: Failed to release reserved quantity: {cleanup_error}", exc_info=True)

        except Exception as e:
            logger.error(f"Critical error executing order {order.id}: {e}", exc_info=True)
            # Reload to ensure we have latest state before marking as failed
            try:
                order.reload()
                if order.status == "processing":
                    order.status = "failed"
                    order.save()
            except:
                logger.error(f"Could not mark order {order.id} as failed", exc_info=True)

    def _cancel_bracket_legs(self, executed_order):
        """Cancel the opposite leg of a bracket order when one leg executes.
        More robust error handling for leg cancellation.
        CRITICAL FIX #14: Release reserved resources for cancelled legs.
        """
        try:
            if not executed_order.parent_order_id:
                return
            
            # Find sibling legs
            sibling_legs = Transaction.objects(
                parent_order_id=executed_order.parent_order_id,
                status="PENDING"
            )
            
            # Cancel all legs atomically where possible
            cancelled_count = 0
            failed_cancellations = []
            
            for leg in sibling_legs:
                if str(leg.id) != str(executed_order.id):
                    try:
                        # CRITICAL FIX #14: Release reserved resources before cancelling
                        if leg.action == "BUY":
                            user = User.objects(id=leg.user.id).first()
                            if user:
                                leg_price = Decimal(str(leg.price))
                                leg_amount = leg_price * Decimal(leg.quantity)
                                user.reserved_balance = max(0, float(Decimal(str(user.reserved_balance)) - leg_amount))
                                user.save()
                                logger.info(f"Released reserved balance ₹{float(leg_amount):.2f} for cancelled bracket leg {leg.id}")
                        elif leg.action == "SELL":
                            product_type = leg.product_type if hasattr(leg, 'product_type') else 'CNC'
                            holding = Holding.objects(user=leg.user, symbol=leg.symbol, product_type=product_type).first()
                            if holding and holding.reserved_quantity >= leg.quantity:
                                holding.reserved_quantity -= leg.quantity
                                holding.save()
                                logger.info(f"Released reserved quantity {leg.quantity} for cancelled bracket leg {leg.id}")
                        
                        # Use atomic update to prevent race conditions
                        result = Transaction.objects(id=leg.id, status="PENDING").update_one(
                            set__status="cancelled"
                        )
                        if result > 0:
                            cancelled_count += 1
                            logger.info(f"Cancelled bracket leg {leg.id} after {executed_order.bracket_order_type} execution")
                        else:
                            failed_cancellations.append(str(leg.id))
                            logger.warning(f"Could not cancel bracket leg {leg.id} - already processed")
                    except Exception as leg_error:
                        failed_cancellations.append(str(leg.id))
                        logger.error(f"Error cancelling bracket leg {leg.id}: {leg_error}", exc_info=True)
            
            if failed_cancellations:
                logger.error(f"CRITICAL: Failed to cancel some bracket legs: {failed_cancellations}")
        
        except Exception as e:
            logger.error(f"Error cancelling bracket legs: {e}", exc_info=True)

    def _ensure_bracket_protection(self, order: Transaction):
        """Create stop-loss/target legs for bracket entries executed by the processor."""
        try:
            user = User.objects(id=order.user.id).first()
            if not user:
                raise RuntimeError(f"User {order.user.id} not found for bracket order {order.id}")
            trade_data = {
                "symbol": order.symbol,
                "quantity": order.quantity,
                "product_type": order.product_type,
                "stop_loss_price": order.stop_loss_price,
                "target_price": order.target_price
            }
            _create_bracket_order_legs(user, order, trade_data)
            logger.info(f"Created bracket protection legs for order {order.id}")
        except Exception as leg_error:
            logger.error(
                f"CRITICAL: Failed to create bracket legs for order {order.id}: {leg_error}",
                exc_info=True
            )
            self._rollback_bracket_entry(order, leg_error)
            raise

    def _rollback_bracket_entry(self, order: Transaction, root_error=None):
        """Rollback executed bracket entry when protection legs cannot be created."""
        try:
            user = User.objects(id=order.user.id).first()
            if not user:
                logger.critical(f"Rollback aborted: user {order.user.id} missing for order {order.id}")
                return

            lots = list(Lot.objects(purchase_transaction=order))
            total_qty = sum(lot.original_quantity for lot in lots)
            invested_amount = sum(
                Decimal(str(lot.purchase_price)) * Decimal(lot.original_quantity)
                for lot in lots
            )

            if total_qty == 0:
                logger.warning(
                    f"No lots found for bracket rollback on order {order.id}; assuming full quantity"
                )
                total_qty = order.quantity
                invested_amount = Decimal(str(order.price)) * Decimal(order.quantity)

            holding = Holding.objects(user=user, symbol=order.symbol, product_type=order.product_type).first()
            if holding:
                holding.reload()
                holding.reserved_quantity = max(0, holding.reserved_quantity - total_qty)
                new_quantity = max(0, holding.quantity - total_qty)
                current_total_cost = Decimal(str(holding.average_price)) * Decimal(holding.quantity)
                new_total_cost = current_total_cost - invested_amount
                if new_quantity > 0 and new_total_cost > 0:
                    holding.quantity = new_quantity
                    holding.average_price = float(new_total_cost / Decimal(new_quantity))
                    holding.save()
                else:
                    holding.delete()

            for lot in lots:
                lot.delete()

            user.reload()
            user.balance = float(Decimal(str(user.balance)) + invested_amount)
            user.save()

            Transaction.objects(parent_order_id=str(order.id)).delete()

            order.reload()
            order.status = "failed"
            order.execution_date = None
            if order.original_price is not None:
                order.price = float(order.original_price)
            order.save()

            logger.info(
                f"Rolled back bracket order {order.id} after leg creation failure: {root_error}"
            )
        except Exception as rollback_error:
            logger.critical(
                f"CRITICAL: Failed to rollback bracket order {order.id}: {rollback_error}",
                exc_info=True
            )


def start_order_processor():
    """
    Initializes and starts the background order processing thread.
    This should be called from the main application entry point (e.g., run.py).
    """
    processor = OrderProcessor()
    thread = Thread(target=processor.run, name="OrderProcessorThread", daemon=True)
    thread.start()
    logger.info("✅ Order processor thread started")
    return processor  # Return instance to allow for graceful shutdown
