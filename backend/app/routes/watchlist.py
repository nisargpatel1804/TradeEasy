import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from mongoengine.errors import NotUniqueError

from app.models import User, Stock, Watchlist, Holding, ShortPosition
from app.socket_manager import MO_WebSocket_Manager
from app.services.cache import cached_route, cache as app_cache
from app.services.reset_guard import is_user_reset_in_progress
from .stock import format_symbol

# --- Configuration ---
logger = logging.getLogger(__name__)
watchlist_bp = Blueprint('watchlist', __name__)

# --- Constants ---
MAX_WATCHLISTS_PER_USER = 10
MAX_STOCKS_PER_WATCHLIST = 50

# --- Helper Functions ---

def _serialize_stock(stock: Stock | None) -> dict | None:
    if not stock:
        return None
    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "exchange": stock.exchange,
        "scripcode": stock.scripcode,
    }

def _serialize_watchlist(watchlist: Watchlist) -> dict:
    return {
        "name": watchlist.name,
        "is_deletable": watchlist.is_deletable,
        "stocks": [
            stock_payload
            for stock_payload in (
                _serialize_stock(stock)
                for stock in getattr(watchlist, "stocks", [])
            )
            if stock_payload
        ],
    }

def _get_watchlist_or_404(user: User, watchlist_name: str) -> Watchlist | None:
    return next((wl for wl in user.watchlists if wl.name == watchlist_name), None)

def _is_stock_tracked_elsewhere(stock: Stock) -> bool:
    """
    Checks whether the given stock is still referenced anywhere needing live ticks.
    Live subscriptions are global (not per-user). We should only unsubscribe a scrip
    when it is not referenced in *any* watchlist and not present in *any* active
    holding/short position.
    """
    if User.objects(watchlists__stocks=stock).only("id").first() is not None:
        return True

    symbol = getattr(stock, 'symbol', None)
    if not symbol:
        return False

    if Holding.objects(symbol=symbol, quantity__gt=0).only('id').first() is not None:
        return True

    if ShortPosition.objects(symbol=symbol, is_active=True).only('id').first() is not None:
        return True

    return False

def _is_user_resetting(user_id) -> bool:
    return is_user_reset_in_progress(user_id)

def _reset_in_progress_response():
    return jsonify({
        "success": False,
        "message": "Portfolio reset in progress. Watchlist changes are temporarily blocked."
    }), 423

# FIXED: Removed 'user:' from the string to correctly match cache.py route pattern
def _invalidate_watchlist_cache(user_id):
    """Drops the cached GET /watchlists response for this user."""
    app_cache.invalidate_pattern(f"route:get_watchlists:{user_id}")

def _find_tracked_symbols_bulk(symbols):
    """
    Returns the set of symbols still referenced in any holding or active short
    (two bulk queries instead of N individual ones).
    """
    if not symbols:
        return set()
    tracked = set()
    tracked |= set(Holding.objects(symbol__in=symbols, quantity__gt=0).scalar('symbol'))
    tracked |= set(ShortPosition.objects(symbol__in=symbols, is_active=True).scalar('symbol'))
    return tracked


# --- API Routes ---

