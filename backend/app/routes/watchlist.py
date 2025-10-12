import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import User, Stock, Watchlist
from app.socket_manager import MO_WebSocket_Manager
# Import the centralized, cached function for resolving stock data
from .stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logger = logging.getLogger(__name__)
watchlist_bp = Blueprint('watchlist', __name__)

# --- Constants ---
MAX_WATCHLISTS_PER_USER = 10
MAX_STOCKS_PER_WATCHLIST = 50

# --- API Routes ---

@watchlist_bp.route('/watchlists', methods=['GET'])
@login_required
def get_watchlists():
    """Fetches all watchlists and the symbols of the stocks they contain."""
    try:
        watchlists_data = []
        for watchlist in current_user.watchlists:
            # For efficiency, only return the essential data. The frontend will
            # receive live price updates via the WebSocket connection.
            stocks_data = [
                {"symbol": stock.symbol, "name": stock.name}
                for stock in watchlist.stocks if stock
            ]
            watchlists_data.append({
                "name": watchlist.name,
                "is_deletable": watchlist.is_deletable,
                "stocks": stocks_data
            })
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
        logger.info(f"User {user.client_id} created new watchlist: '{name}'")
        return jsonify({
            "success": True,
            "message": "Watchlist created successfully.",
            "watchlist": {"name": name, "is_deletable": True, "stocks": []}
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
    target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if len(target_watchlist.stocks) >= MAX_STOCKS_PER_WATCHLIST:
        return jsonify({"success": False, "message": f"Watchlist limit of {MAX_STOCKS_PER_WATCHLIST} stocks reached."}), 409

    try:
        # --- Centralized Data Fetching ---
        api_data = get_stock_data_from_api(symbol_input)
        if not api_data:
            return jsonify({"success": False, "message": f"Could not find a valid instrument for symbol '{format_symbol(symbol_input)}'."}), 404
        
        full_symbol = f"{api_data['symbol']}.{api_data['exchange']}"
        
        if any(s and s.symbol == full_symbol for s in target_watchlist.stocks):
            return jsonify({"success": False, "message": "Stock is already in this watchlist."}), 409

        # Use the resolved data to create or update the Stock document
        stock, _ = Stock.objects.get_or_create(
            symbol=full_symbol,
            defaults={
                'name': data.get('name', api_data['symbol']),
                'exchange': api_data['exchange'],
                'scripcode': api_data['scripcode']
            }
        )
        
        target_watchlist.stocks.append(stock)
        user.save()

        # --- Trigger Real-Time Subscription ---
        socket_manager = MO_WebSocket_Manager()
        socket_manager.register_scrip(
            symbol=stock.symbol, 
            exchange=stock.exchange, 
            scripcode=stock.scripcode
        )
        
        logger.info(f"User {user.client_id} added {stock.symbol} to watchlist '{watchlist_name}'")
        return jsonify({"success": True, "message": "Stock added successfully."}), 201

    except Exception as e:
        logger.error(f"Error adding stock to watchlist '{watchlist_name}': {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@watchlist_bp.route('/watchlists/<string:watchlist_name>/stocks/<string:symbol>', methods=['DELETE'])
@login_required
def remove_stock_from_watchlist(watchlist_name, symbol):
    """Removes a stock from a watchlist and unsubscribes from its real-time feed."""
    user = User.objects.get(id=current_user.id)
    target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404

    stock_to_remove = next((s for s in target_watchlist.stocks if s and s.symbol == symbol), None)
    if not stock_to_remove:
        return jsonify({"success": False, "message": "Stock not found in this watchlist."}), 404
        
    try:
        target_watchlist.stocks.remove(stock_to_remove)
        user.save()
    
        # --- Unsubscribe from the real-time feed ---
        socket_manager = MO_WebSocket_Manager()
        socket_manager.unregister_scrip(
            exchange=stock_to_remove.exchange, 
            scripcode=stock_to_remove.scripcode
        )

        logger.info(f"User {user.client_id} removed {symbol} from watchlist '{watchlist_name}'")
        return jsonify({"success": True, "message": "Stock removed successfully."}), 200
        
    except Exception as e:
        logger.error(f"Error removing stock from watchlist '{watchlist_name}': {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@watchlist_bp.route('/watchlists/<string:watchlist_name>', methods=['DELETE'])
@login_required
def delete_watchlist(watchlist_name):
    """Deletes an entire watchlist for the current user."""
    user = User.objects.get(id=current_user.id)
    target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)

    if not target_watchlist:
        return jsonify({"success": False, "message": "Watchlist not found."}), 404
    if not target_watchlist.is_deletable:
        return jsonify({"success": False, "message": "This watchlist cannot be deleted."}), 403

    try:
        # Unsubscribe from all stocks within the watchlist before deleting
        socket_manager = MO_WebSocket_Manager()
        for stock in target_watchlist.stocks:
            if stock:
                socket_manager.unregister_scrip(exchange=stock.exchange, scripcode=stock.scripcode)

        user.watchlists.remove(target_watchlist)
        user.save()
        
        logger.info(f"User {user.client_id} deleted watchlist: '{watchlist_name}'")
        return jsonify({"success": True, "message": "Watchlist deleted successfully."}), 200
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
