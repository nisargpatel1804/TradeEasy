from flask import Blueprint, jsonify
from flask_login import login_required, current_user
from app.models import Transaction
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint('orders', __name__)

@bp.route('/orders', methods=['GET'])
@login_required
def get_orders():
    """Fetches executed and pending orders for the authenticated user."""
    try:
        # Using current_user proxy for secure, session-based user fetching
        executed = Transaction.objects(user=current_user, status="executed").order_by('-transaction_date')
        pending = Transaction.objects(user=current_user, status="pending").order_by('-transaction_date')

        executed_list = [
            {
                "id": str(order.id), "symbol": order.symbol, "action": order.action,
                "quantity": order.quantity, "price": float(order.price),
                "date": order.transaction_date.isoformat(), "order_type": order.order_type
            } for order in executed
        ]

        pending_list = [
            {
                "id": str(order.id), "symbol": order.symbol, "action": order.action,
                "quantity": order.quantity, "limit_price": float(order.limit_price) if order.limit_price else None,
                "stop_loss": float(order.stop_loss) if order.stop_loss else None,
                "date": order.transaction_date.isoformat(), "order_type": order.order_type
            } for order in pending
        ]

        return jsonify({
            "executed_orders": executed_list,
            "pending_orders": pending_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching orders for user {current_user.client_id}: {e}")
        return jsonify({"error": "An internal error occurred while fetching your orders."}), 500
