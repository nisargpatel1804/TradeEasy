from flask import Blueprint, jsonify, session
from app.models import Transaction, User
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint('orders', __name__)

@bp.route('/orders', methods=['GET'])
def get_orders():
    """Fetches executed and pending orders for the logged-in user."""
    user_id = session.get('user_id')

    if not user_id:
        logger.warning("Unauthorized access attempt to /orders endpoint")
        return jsonify({"error": "Unauthorized"}), 401

    try:
        # Fetch user
        user = User.query.get(user_id)
        if not user:
            logger.error(f"User with ID {user_id} not found")
            return jsonify({"error": "User not found"}), 404

        # Fetch executed orders
        executed_orders = Transaction.query.filter_by(user_id=user.id, status="executed").order_by(Transaction.transaction_date.desc()).all()
        
        # Fetch pending orders
        pending_orders = Transaction.query.filter_by(user_id=user.id, status="pending").order_by(Transaction.transaction_date.desc()).all()

        # Serialize executed orders
        executed_orders_list = [
            {
                "symbol": order.symbol,
                "action": order.action,
                "quantity": order.quantity,
                "price": str(order.price),
                "transaction_date": order.transaction_date.isoformat()
            }
            for order in executed_orders
        ]

        # Serialize pending orders
        pending_orders_list = [
            {
                "symbol": order.symbol,
                "action": order.action,
                "quantity": order.quantity,
                "limit_price": str(order.limit_price) if order.limit_price else None,
                "stop_loss": str(order.stop_loss) if order.stop_loss else None,
                "transaction_date": order.transaction_date.isoformat()
            }
            for order in pending_orders
        ]

        return jsonify({
            "executed_orders": executed_orders_list,
            "pending_orders": pending_orders_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching orders for user {user_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500
