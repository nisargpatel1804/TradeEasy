import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine.errors import NotUniqueError

from app.models import User, Stock, Watchlist
from app.socket_manager import MO_WebSocket_Manager
from app.utils.cache import cached_route, cache as app_cache
# Import the centralized, cached function for resolving stock data
from .stock import get_stock_data_from_api, format_symbol

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


def _invalidate_watchlist_cache(user_id: str) -> None:
    """Bust the cached response for the user's watchlists."""
    app_cache.invalidate_pattern(f"route:get_watchlists:user:{user_id}")


def _get_watchlist_or_404(user: User, watchlist_name: str) -> Watchlist | None:
    return next((wl for wl in user.watchlists if wl.name == watchlist_name), None)


def _is_stock_tracked_elsewhere(stock: Stock) -> bool:
    """Checks whether the given stock is still referenced in any watchlist."""
    # Use only('id') to minimize the fields pulled back from MongoDB.
    return User.objects(watchlists__stocks=stock).only("id").first() is not None


# --- API Routes ---

@watchlist_bp.route('/watchlists', methods=['GET'])
@login_required
@cached_route(ttl=30)  # Cache for 30 seconds
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
    data = request.get_json()
    name = str(data.get('name', '')).strip()

    if not name:
        return jsonify({"success": False, "message": "Watchlist name is required."}), 400

    user = User.objects.get(id=current_user.id)
    if len(user.watchlists) >= MAX_WATCHLISTS_PER_USER:
        return jsonify({"success": False, "message": f"You have reached the maximum of {MAX_WATCHLISTS_PER_USER} watchlists."}), 409
    if any(wl.name.lower() == name.lower() for wl in user.watchlists):
        return jsonify({"success": False, "message": "A watchlist with this name already exists."}), 409

    try:
        new_watchlist = Watchlist(name=name, is_deletable=True)
        user.watchlists.append(new_watchlist)
        user.save()
        
        _invalidate_watchlist_cache(current_user.id)
        
        logger.info(f"User {user.client_id} created new watchlist: '{name}'")
        return jsonify({
            "success": True,
            "message": "Watchlist created successfully.",
            "watchlist": _serialize_watchlist(new_watchlist)
        }), 201
    except Exception as e:
        logger.error(f"Error creating watchlist for user {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks', methods=['POST'])
@login_required
def add_stock_to_watchlist(watchlist_name):
    """
    Adds a stock to a specific watchlist and triggers a real-time data subscription
    by leveraging the centralized stock data function.
    """
    data = request.get_json()
    symbol_input = data.get('symbol')

    if not symbol_input:
        return jsonify({"success": False, "message": "Stock symbol is required."}), 400

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if len(target_watchlist.stocks) >= MAX_STOCKS_PER_WATCHLIST:
        return jsonify({"success": False, "message": f"Watchlist limit of {MAX_STOCKS_PER_WATCHLIST} stocks reached."}), 409

    try:
        # --- Centralized Data Fetching ---
        api_data = get_stock_data_from_api(symbol_input)
        if not api_data:
            return jsonify({"success": False, "message": f"Could not find a valid instrument for symbol '{format_symbol(symbol_input)}'."}), 404
        
        scripcode = api_data['scripcode']
        exchange = api_data['exchange']
        full_symbol = f"{api_data['symbol']}.{exchange}"

        if any(
            s and s.scripcode == scripcode and s.exchange == exchange
            for s in target_watchlist.stocks
        ):
            return jsonify({"success": False, "message": "Stock is already in this watchlist."}), 409

        # Use the resolved data to create or update the Stock document
        # Since symbol is the primary key, we need to handle get_or_create differently
        stock = Stock.objects(scripcode=scripcode, exchange=exchange).first()
        if not stock:
            stock = Stock(
                symbol=full_symbol,
                name=data.get('name') or api_data['symbol'],
                exchange=exchange,
                scripcode=scripcode
            )
            try:
                stock.save()
            except NotUniqueError:
                stock = Stock.objects(scripcode=scripcode, exchange=exchange).first()
                if not stock:
                    raise
        else:
            # Refresh key metadata on the existing document when supplied
            updates_required = False
            preferred_name = data.get('name') or api_data['symbol']
            if preferred_name and stock.name != preferred_name:
                stock.name = preferred_name
                updates_required = True
            if not stock.is_active:
                stock.is_active = True
                updates_required = True
            if updates_required:
                stock.save()
        
        target_watchlist.stocks.append(stock)
        user.save()

        _invalidate_watchlist_cache(current_user.id)

        # --- Trigger Real-Time Subscription ---
        socket_manager = MO_WebSocket_Manager()
        socket_manager.register_scrip(
            symbol=stock.symbol, 
            exchange=stock.exchange, 
            scripcode=stock.scripcode
        )
        
        logger.info(f"User {user.client_id} added {stock.symbol} to watchlist '{watchlist_name}'")
        updated_watchlist = _serialize_watchlist(target_watchlist)
        return jsonify({
            "success": True,
            "message": "Stock added successfully.",
            "stock": _serialize_stock(stock),
            "watchlist": updated_watchlist
        }), 201

    except Exception as e:
        logger.error(f"Error adding stock to watchlist '{watchlist_name}': {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks/<string:symbol>', methods=['DELETE'])
@login_required
def remove_stock_from_watchlist(watchlist_name, symbol):
    """Removes a stock from a watchlist and unsubscribes from its real-time feed."""
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
        _invalidate_watchlist_cache(current_user.id)
    
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
    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if not target_watchlist.is_deletable:
        return jsonify({"success": False, "message": "This watchlist cannot be deleted."}), 403

    try:
        # Unsubscribe from stocks that are not tracked in other watchlists
        socket_manager = MO_WebSocket_Manager()
        for stock in target_watchlist.stocks:
            if stock and not _is_stock_tracked_elsewhere(stock):
                socket_manager.unregister_scrip(exchange=stock.exchange, scripcode=stock.scripcode)
                logger.info(f"Unsubscribed from {stock.symbol} (not tracked elsewhere)")
            elif stock:
                logger.info(f"Skipping unsubscription for {stock.symbol}; still tracked in other watchlists.")

        user.watchlists.remove(target_watchlist)
        user.save()
        _invalidate_watchlist_cache(current_user.id)
        
        logger.info(f"User {user.client_id} deleted watchlist: '{watchlist_name}'")
        return jsonify({"success": True, "message": "Watchlist deleted successfully."}), 200
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>', methods=['PATCH'])
@login_required
def rename_watchlist(watchlist_name: str):
    """Renames an existing watchlist while enforcing uniqueness."""
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
        return jsonify({"success": True, "message": "Watchlist name is unchanged.", "watchlist": _serialize_watchlist(target_watchlist)}), 200

    if any(
        wl is not target_watchlist and wl.name.lower() == new_name.lower()
        for wl in user.watchlists
    ):
        return jsonify({"success": False, "message": "Another watchlist already uses this name."}), 409

    try:
        old_name = target_watchlist.name
        target_watchlist.name = new_name
        user.save()
        _invalidate_watchlist_cache(current_user.id)
        logger.info("User %s renamed watchlist '%s' to '%s'", user.client_id, old_name, new_name)
        return jsonify({
            "success": True,
            "message": "Watchlist renamed successfully.",
            "watchlist": _serialize_watchlist(target_watchlist)
        }), 200
    except Exception as e:
        logger.error("Error renaming watchlist '%s' for user %s: %s", watchlist_name, user.client_id, e, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks/reorder', methods=['POST'])
@login_required
def reorder_watchlist_stocks(watchlist_name: str):
    """Reorders the stocks inside a specific watchlist based on provided symbols."""
    data = request.get_json() or {}
    requested_order = data.get('symbols')

    if not isinstance(requested_order, list) or not requested_order:
        return jsonify({"success": False, "message": "An ordered list of stock symbols is required."}), 400

    user = User.objects.get(id=current_user.id)
    target_watchlist = _get_watchlist_or_404(user, watchlist_name)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404

    existing_symbols = [stock.symbol for stock in target_watchlist.stocks if stock]
    if len(requested_order) != len(existing_symbols):
        return jsonify({"success": False, "message": "Order list must include every stock."}), 400

    if len(set(requested_order)) != len(requested_order):
        return jsonify({"success": False, "message": "Duplicate symbols detected in order list."}), 400

    symbol_lookup = {stock.symbol: stock for stock in target_watchlist.stocks if stock}

    try:
        new_order = [symbol_lookup[symbol] for symbol in requested_order]
    except KeyError:
        return jsonify({"success": False, "message": "Order list references unknown symbols."}), 404

    target_watchlist.stocks = new_order
    try:
        user.save()
        _invalidate_watchlist_cache(current_user.id)
        logger.info("User %s reordered stocks within watchlist '%s'", user.client_id, watchlist_name)
        return jsonify({
            "success": True,
            "message": "Watchlist stocks reordered successfully.",
            "watchlist": _serialize_watchlist(target_watchlist)
        }), 200
    except Exception as e:
        logger.error("Error reordering stocks for watchlist '%s' (user %s): %s", watchlist_name, user.client_id, e, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@watchlist_bp.route('/watchlists/reorder', methods=['POST'])
@login_required
def reorder_watchlists():
    """Reorders a user's watchlists based on a provided sequence of names."""
    data = request.get_json() or {}
    requested_order = data.get('order')

    if not isinstance(requested_order, list) or not requested_order:
        return jsonify({"success": False, "message": "An ordered list of watchlist names is required."}), 400

    user = User.objects.get(id=current_user.id)
    current_watchlists = list(user.watchlists)

    if len(requested_order) != len(current_watchlists):
        return jsonify({"success": False, "message": "Order list must include every watchlist."}), 400

    lookup = {wl.name: wl for wl in current_watchlists}

    try:
        new_order = [lookup[name] for name in requested_order]
    except KeyError:
        return jsonify({"success": False, "message": "Order list references an unknown watchlist."}), 404

    if len(set(requested_order)) != len(requested_order):
        return jsonify({"success": False, "message": "Order list contains duplicate names."}), 400

    try:
        user.watchlists = new_order
        user.save()
        _invalidate_watchlist_cache(current_user.id)
        logger.info("User %s reordered their watchlists", user.client_id)
        return jsonify({
            "success": True,
            "message": "Watchlists reordered successfully.",
            "watchlists": [_serialize_watchlist(wl) for wl in user.watchlists]
        }), 200
    except Exception as e:
        logger.error("Error reordering watchlists for user %s: %s", user.client_id, e, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