@watchlist_bp.route('/watchlists', methods=['GET'])
@login_required
@cached_route(ttl=120)
def get_watchlists():
    """Fetches all watchlists and the symbols of the stocks they contain."""
    try:
        watchlists_data = [
            _serialize_watchlist(watchlist)
            for watchlist in current_user.watchlists
        ]
        return jsonify({"success": True, "watchlists": watchlists_data}), 200
    except Exception as e:
        logger.error(f"Error fetching watchlists for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists', methods=['POST'])
@login_required
def create_watchlist():
    """Creates a new, empty watchlist for the current user."""
    if _is_user_resetting(current_user.id):
        return _reset_in_progress_response()

    data = request.get_json()
    name = str(data.get('name', '')).strip()

    if not name:
        return jsonify({"success": False, "message": "Watchlist name is required."}), 400

    user = User.objects.get(id=current_user.id)

    if len(user.watchlists) >= MAX_WATCHLISTS_PER_USER:
        return jsonify({
            "success": False, 
            "message": f"You have reached the maximum of {MAX_WATCHLISTS_PER_USER} watchlists."
        }), 409

    if any(wl.name.lower() == name.lower() for wl in user.watchlists):
        return jsonify({
            "success": False, 
            "message": "A watchlist with this name already exists.", 
            "error_code": "DUPLICATE_WATCHLIST"
        }), 409

    try:
        user.watchlists.append(Watchlist(name=name, is_deletable=True, stocks=[]))
        user.save()
        _invalidate_watchlist_cache(user.id)
        created_watchlist = _get_watchlist_or_404(user, name)
        logger.info("User %s created new watchlist: '%s'", user.client_id, name)
        
        return jsonify({
            "success": True,
            "message": "Watchlist created successfully.",
            "watchlist": _serialize_watchlist(created_watchlist)
        }), 201
    except Exception as e:
        logger.error("Error creating watchlist for user %s: %s", user.client_id, e, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks', methods=['POST'])
@login_required
def add_stock_to_watchlist(watchlist_name):
    """Adds a stock to a specific watchlist and triggers a real-time data subscription."""
    if _is_user_resetting(current_user.id):
        return _reset_in_progress_response()

    data = request.get_json() or {}
    symbol_input = data.get('symbol')

    if not symbol_input:
        return jsonify({"success": False, "message": "Stock symbol is required."}), 400

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if len(target_watchlist.stocks) >= MAX_STOCKS_PER_WATCHLIST:
        return jsonify({
            "success": False, 
            "message": f"Watchlist limit of {MAX_STOCKS_PER_WATCHLIST} stocks reached."
        }), 409

    try:
        scripcode = data.get("scripcode")

        if scripcode in (None, ""):
            return jsonify({
                "success": False, 
                "message": "Scripcode is required.", 
                "error_code": "MISSING_INSTRUMENT_FIELDS"
            }), 400

        try:
            scripcode = int(scripcode)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "Invalid scripcode.", "error_code": "INVALID_SCRIPCODE"}), 400

        if scripcode <= 0 or scripcode > 99999999:
            return jsonify({"success": False, "message": "Invalid scripcode range.", "error_code": "INVALID_SCRIPCODE"}), 400

        exchange = 'NSE'

        clean_symbol = format_symbol(symbol_input)
        resolved_name = (data.get("name") or "").strip() or clean_symbol

        # Persist or update the Stock document first, then atomically add to the user's watchlist
        stock = Stock.objects(scripcode=int(scripcode), exchange=exchange).first()
        if not stock:
            stock = Stock(
                symbol=f"{clean_symbol}.NSE",
                name=resolved_name,
                exchange='NSE',
                scripcode=int(scripcode)
            )
            try:
                stock.save()
            except NotUniqueError:
                stock = Stock.objects(scripcode=int(scripcode), exchange=exchange).first()
                if not stock:
                    raise
        else:
            updates_required = False
            preferred_name = resolved_name
            if preferred_name and stock.name != preferred_name:
                stock.name = preferred_name
                updates_required = True
            if not stock.is_active:
                stock.is_active = True
                updates_required = True
            if updates_required:
                stock.save()

        if any(s and s.id == stock.id for s in target_watchlist.stocks):
            return jsonify({
                "success": False, 
                "message": "Stock is already in this watchlist.", 
                "error_code": "DUPLICATE_STOCK"
            }), 409

        target_watchlist.stocks.append(stock)
        user.save()
        _invalidate_watchlist_cache(user.id)

        # --- Trigger Real-Time Subscription ---
        socket_manager = MO_WebSocket_Manager()
        subscription_result = socket_manager.register_scrip(
            symbol=stock.symbol, 
            exchange=stock.exchange, 
            scripcode=stock.scripcode
        )

        logger.info(f"User {user.client_id} added {stock.symbol} to watchlist '{watchlist_name}'")
        updated_watchlist = _serialize_watchlist(target_watchlist)

        response = {
            "success": True,
            "message": "Stock added successfully.",
            "stock": _serialize_stock(stock),
            "watchlist": updated_watchlist,
            "subscription": subscription_result
        }

        # If subscription failed, inform the client in the message to surface in UI
        if not subscription_result.get('success'):
            response['message'] = f"Stock added successfully, but live updates may be unavailable: {subscription_result.get('message')}"

        return jsonify(response), 201

    except Exception as e:
        logger.error(f"Error adding stock to watchlist '{watchlist_name}': {e}", exc_info=True)
        return jsonify({
            "success": False, 
            "message": "An internal server error occurred.", 
            "error_code": "INTERNAL_ERROR"
        }), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks/<string:symbol>', methods=['DELETE'])
