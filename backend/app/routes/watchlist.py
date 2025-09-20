"""
Watchlist Management Routes

This module handles all watchlist-related operations including:
- Fetching user watchlists
- Creating new watchlists
- Adding/removing stocks from watchlists
- Deleting watchlists
"""
import logging
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import User, Stock, Watchlist

# Configure logging
logger = logging.getLogger(__name__)

# Create blueprint
bp = Blueprint('watchlist', __name__)

@bp.route('/watchlists', methods=['GET'])
@login_required
def get_watchlists():
    """
    Fetches all watchlists for the current user.
    """
    try:
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Ensure user has a default "Main" watchlist
        has_main_watchlist = any(wl.name.lower() == "main" for wl in user.watchlists)
        if not has_main_watchlist:
            main_watchlist = Watchlist(
                name="Main",
                is_deletable=False,
                stocks=[]
            )
            user.watchlists.append(main_watchlist)
            user.save()
        
        watchlists_data = []
        for watchlist in user.watchlists:
            stocks_data = []
            for stock in watchlist.stocks:
                if stock:  # Ensure stock reference is valid
                    stocks_data.append({
                        "symbol": stock.symbol,
                        "name": stock.name,
                        "current_price": float(stock.current_price) if stock.current_price else 0.0,
                        "change": float(stock.change) if stock.change else 0.0,
                        "percent_change": float(stock.percent_change) if stock.percent_change else 0.0
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
    """
    Creates a new watchlist for the current user.
    """
    try:
        data = request.get_json()
        if not data or 'name' not in data:
            return jsonify({"error": "Watchlist name is required"}), 400
        
        name = data['name'].strip()
        if not name:
            return jsonify({"error": "Watchlist name cannot be empty"}), 400
        
        # Check if watchlist with same name already exists
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        for watchlist in user.watchlists:
            if watchlist.name.lower() == name.lower():
                return jsonify({"error": "Watchlist with this name already exists"}), 400
        
        # Create new watchlist
        new_watchlist = Watchlist(
            name=name,
            is_deletable=True,
            stocks=[]
        )
        
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
        
        # Find the watchlist to delete
        watchlist_to_delete = None
        for i, watchlist in enumerate(user.watchlists):
            if watchlist.name == watchlist_name:
                if not watchlist.is_deletable:
                    return jsonify({"error": "This watchlist cannot be deleted"}), 400
                watchlist_to_delete = i
                break
        
        if watchlist_to_delete is None:
            return jsonify({"error": "Watchlist not found"}), 404
        
        # Remove the watchlist
        user.watchlists.pop(watchlist_to_delete)
        user.save()
        
        logger.info(f"User {current_user.client_id} deleted watchlist: {watchlist_name}")
        return jsonify({"message": "Watchlist deleted successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {current_user.id}: {str(e)}")
        return jsonify({"error": "Failed to delete watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>/stocks', methods=['GET'])
@login_required
def get_watchlist_stocks(watchlist_name):
    """
    Fetches all stocks in a specific watchlist.
    """
    try:
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Find the watchlist
        target_watchlist = None
        for watchlist in user.watchlists:
            if watchlist.name == watchlist_name:
                target_watchlist = watchlist
                break
        
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        
        stocks_data = []
        for stock in target_watchlist.stocks:
            if stock:  # Ensure stock reference is valid
                stocks_data.append({
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "current_price": float(stock.current_price) if stock.current_price else 0.0,
                    "change": float(stock.change) if stock.change else 0.0,
                    "percent_change": float(stock.percent_change) if stock.percent_change else 0.0,
                    "volume": stock.volume if stock.volume else 0,
                    "last_updated": stock.last_updated.isoformat() if stock.last_updated else None
                })
        
        return jsonify({
            "watchlist_name": watchlist_name,
            "stocks": stocks_data,
            "stock_count": len(stocks_data)
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching stocks for watchlist {watchlist_name}: {str(e)}")
        return jsonify({"error": "Failed to fetch watchlist stocks"}), 500

@bp.route('/watchlists/<watchlist_name>/stocks', methods=['POST'])
@login_required
def add_stock_to_watchlist(watchlist_name):
    """
    Adds a stock to a specific watchlist.
    """
    try:
        data = request.get_json()
        if not data or 'symbol' not in data:
            return jsonify({"error": "Stock symbol is required"}), 400
        
        symbol = data['symbol'].upper().strip()
        
        # Check if stock exists
        stock = Stock.objects(symbol=symbol).first()
        if not stock:
            return jsonify({"error": "Stock not found"}), 404
        
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        # Find the watchlist
        target_watchlist = None
        for watchlist in user.watchlists:
            if watchlist.name == watchlist_name:
                target_watchlist = watchlist
                break
        
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        
        # Check if stock is already in watchlist
        if stock in target_watchlist.stocks:
            return jsonify({"error": "Stock already in watchlist"}), 400
        
        # Add stock to watchlist
        target_watchlist.stocks.append(stock)
        user.save()
        
        logger.info(f"User {current_user.client_id} added {symbol} to watchlist {watchlist_name}")
        return jsonify({
            "message": "Stock added to watchlist successfully",
            "stock": {
                "symbol": stock.symbol,
                "name": stock.name,
                "current_price": float(stock.current_price) if stock.current_price else 0.0
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error adding stock to watchlist {watchlist_name}: {str(e)}")
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
        
        # Find the watchlist
        target_watchlist = None
        for watchlist in user.watchlists:
            if watchlist.name == watchlist_name:
                target_watchlist = watchlist
                break
        
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        
        # Find and remove the stock
        stock_to_remove = None
        for i, stock in enumerate(target_watchlist.stocks):
            if stock and stock.symbol == symbol:
                stock_to_remove = i
                break
        
        if stock_to_remove is None:
            return jsonify({"error": "Stock not found in watchlist"}), 404
        
        target_watchlist.stocks.pop(stock_to_remove)
        user.save()
        
        logger.info(f"User {current_user.client_id} removed {symbol} from watchlist {watchlist_name}")
        return jsonify({"message": "Stock removed from watchlist successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error removing stock from watchlist {watchlist_name}: {str(e)}")
        return jsonify({"error": "Failed to remove stock from watchlist"}), 500