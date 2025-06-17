import time
import logging
from decimal import Decimal, InvalidOperation
from app import create_app, db
from app.models import Transaction, Holding, User
from app.utils.scraper import get_stock_price
from threading import Thread

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class OrderProcessor:
    def __init__(self, interval=10):
        self.interval = interval  # Interval in seconds
        self.app = create_app()  # ✅ Initialize Flask app once

    def process_orders(self):
        """Continuously checks and executes pending orders."""
        while True:
            try:
                with self.app.app_context():  # ✅ Push app context before processing orders
                    self.execute_pending_orders()
            except Exception as e:
                logger.error(f"⚠️ Error in order processing: {e}")
            time.sleep(self.interval)

    def execute_pending_orders(self):
        """Fetches and processes pending limit/stop-loss orders."""
        try:
            pending_orders = db.session.execute(
                db.select(Transaction).filter(Transaction.status == "pending")
            ).scalars().all()
        except Exception as e:
            logger.error(f"⚠️ Database query error: {e}")
            return

        for order in pending_orders:
            stock_data = get_stock_price(order.symbol)

            if "error" in stock_data:
                logger.warning(f"⚠️ Error fetching price for {order.symbol}: {stock_data['error']}")
                continue

            try:
                current_price = Decimal(str(stock_data["price"])).quantize(Decimal("0.01"))
            except (KeyError, InvalidOperation):
                logger.error(f"⚠️ Invalid price format for {order.symbol}")
                continue

            execute_order = False
            if order.action == "buy" and order.limit_price and current_price <= order.limit_price:
                execute_order = True
            elif order.action == "sell" and order.limit_price and current_price >= order.limit_price:
                execute_order = True
            elif order.action == "sell" and order.stop_loss and current_price <= order.stop_loss:
                execute_order = True
            elif order.action == "buy" and order.stop_loss and current_price >= order.stop_loss:
                execute_order = True

            if execute_order:
                self.execute_order(order, current_price)

    def execute_order(self, order, execution_price):
        """Executes the order and updates the database."""
        try:
            user = db.session.execute(
                db.select(User).filter_by(id=order.user_id).with_for_update()
            ).scalar_one()

            if not user:
                logger.error(f"⚠️ User {order.user_id} not found.")
                return

            if order.action == "buy":
                total_cost = execution_price * order.quantity
                if user.balance < total_cost:
                    logger.warning(f"⛔ User {user.id} has insufficient balance for order {order.id}.")
                    return
                
                user.balance -= total_cost

                holding = db.session.execute(
                    db.select(Holding).filter_by(user_id=user.id, symbol=order.symbol).with_for_update()
                ).scalar_one_or_none()

                if holding:
                    new_quantity = holding.quantity + order.quantity
                    holding.average_price = ((holding.average_price * holding.quantity) + (execution_price * order.quantity)) / new_quantity
                    holding.quantity = new_quantity
                else:
                    new_holding = Holding(user_id=user.id, symbol=order.symbol, quantity=order.quantity, average_price=execution_price)
                    db.session.add(new_holding)

            elif order.action == "sell":
                holding = db.session.execute(
                    db.select(Holding).filter_by(user_id=user.id, symbol=order.symbol).with_for_update()
                ).scalar_one_or_none()

                if not holding or holding.quantity < order.quantity:
                    logger.warning(f"⛔ User {user.id} has insufficient holdings for order {order.id}.")
                    return
                
                holding.quantity -= order.quantity
                if holding.quantity == 0:
                    db.session.delete(holding)

                user.balance += execution_price * order.quantity

            # ✅ Update order status and execution price
            order.status = "executed"
            order.price = execution_price

            db.session.commit()
            logger.info(f"✅ Order {order.id} executed at {execution_price}")

        except Exception as e:
            db.session.rollback()
            logger.error(f"⚠️ Error executing order {order.id}: {e}")

def start_order_processor():
    """Starts the order processing thread."""
    processor = OrderProcessor()
    thread = Thread(target=processor.process_orders, daemon=True)
    thread.start()
