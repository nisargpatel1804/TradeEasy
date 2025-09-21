"""
Watchlist Management Routes

This module handles all watchlist-related operations and integrates with the
real-time WebSocket manager to trigger live data subscriptions.
"""
import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import User, Stock, Watchlist

# It is assumed that the MO_WebSocket_Manager is initialized as a singleton
# in your main Flask app factory (e.g., in __init__.py) and can be imported.
# To make this code functional, ensure the following line works in your app structure:
from app import mo_socket_manager

# Configure logging
logger = logging.getLogger(__name__)

# Create blueprint
bp = Blueprint('watchlist', __name__)

@bp.route('/watchlists', methods=['GET'])
@login_required
def get_watchlists():
    """Fetches all watchlists for the current user."""
    try:
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Ensure user has a default "Stocks" watchlist for a good UX
        has_main_watchlist = any(wl.name.lower() == "stocks" for wl in user.watchlists)
        if not has_main_watchlist:
            main_watchlist = Watchlist(
                name="Stocks",
                is_deletable=False,
                stocks=[]
            )
            user.watchlists.append(main_watchlist)
            user.save()
        
        watchlists_data = []
        for watchlist in user.watchlists:
            stocks_data = []
            for stock_ref in watchlist.stocks:
                if stock_ref:  # Ensure stock reference is valid
                    stocks_data.append({
                        "symbol": stock_ref.symbol,
                        "name": stock_ref.name,
                        "current_price": float(stock_ref.current_price) if stock_ref.current_price else 0.0,
                        "change": float(stock_ref.change) if stock_ref.change else 0.0,
                        "percent_change": float(stock_ref.percent_change) if stock_ref.percent_change else 0.0
                    })
            
            watchlists_data.append({
                "name": watchlist.name,
                "is_deletable": watchlist.is_deletable,
                "stocks": stocks_data,
                "stock_count": len(stocks_data)
            })
        
        return jsonify(watchlists_data), 200
        
    except Exception as e:
        logger.error(f"Error fetching watchlists for user {current_user.id}: {str(e)}")
        return jsonify({"error": "Failed to fetch watchlists"}), 500

@bp.route('/watchlists', methods=['POST'])
@login_required
def create_watchlist():
    """Creates a new watchlist for the current user."""
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        if not name:
            return jsonify({"error": "Watchlist name cannot be empty"}), 400
        
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        if any(wl.name.lower() == name.lower() for wl in user.watchlists):
            return jsonify({"error": "Watchlist with this name already exists"}), 409
        
        new_watchlist = Watchlist(name=name, is_deletable=True, stocks=[])
        user.watchlists.append(new_watchlist)
        user.save()
        
        logger.info(f"User {current_user.client_id} created watchlist: {name}")
        return jsonify({
            "message": "Watchlist created successfully",
            "watchlist": {
                "name": new_watchlist.name,
                "is_deletable": new_watchlist.is_deletable,
                "stocks": [],
                "stock_count": 0
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating watchlist for user {current_user.id}: {str(e)}")
        return jsonify({"error": "Failed to create watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>/stocks', methods=['POST'])
@login_required
def add_stock_to_watchlist(watchlist_name):
    """
    Adds a stock to a specific watchlist and triggers a real-time data subscription.
    """
    try:
        data = request.get_json()
        if not data or 'symbol' not in data:
            return jsonify({"error": "Stock symbol is required"}), 400
        
        symbol = data['symbol'].upper().strip()
        name = data.get('name', symbol)
        scripcode = data.get('scripcode')

        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
            
        target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404

        stock = Stock.objects(symbol=symbol).first()
        if not stock:
            base_symbol = symbol.split('.')[0]
            exchange = 'NSE' if '.NS' in symbol or '.NSE' in symbol else 'BSE'
            stock = Stock(
                symbol=symbol,
                name=name,
                base_symbol=base_symbol,
                exchange=exchange,
                scripcode=scripcode,
                is_active=True
            )
            stock.save()
            logger.info(f"Created new stock entry for {symbol} with scripcode {scripcode}")
        
        if any(s.symbol == symbol for s in target_watchlist.stocks):
            return jsonify({"error": "Stock already in watchlist"}), 409
            
        target_watchlist.stocks.append(stock)
        user.save()
        
        # --- REAL-TIME SUBSCRIPTION TRIGGER (NOW ACTIVE) ---
        # After successfully saving, this instructs the manager to subscribe to the stock.
        try:
            if stock.scripcode and stock.exchange:
                logger.info(f"Attempting to register {stock.symbol} ({stock.scripcode}) for real-time updates.")
                mo_socket_manager.register_scrip(
                    symbol=stock.symbol,
                    exchange=stock.exchange,
                    scripcode=stock.scripcode
                )
            else:
                logger.warning(f"Cannot subscribe to {stock.symbol}: scripcode is missing.")
        except Exception as e:
            logger.error(f"Failed to register scrip {stock.symbol} with WebSocket manager: {e}")
        
        logger.info(f"User {current_user.client_id} added {symbol} to watchlist {watchlist_name}")
        return jsonify({
            "message": "Stock added to watchlist successfully",
            "stock": {"symbol": stock.symbol, "name": stock.name, "current_price": 0.0}
        }), 201
        
    except Exception as e:
        logger.error(f"Error adding stock to watchlist {watchlist_name}: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to add stock to watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>/stocks/<symbol>', methods=['DELETE'])
@login_required
def remove_stock_from_watchlist(watchlist_name, symbol):
    """
    Removes a stock from a specific watchlist.
    """
    try:
        symbol = symbol.upper().strip()
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
            
        target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        
        initial_stock_count = len(target_watchlist.stocks)
        # Rebuild the list, excluding the stock to be removed
        target_watchlist.stocks = [s for s in target_watchlist.stocks if s and s.symbol != symbol]
        
        if len(target_watchlist.stocks) == initial_stock_count:
            return jsonify({"error": "Stock not found in watchlist"}), 404
            
        user.save()

        # --- DESIGN NOTE on Unsubscribing ---
        # We are intentionally NOT calling mo_socket_manager.unregister_scrip() here.
        # To do so safely, we would need to check if ANY other user is still watching
        # this stock. Implementing reference counting adds significant complexity.
        # The current approach is safer: subscriptions remain active until the server
        # restarts, preventing us from cutting off the feed for other active users.
        
        logger.info(f"User {current_user.client_id} removed {symbol} from watchlist {watchlist_name}")
        return jsonify({"message": "Stock removed from watchlist successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error removing stock from watchlist {watchlist_name}: {str(e)}")
        return jsonify({"error": "Failed to remove stock from watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>', methods=['DELETE'])
@login_required
def delete_watchlist(watchlist_name):
    """
    Deletes a watchlist by name.
    """
    try:
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        watchlist_to_delete = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)
        
        if not watchlist_to_delete:
            return jsonify({"error": "Watchlist not found"}), 404
        
        if not watchlist_to_delete.is_deletable:
            return jsonify({"error": "This watchlist cannot be deleted"}), 403
        
        user.watchlists = [wl for wl in user.watchlists if wl.name != watchlist_name]
        user.save()
        
        logger.info(f"User {current_user.client_id} deleted watchlist: {watchlist_name}")
        return jsonify({"message": "Watchlist deleted successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {current_user.id}: {str(e)}")
        return jsonify({"error": "Failed to delete watchlist"}), 500