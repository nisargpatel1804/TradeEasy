import logging
from datetime import datetime, timezone
from typing import Optional
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from mongoengine.queryset.visitor import Q

from app.models import Transaction

# --- Configuration ---
logger = logging.getLogger(__name__)
orders_bp = Blueprint('orders', __name__)

STATUS_KEYS = ("EXECUTED", "PENDING", "CANCELLED")
MAX_ORDERS_LIMIT = 1000
DEFAULT_ORDERS_LIMIT = 100


def _iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Convert datetime object to ISO 8601 string in UTC timezone."""
    if not dt:
        return None
    if getattr(dt, 'tzinfo', None) is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def _parse_since(value: str) -> Optional[datetime]:
    """
    Parse 'since' query parameter into a UTC datetime object.
    Supports Unix epoch timestamps (seconds/milliseconds) and ISO strings.
    """
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None

    # Accept unix seconds or milliseconds
    if raw.isdigit():
        as_int = int(raw)
        if as_int > 10_000_000_000:
            as_int = as_int / 1000.0
        return datetime.fromtimestamp(as_int, tz=timezone.utc)

    normalized = raw.replace('Z', '+00:00')
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _format_order(order: Transaction) -> dict:
    """Formats a Transaction document into a clean dictionary for API serialization."""
    status_value = (order.status or '').upper()
    # Prefer execution_date when available (matches "when trade executed" for pending orders)
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
        "transaction_date": _iso_utc(order.transaction_date),
        "product_type": getattr(order, 'product_type', 'CNC') or 'CNC',
    }

    # Add advanced order parameters if present
    if getattr(order, 'stop_loss_price', None) is not None:
        formatted["stop_loss_price"] = float(order.stop_loss_price)
    if getattr(order, 'target_price', None) is not None:
        formatted["target_price"] = float(order.target_price)
    if getattr(order, 'trailing_stop_pct', None) is not None:
        formatted["trailing_stop_pct"] = float(order.trailing_stop_pct)
    if getattr(order, 'trailing_stop_trigger_price', None) is not None:
        formatted["trailing_stop_trigger_price"] = float(order.trailing_stop_trigger_price)
    if getattr(order, 'execution_date', None) is not None:
        formatted["execution_date"] = _iso_utc(order.execution_date)
    if getattr(order, 'bracket_order_type', None):
        formatted["bracket_order_type"] = order.bracket_order_type
    if getattr(order, 'metadata', None):
        formatted["metadata"] = order.metadata

    return formatted


# --- API Routes ---

@orders_bp.route('/orders', methods=['GET'])
@login_required
def get_orders():
    """
    Fetches order history for the authenticated user, structured by execution status.

    Optional query parameters:
      - status: EXECUTED | PENDING | CANCELLED (case-insensitive)
      - limit: Positive integer (default 100, max 1000)
      - since: ISO timestamp or Unix epoch timestamp
    """
    try:
        status_filter = str(request.args.get('status', '') or '').strip().upper()
        raw_limit = str(request.args.get('limit', '') or '').strip()
        raw_since = str(request.args.get('since', '') or '').strip()
        limit = DEFAULT_ORDERS_LIMIT
        since_dt = None

        if raw_limit:
            try:
                parsed = int(raw_limit)
                if parsed > 0:
                    limit = min(parsed, MAX_ORDERS_LIMIT)
            except (TypeError, ValueError):
                limit = DEFAULT_ORDERS_LIMIT

        if raw_since:
            try:
                since_dt = _parse_since(raw_since)
            except Exception:
                return jsonify({"success": False, "message": "Invalid 'since' timestamp format."}), 400

        grouped_orders = {key.lower(): [] for key in STATUS_KEYS}
        base_qs = Transaction.objects(user=current_user)

        if since_dt:
            base_qs = base_qs.filter(
                Q(transaction_date__gte=since_dt) | Q(execution_date__gte=since_dt)
            )

        if status_filter and status_filter in STATUS_KEYS:
            qs = base_qs.filter(status=status_filter).order_by('-transaction_date')
            if limit:
                qs = qs[:limit]

            grouped_orders[status_filter.lower()] = [_format_order(order) for order in qs]
            return jsonify({
                "success": True,
                **grouped_orders,
                "meta": {
                    "status": status_filter,
                    "limit": limit,
                    "since": _iso_utc(since_dt),
                },
            }), 200

        transactions = base_qs.order_by('-transaction_date')
        if limit:
            transactions = transactions[:limit]

        for order in transactions:
            formatted = _format_order(order)
            status_key = (order.status or '').upper()
            if status_key not in STATUS_KEYS:
                logger.warning(
                    f"Unknown status '{status_key}' for order {order.id}; mapping to CANCELLED"
                )
                status_key = "CANCELLED"
            grouped_orders[status_key.lower()].append(formatted)

        return jsonify({
            "success": True,
            **grouped_orders,
            "meta": {
                "status": None,
                "limit": limit,
                "since": _iso_utc(since_dt),
            },
        }), 200

    except Exception as e:
        logger.error(f"Error fetching orders for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "An internal server error occurred while fetching your orders."
        }), 500


@orders_bp.route('/orders/<order_id>', methods=['GET'])
@login_required
def get_order_detail(order_id: str):
    """Fetches details for a single order by ID for the authenticated user."""
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
        return jsonify({
            "success": False,
            "message": "An internal server error occurred while fetching order details."
        }), 500