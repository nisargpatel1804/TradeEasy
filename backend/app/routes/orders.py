import logging
from datetime import timezone
from flask import Blueprint, jsonify
from flask_login import login_required, current_user
from app.models import Transaction

# --- Configuration ---
logger = logging.getLogger(__name__)
orders_bp = Blueprint('orders', __name__)

STATUS_KEYS = ("EXECUTED", "PENDING", "CANCELLED")


def _iso_utc(dt) -> str | None:
    if not dt:
        return None
    if getattr(dt, 'tzinfo', None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')

# --- Helper Function ---

def _format_order(order: Transaction) -> dict:
    """Formats a Transaction document into a clean dictionary for the API response."""
    status_value = (order.status or '').upper()
    # Prefer execution_date when available (this matches "when trade executed" for pending orders).
    primary_dt = order.execution_date or order.transaction_date
    formatted = {
        "id": str(order.id),
        "symbol": order.symbol,
        "action": order.action,
        "quantity": order.quantity,
        "price": float(order.price),
        "order_type": order.order_type,
        "status": status_value,
        "status_display": order.status,
        "date": _iso_utc(primary_dt),
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
        formatted["execution_date"] = _iso_utc(order.execution_date)
    
    return formatted

# --- API Route ---

@orders_bp.route('/orders', methods=['GET'])
@login_required
def get_orders():
    """
    Fetches the complete order history for the authenticated user, separated into
    executed, pending, and cancelled orders.
    """
    try:
        transactions = Transaction.objects(user=current_user).order_by('-transaction_date')

        grouped_orders = {key.lower(): [] for key in STATUS_KEYS}

        for order in transactions:
            formatted = _format_order(order)
            status_key = (order.status or '').upper()
            if status_key not in STATUS_KEYS:
                logger.warning(f"Unknown status '{status_key}' encountered for order {order.id}; coercing to CANCELLED")
                status_key = "CANCELLED"
            grouped_orders[status_key.lower()].append(formatted)

        response_payload = {"success": True, **grouped_orders}

        return jsonify(response_payload), 200

    except Exception as e:
        logger.error(f"Error fetching orders for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred while fetching your orders."}), 500


@orders_bp.route('/orders/<order_id>', methods=['GET'])
@login_required
def get_order_detail(order_id: str):
    """Fetch a single order by id for the authenticated user."""
    try:
        order = Transaction.objects(id=order_id, user=current_user).first()
        if not order:
            return jsonify({"success": False, "message": "Order not found."}), 404

        return jsonify({
            "success": True,
            "order": _format_order(order)
        }), 200
    except Exception as e:
        logger.error(f"Error fetching order {order_id} for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred while fetching the order."}), 500