@login_required
def remove_stock_from_watchlist(watchlist_name, symbol):
    """Removes a stock from a watchlist and unsubscribes from its real-time feed."""
    if _is_user_resetting(current_user.id):
        return _reset_in_progress_response()

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404

    stock_to_remove = next((s for s in target_watchlist.stocks if s and s.symbol == symbol), None)
    if not stock_to_remove:
        return jsonify({"success": False, "message": "Stock not found in this watchlist."}), 404
        
    try:
        target_watchlist.stocks.remove(stock_to_remove)
        user.save()
        _invalidate_watchlist_cache(user.id)
        
        # --- Unsubscribe from the real-time feed ---
        socket_manager = MO_WebSocket_Manager()
        if not _is_stock_tracked_elsewhere(stock_to_remove):
            socket_manager.unregister_scrip(
                exchange=stock_to_remove.exchange, 
                scripcode=stock_to_remove.scripcode
            )
        else:
            logger.info(
                "Skipping unsubscription for %s; still tracked in other watchlists.",
                stock_to_remove.symbol
            )

        logger.info(f"User {user.client_id} removed {symbol} from watchlist '{watchlist_name}'")
        updated_watchlist = _serialize_watchlist(target_watchlist)
        return jsonify({
            "success": True,
            "message": "Stock removed successfully.",
            "watchlist": updated_watchlist
        }), 200
        
    except Exception as e:
        logger.error(f"Error removing stock from watchlist '{watchlist_name}': {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>', methods=['DELETE'])
@login_required
def delete_watchlist(watchlist_name):
    """Deletes an entire watchlist for the current user."""
    if _is_user_resetting(current_user.id):
        return _reset_in_progress_response()

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if not target_watchlist.is_deletable:
        return jsonify({"success": False, "message": "This watchlist cannot be deleted."}), 403

    try:
        # Collect stocks before modifying state so we can check them after the save
        stocks_to_check = [s for s in target_watchlist.stocks if s and s.symbol]

        # Persist the removal FIRST — _is_stock_tracked_elsewhere queries the DB, so
        # the check must run after the watchlist is gone from the user's document,
        # otherwise the query always finds the current user and skips unsubscription.
        user.watchlists.remove(target_watchlist)
        user.save()
        _invalidate_watchlist_cache(user.id)

        # Batch-check holdings and shorts (2 bulk queries instead of 2 per stock)
        socket_manager = MO_WebSocket_Manager()
        if stocks_to_check:
            symbols = [s.symbol for s in stocks_to_check]
            bulk_tracked = _find_tracked_symbols_bulk(symbols)
            for stock in stocks_to_check:
                if stock.symbol in bulk_tracked:
                    logger.info("Skipping unsubscription for %s; still in holdings/shorts.", stock.symbol)
                    continue
                # Per-stock watchlist check (only runs when not already blocked above)
                if User.objects(watchlists__stocks=stock).only('id').first() is not None:
                    logger.info("Skipping unsubscription for %s; still in another watchlist.", stock.symbol)
                    continue
                socket_manager.unregister_scrip(exchange=stock.exchange, scripcode=stock.scripcode)
                logger.info("Unsubscribed from %s (not tracked elsewhere)", stock.symbol)

        logger.info(f"User {user.client_id} deleted watchlist: '{watchlist_name}'")
        return jsonify({"success": True, "message": "Watchlist deleted successfully."}), 200
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>', methods=['PATCH'])
@login_required
def rename_watchlist(watchlist_name: str):
    """Renames an existing watchlist while enforcing uniqueness."""
    if _is_user_resetting(current_user.id):
        return _reset_in_progress_response()

    data = request.get_json() or {}
    new_name = str(data.get('new_name', '')).strip()

    if not new_name:
        return jsonify({"success": False, "message": "New watchlist name is required."}), 400

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)
    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if not target_watchlist.is_deletable:
        return jsonify({"success": False, "message": "This watchlist cannot be renamed."}), 403
    if target_watchlist.name == new_name:
        return jsonify({
            "success": True, 
            "message": "Watchlist name is unchanged.", 
            "watchlist": _serialize_watchlist(target_watchlist)
        }), 200

    if any(
        wl is not target_watchlist and wl.name.lower() == new_name.lower()
        for wl in user.watchlists
    ):
        return jsonify({"success": False, "message": "Another watchlist already uses this name."}), 409

    try:
        target_watchlist.name = new_name
        user.save()
        _invalidate_watchlist_cache(user.id)
        logger.info("User %s renamed watchlist '%s' to '%s'", user.client_id, watchlist_name, new_name)
        return jsonify({
            "success": True,
            "message": "Watchlist renamed successfully.",
            "watchlist": _serialize_watchlist(target_watchlist)
        }), 200
    except Exception as e:
        logger.error("Error renaming watchlist '%s' for user %s: %s", watchlist_name, user.client_id, e, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500