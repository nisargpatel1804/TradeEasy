import time
import logging
from decimal import Decimal
from threading import Thread
from datetime import datetime
from mongoengine import connect
from app import create_app
from app.models import Transaction, Holding, User, Lot, ShortPosition
from app.services.trade_executor import TradeExecutor
from app.services.market_time import should_auto_squareoff_mis, get_current_ist_time
from app.routes.stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(threadName)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OrderProcessor:
    """
    A background worker that continuously processes pending orders including:
    - LIMIT, STOP_LOSS, STOP_LIMIT, TRAILING_STOP orders
    - Auto square-off for MIS positions
    
    Delegates all execution state changes to the TradeExecutor service
    to ensure atomic database operations.
    """
    def __init__(self, interval: int = 10, app=None):
        """Initializes the processor with a check interval."""
        self.interval = interval
        # Use Event for interruptible sleep and graceful shutdown
        from threading import Event
        self._stop_event = Event()
        # Avoid creating the app during import; the caller should pass it to start_order_processor.
        self.app = app  # may be None; will be lazily created in run() if absent
        self.trailing_stop_triggers = {}
        self._last_auto_squareoff_date = None

    def run(self):
        """The main loop for the processor thread."""
        logger.info("🚀 Starting robust order processor...")
        while not self._stop_event.is_set():
            try:
                # Lazily create the app if not provided (avoids heavy work on import)
                if self.app is None:
                    from app import create_app
                    self.app = create_app()
                # Use the app context to ensure database and other extensions are available
                with self.app.app_context():
                    self._process_pending_orders()
                    self._check_auto_squareoff()
                    self._update_trailing_stops()
            except Exception as e:
                logger.error("An unexpected error occurred in the order processing loop", exc_info=True)
            
            # Wait interruptibly so shutdown can wake the loop immediately
            self._stop_event.wait(timeout=self.interval)
        logger.info("🛑 Background order processor has stopped.")

    def shutdown(self):
        """Signals the processor thread to stop."""
        self._stop_event.set()

    def _process_pending_orders(self):
        """
        Fetches all pending orders and checks if they can be executed.
        """
        # Fetch only PENDING orders that are NOT currently being processed
        pending_orders = list(Transaction.objects(status="PENDING", is_processing=False))
        if not pending_orders:
            return

        # --- Efficiently fetch prices for all unique symbols ---
        unique_symbols = {format_symbol(order.symbol) for order in pending_orders}
        price_map = {}
        for symbol in unique_symbols:
            api_data = get_stock_data_from_api(symbol)
            if api_data and api_data.get('ltp'):
                price_map[symbol] = Decimal(str(api_data['ltp']))

        if not price_map:
            return

        # --- Check each order against the fetched prices ---
        for order in pending_orders:
            symbol = format_symbol(order.symbol)
            current_price = price_map.get(symbol)
            
            if current_price:
                should_exec, exec_price = self._should_execute(order, current_price)
                if should_exec:
                    self._trigger_execution(order, exec_price)

    def _should_execute(self, order: Transaction, current_price: Decimal) -> tuple[bool, Decimal]:
        """
        Determines if an order should be executed based on its type and price.
        Returns: (should_execute, execution_price)
        """
        order_type = order.order_type
        action = order.action
        
        # LIMIT orders
        if order_type == "LIMIT":
            limit_price = Decimal(str(order.price))
            if action == "BUY" and current_price <= limit_price:
                return True, current_price
            if action == "SELL" and current_price >= limit_price:
                return True, current_price
        
        # STOP_LOSS orders
        elif order_type == "STOP_LOSS":
            stop_price = Decimal(str(order.stop_loss_price))
            if action == "BUY" and current_price >= stop_price:
                return True, current_price
            if action == "SELL" and current_price <= stop_price:
                return True, current_price
        
        # STOP_LIMIT orders
        elif order_type == "STOP_LIMIT":
            stop_price = Decimal(str(order.stop_loss_price))
            limit_price = Decimal(str(order.price))
            
            if action == "BUY":
                # Triggered if price >= stop, Execute if price <= limit
                if current_price >= stop_price:
                    if current_price <= limit_price:
                        return True, current_price
                    # Gap up logic: Triggered but price too high, remains pending
                    return False, Decimal('0')
            if action == "SELL":
                # Triggered if price <= stop, Execute if price >= limit
                if current_price <= stop_price:
                    if current_price >= limit_price:
                        return True, current_price
                    # Gap down logic
                    return False, Decimal('0')
        
        # TRAILING_STOP orders
        elif order_type == "TRAILING_STOP":
            if order.trailing_stop_trigger_price:
                trigger_price = Decimal(str(order.trailing_stop_trigger_price))
                if action == "SELL" and current_price <= trigger_price:
                    return True, current_price
                if action == "BUY" and current_price >= trigger_price:
                    return True, current_price
        
        return False, Decimal('0')

    def _trigger_execution(self, order: Transaction, execution_price: Decimal):
        """
        Delegates the actual execution logic to TradeExecutor.
        """
        logger.info(f"⚡ Triggering execution for Pending Order {order.id} @ {execution_price}")
        
        try:
            if order.action == 'BUY':
                # Determine how much was reserved so Executor can release it properly
                # For pending orders, 'price' is the limit/stop price at creation
                # We calculate reserved amount based on this stored price
                original_price = Decimal(str(order.price))
                reserved_amount = original_price * Decimal(order.quantity)
                
                TradeExecutor.execute_buy(
                    user_id=order.user.id,
                    symbol=order.symbol,
                    quantity=order.quantity,
                    price=execution_price,
                    product_type=order.product_type,
                    order_type=order.order_type,
                    transaction_id=str(order.id),
                    is_pending_execution=True,
                    reserved_amount=float(reserved_amount)
                )
                
            elif order.action == 'SELL':
                TradeExecutor.execute_sell(
                    user_id=order.user.id,
                    symbol=order.symbol,
                    quantity=order.quantity,
                    price=execution_price,
                    product_type=order.product_type,
                    order_type=order.order_type,
                    transaction_id=str(order.id),
                    is_pending_execution=True
                    # allow_short is False for pending triggers.
                    # Pending Sells typically imply exiting a position or opening a short if explicitly set up.
                    # Current logic assumes pending sell orders already have shares reserved in Holding.
                )
        except Exception as e:
            logger.error(f"Failed to trigger execution for order {order.id}: {e}", exc_info=True)

    def _update_trailing_stops(self):
        """Update trigger prices for trailing stop orders based on market movement."""
        trailing_orders = Transaction.objects(status="PENDING", order_type="TRAILING_STOP", is_processing=False)
        
        for order in trailing_orders:
            try:
                api_data = get_stock_data_from_api(order.symbol)
                if not api_data or not api_data.get('ltp'):
                    continue
                
                current_price = Decimal(str(api_data['ltp']))
                trail_pct = Decimal(str(order.trailing_stop_pct)) / Decimal('100')
                updated = False
                
                # Initialize trigger price if missing
                if not order.trailing_stop_trigger_price:
                    if order.action == "SELL":
                        initial_trigger = current_price * (Decimal('1') - trail_pct)
                    else:
                        initial_trigger = current_price * (Decimal('1') + trail_pct)
                    order.trailing_stop_trigger_price = float(initial_trigger)
                    updated = True

                if order.action == "SELL":
                    # Sell Trail: Trigger moves UP with price (locking in profit)
                    # New trigger = Current Price - X%
                    potential_new_trigger = current_price * (Decimal('1') - trail_pct)
                    
                    if potential_new_trigger > Decimal(str(order.trailing_stop_trigger_price)):
                        order.trailing_stop_trigger_price = float(potential_new_trigger)
                        updated = True
                            
                elif order.action == "BUY":
                    # Buy Trail: Trigger moves DOWN with price (getting cheaper entry)
                    # New trigger = Current Price + X%
                    potential_new_trigger = current_price * (Decimal('1') + trail_pct)
                    
                    if potential_new_trigger < Decimal(str(order.trailing_stop_trigger_price)):
                        order.trailing_stop_trigger_price = float(potential_new_trigger)
                        updated = True
                
                if updated:
                    order.save()
                    logger.debug(f"Updated trailing stop for {order.symbol}: {order.trailing_stop_trigger_price}")
            
            except Exception as e:
                logger.error(f"Error updating trailing stop for order {order.id}: {e}")

    def _check_auto_squareoff(self):
        """
        Auto square-off MIS (intraday) positions before market close.
        """
        now_ist = get_current_ist_time()
        if not should_auto_squareoff_mis(now_ist):
            return

        # Prevent running multiple times on the same day
        if self._last_auto_squareoff_date == now_ist.date():
            return
        
        logger.info("⏰ Auto square-off time reached for MIS positions...")
        
        try:
            # 1. Cancel ALL Pending MIS Orders
            # We must cancel pending orders first so they don't trigger while we are squaring off
            pending_mis = Transaction.objects(status="PENDING", product_type="MIS")
            for order in pending_mis:
                logger.info(f"Auto-cancelling pending MIS order {order.id}")
                TradeExecutor.cancel_order(order.user.id, str(order.id))

            # 2. Square off Holdings (Sell Longs)
            mis_holdings = Holding.objects(product_type='MIS')
            for holding in mis_holdings:
                # Calculate what is actually available (Quantity - Reserved)
                # Since we just cancelled all pending orders, Reserved SHOULD be 0.
                # But we check to be safe.
                qty_to_sell = holding.quantity - holding.reserved_quantity
                if qty_to_sell > 0:
                    self._force_square_off(
                        user_id=holding.user.id,
                        symbol=holding.symbol,
                        quantity=qty_to_sell,
                        action='SELL',
                        is_short_position=False
                    )
            
            # 3. Cover Short Positions (Buy Shorts)
            short_positions = ShortPosition.objects(is_active=True)
            for short_pos in short_positions:
                if short_pos.quantity > 0:
                    self._force_square_off(
                        user_id=short_pos.user.id,
                        symbol=short_pos.symbol,
                        quantity=short_pos.quantity,
                        action='BUY',
                        is_short_position=True
                    )
            
            self._last_auto_squareoff_date = now_ist.date()
            logger.info("✅ Auto square-off process completed.")
        
        except Exception as e:
            logger.error(f"Error during auto square-off sequence: {e}", exc_info=True)

    def _force_square_off(self, user_id, symbol, quantity, action, is_short_position):
        """
        Helper to execute market orders for auto square-off.
        """
        try:
            # Fetch current price
            api_data = get_stock_data_from_api(symbol)
            price = None
            if api_data and api_data.get('ltp'):
                price = float(api_data['ltp'])
            
            if not price:
                logger.error(f"Could not fetch price for auto-squareoff of {symbol}. Skipping.")
                return

            if action == 'SELL':
                TradeExecutor.execute_sell(
                    user_id=user_id,
                    symbol=symbol,
                    quantity=quantity,
                    price=price,
                    product_type='MIS',
                    order_type='MARKET'
                )
            elif action == 'BUY':
                TradeExecutor.execute_buy(
                    user_id=user_id,
                    symbol=symbol,
                    quantity=quantity,
                    price=price,
                    product_type='MIS',
                    order_type='MARKET'
                )
                
            logger.info(f"Squared off {symbol} ({action}) for user {user_id}")
            
        except Exception as e:
            logger.error(f"Failed to force square off {symbol}: {e}", exc_info=True)


def start_order_processor(app=None):
    """
    Initializes and starts the background order processing thread.
    """
    # Ensure we create app here rather than in OrderProcessor.__init__ to avoid heavy work on import
    if app is None:
        from app import create_app
        app = create_app()
    processor = OrderProcessor(app=app)
    thread = Thread(target=processor.run, name="OrderProcessorThread", daemon=True)
    processor._thread = thread
    thread.start()
    logger.info("✅ Order processor thread started")
    return processor