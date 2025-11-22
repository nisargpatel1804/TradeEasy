import time
import logging
from decimal import Decimal
from threading import Thread
from datetime import datetime
from app import create_app
from app.models import Transaction, Holding, User
from app.socket_manager import MO_WebSocket_Manager
# Import the centralized, cached function for all stock data lookups
from app.routes.stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(threadName)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OrderProcessor:
    """
    A background worker that continuously processes pending limit and stop-loss orders.
    It uses the application's centralized services for API access and data fetching.
    """
    def __init__(self, interval: int = 15):
        """Initializes the processor with a check interval."""
        self.interval = interval
        self.stop_thread = False
        self.app = create_app()  # Create a Flask app instance for the thread's context

    def run(self):
        """The main loop for the processor thread."""
        logger.info("🚀 Starting background order processor...")
        while not self.stop_thread:
            try:
                # Use the app context to ensure database and other extensions are available
                with self.app.app_context():
                    self._process_pending_orders()
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
        pending_orders = list(Transaction.objects(status="pending"))
        if not pending_orders:
            return

        logger.info(f"Checking {len(pending_orders)} pending order(s)...")
        
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
            if current_price and self._should_execute(order, current_price):
                self._execute_order(order, current_price)

    def _should_execute(self, order: Transaction, current_price: Decimal) -> bool:
        """Determines if an order should be executed based on its type and price."""
        limit_price = Decimal(str(order.price))
        if order.action == "BUY" and order.order_type == "LIMIT" and current_price <= limit_price:
            return True
        if order.action == "SELL" and order.order_type == "LIMIT" and current_price >= limit_price:
            return True
        # Add stop-loss logic here if needed in the future
        return False

    def _execute_order(self, order: Transaction, execution_price: Decimal):
        """
        Executes a trade and updates all relevant database records (User, Holding, Transaction).
        """
        try:
            user = User.objects(id=order.user.id).first()
            if not user:
                logger.error(f"User for order {order.id} not found. Failing order.")
                order.status = "failed"
                order.save()
                return

            total_amount = execution_price * Decimal(order.quantity)

            if order.action == "BUY":
                # Re-check balance at the moment of execution
                if Decimal(str(user.balance)) < total_amount:
                    logger.warning(f"Insufficient funds for user {user.client_id} on pending order {order.id}. Failing order.")
                    order.status = "failed"
                    order.save()
                    return
                
                user.balance -= float(total_amount)
                holding, _ = Holding.objects.get_or_create(user=user, symbol=order.symbol)
                
                # Update holding with weighted average price
                old_total_cost = Decimal(str(holding.average_price)) * Decimal(holding.quantity)
                new_total_cost = old_total_cost + total_amount
                holding.quantity += order.quantity
                holding.average_price = float(new_total_cost / Decimal(holding.quantity))
                holding.save()

            elif order.action == "SELL":
                holding = Holding.objects(user=user, symbol=order.symbol).first()
                if not holding or holding.quantity < order.quantity:
                    logger.warning(f"Insufficient shares for user {user.client_id} on pending order {order.id}. Failing order.")
                    order.status = "failed"
                    order.save()
                    return

                user.balance += float(total_amount)
                holding.quantity -= order.quantity
                if holding.quantity == 0:
                    holding.delete()
                else:
                    holding.save()
            
            # --- Finalize the Transaction ---
            order.status = "executed"
            order.price = float(execution_price) # Update with the actual execution price
            # order.executed_at = datetime.utcnow() # Assuming your model has this field
            
            user.save()
            order.save()
            logger.info(f"✅ Successfully executed pending order {order.id} for {order.symbol} at {execution_price}")

        except Exception as e:
            logger.error(f"A critical database error occurred while executing order {order.id}: {e}", exc_info=True)
            order.status = "failed"
            order.save()

def start_order_processor():
    """
    Initializes and starts the background order processing thread.
    This should be called from the main application entry point (e.g., run.py).
    """
    processor = OrderProcessor()
    thread = Thread(target=processor.run, name="OrderProcessorThread", daemon=True)
    thread.start()
    return processor # Return instance to allow for graceful shutdown
