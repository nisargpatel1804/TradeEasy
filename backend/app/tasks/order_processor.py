import time
import logging
from decimal import Decimal, InvalidOperation
from threading import Thread
from app import create_app
from app.models import Transaction, Holding, User
from app.moapi.mo_api import MotilalOswalAPI

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class OrderProcessor:
    """
    A background worker that continuously processes pending limit and stop-loss orders.
    """
    def __init__(self, interval=15):
        """
        Initializes the processor with a check interval.
        """
        self.interval = interval
        self.app = create_app()  # Create a Flask app instance for the thread
        self.mo_api = MotilalOswalAPI()

    def process_orders(self):
        """
        The main loop for the processor thread. It logs into the API once and then
        periodically checks for orders to execute.
        """
        with self.app.app_context():
            # Log in to the trading API once when the thread starts.
            if not self.mo_api.login():
                logger.critical("OrderProcessor could not log in to Motilal Oswal API. The thread will not start.")
                return
            logger.info("OrderProcessor successfully logged into MO API.")

        while True:
            try:
                with self.app.app_context():
                    self.execute_pending_orders()
            except Exception as e:
                logger.error(f"An unexpected error occurred in the main order processing loop: {e}")
            time.sleep(self.interval)

    def execute_pending_orders(self):
        """
        Fetches all pending orders and checks if any can be executed based on the
        current market price obtained from the API.
        """
        pending_orders = Transaction.objects(status="pending")
        if not pending_orders:
            return # No pending orders to process

        logger.info(f"Found {len(pending_orders)} pending orders to check.")
        for order in pending_orders:
            response = self.mo_api.get_ltp_data("NSE", order.symbol)

            if not response or response.get('status') != 'SUCCESS':
                logger.warning(f"Could not fetch live price for {order.symbol} to process order {order.id}.")
                continue

            try:
                current_price = Decimal(str(response['data'].get('ltp', 0))) / 100
            except (KeyError, InvalidOperation):
                logger.error(f"Invalid price format received from API for {order.symbol}. Skipping order {order.id}.")
                continue

            if self._should_execute(order, current_price):
                self._execute_order(order, current_price)

    def _should_execute(self, order, current_price):
        """
        Determines if an order should be executed based on its type and the current price.
        """
        if order.action == "buy" and order.limit_price and current_price <= order.limit_price:
            return True
        if order.action == "sell" and order.limit_price and current_price >= order.limit_price:
            return True
        if order.action == "sell" and order.stop_loss and current_price <= order.stop_loss:
            return True
        return False

    def _execute_order(self, order, execution_price):
        """
        Executes a trade and updates all relevant database records (User, Holding, Transaction).
        The logic here is a mirror of the logic in `trade.py` for consistency.
        """
        try:
            user = User.objects(id=order.user.id).first()
            if not user:
                logger.error(f"User for order {order.id} not found. Failing order.")
                order.status = "failed"
                order.save()
                return

            total_amount = execution_price * Decimal(order.quantity)

            if order.action == "buy":
                if user.balance < total_amount:
                    logger.warning(f"Insufficient funds for user {user.client_id} on pending order {order.id}. Failing order.")
                    order.status = "failed"
                    order.save()
                    return
                
                user.balance -= total_amount
                holding = Holding.objects(user=user, symbol=order.symbol).first()

                if holding:
                    # Update existing holding with weighted average
                    old_total_cost = holding.average_price * holding.quantity
                    new_total_cost = old_total_cost + total_amount
                    holding.quantity += order.quantity
                    holding.average_price = new_total_cost / holding.quantity
                else:
                    # Create a new holding
                    holding = Holding(user=user, symbol=order.symbol, quantity=order.quantity, average_price=execution_price)
                holding.save()

            elif order.action == "sell":
                holding = Holding.objects(user=user, symbol=order.symbol).first()
                if not holding or holding.quantity < order.quantity:
                    logger.warning(f"Insufficient shares for user {user.client_id} on pending order {order.id}. Failing order.")
                    order.status = "failed"
                    order.save()
                    return

                user.balance += total_amount
                holding.quantity -= order.quantity
                if holding.quantity == 0:
                    holding.delete()
                else:
                    holding.save()
            
            # Update the transaction to mark it as executed
            order.status = "executed"
            order.price = execution_price
            order.executed_at = datetime.utcnow()
            
            user.save()
            order.save()
            logger.info(f"Successfully executed pending order {order.id} for {order.symbol} at price {execution_price}")

        except Exception as e:
            logger.error(f"A critical database error occurred while executing order {order.id}: {e}")
            order.status = "failed"
            order.save()

def start_order_processor():
    """
    Function to be called from the main application run script to start the
    background order processing thread.
    """
    processor = OrderProcessor()
    thread = Thread(target=processor.process_orders, daemon=True)
    thread.start()
    logger.info("Background order processor thread has been started.")

