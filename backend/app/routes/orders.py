import logging
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from app.models import Transaction

# --- Configuration ---
logger = logging.getLogger(__name__)
orders_bp = Blueprint('orders', __name__)

# --- Helper Function ---

def _format_order(order: Transaction) -> dict:
    """Formats a Transaction document into a clean dictionary for the API response."""
    formatted = {
        "id": str(order.id),
        "symbol": order.symbol,
        "action": order.action,
        "quantity": order.quantity,
        "price": float(order.price),
        "order_type": order.order_type,
        "status": order.status,
        "date": order.transaction_date.isoformat(),
        "product_type": order.product_type if hasattr(order, 'product_type') else 'CNC'
    }
    
    # Add advanced order fields if present
    if order.stop_loss_price:
        formatted["stop_loss_price"] = float(order.stop_loss_price)
    if order.target_price:
        formatted["target_price"] = float(order.target_price)
    if order.trailing_stop_pct:
        formatted["trailing_stop_pct"] = float(order.trailing_stop_pct)
    if order.execution_date:
        formatted["execution_date"] = order.execution_date.isoformat()
    
    return formatted

# --- API Route ---

@orders_bp.route('/orders', methods=['GET'])
@login_required
def get_orders():
    """
    Fetches the complete order history for the authenticated user, separated into
    executed and pending orders.
    """
    try:
        # Securely query for orders belonging only to the current logged-in user
        # Sort by date in descending order to show the most recent orders first
        executed_orders = Transaction.objects(
            user=current_user,
            status="EXECUTED"
        ).order_by('-transaction_date')

        pending_orders = Transaction.objects(
            user=current_user,
            status="PENDING"
        ).order_by('-transaction_date')

        # Format the query results into a clean list of dictionaries
        executed_list = [_format_order(order) for order in executed_orders]
        pending_list = [_format_order(order) for order in pending_orders]

        return jsonify({
            "success": True,
            "executed": executed_list,
            "pending": pending_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching orders for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred while fetching your orders."}), 500
