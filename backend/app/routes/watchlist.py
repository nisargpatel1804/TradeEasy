"""
Watchlist Management Routes

This module handles all watchlist-related operations and integrates with the
real-time WebSocket manager to trigger live data subscriptions.
"""
import logging
import re
from datetime import datetime
from bson import ObjectId
from bson.dbref import DBRef
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine import connection
from app.models import User, Stock, Watchlist

# It is assumed that the MO_WebSocket_Manager is initialized as a singleton
# in your main Flask app factory (e.g., in __init__.py) and can be imported.
from app.socket_manager import MO_WebSocket_Manager
from app.moapi.mo_api import MotilalOswalAPI

mo_socket_manager = MO_WebSocket_Manager()
mo_api = MotilalOswalAPI(use_test_url=False)

# Configure logging
logger = logging.getLogger(__name__)

# Create blueprint
bp = Blueprint('watchlist', __name__)


# ---- Constants and Validation helpers ----
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9\.-]{0,19}$")
MAX_STOCKS_PER_WATCHLIST = 25 # Define the limit

def _validate_symbol(symbol: str) -> bool:
    if not symbol:
        return False
    return bool(SYMBOL_PATTERN.match(symbol))


def _validate_scripcode(scripcode) -> bool:
    try:
        return int(scripcode) > 0
    except (ValueError, TypeError):
        return False

def _get_scripcode_for_symbol(symbol, exchange):
    """
    Get scripcode for a given symbol from MO API master data.
    This helps populate missing scripcode data for stocks.
    """
    try:
        if not mo_api.auth_token and not mo_api.login():
            logger.error("Failed to authenticate with MO API for scripcode lookup")
            return None
            
        # Get scrips master data for the exchange
        response = mo_api.get_scrips_by_exchange(exchange)
        
        if response and response.get("status") == "SUCCESS":
            scrips_data = response.get("data", [])
            
            # Clean the symbol for comparison (remove .NS, .BO suffixes)
            clean_symbol = symbol.replace('.NS', '').replace('.BO', '').upper()
            
            # Search for matching symbol
            for scrip in scrips_data:
                scrip_name = scrip.get("scripshortname", "").upper()
                scrip_full_name = scrip.get("scripname", "").upper()
                
                # Try to match by short name first, then full name contains symbol
                if (scrip_name == clean_symbol or 
                    clean_symbol in scrip_full_name or
                    scrip_name in clean_symbol):
                    scripcode = scrip.get("scripcode")
                    if scripcode:
                        logger.info(f"Found scripcode {scripcode} for {symbol} on {exchange}")
                        return int(scripcode)
        
        logger.warning(f"Could not find scripcode for {symbol} on {exchange}")
        return None
        
    except Exception as e:
        logger.error(f"Error looking up scripcode for {symbol}: {str(e)}")
        return None

def _populate_missing_scripcode(stock):
    """
    Populate missing scripcode for a stock by looking it up from MO API.
    """
    if stock.scripcode:
        return stock.scripcode
        
    logger.info(f"Looking up missing scripcode for {stock.symbol}")
    scripcode = _get_scripcode_for_symbol(stock.symbol, stock.exchange)
    
    if scripcode:
        stock.scripcode = scripcode
        try:
            stock.save()
            logger.info(f"Updated {stock.symbol} with scripcode {scripcode}")
        except Exception as e:
            logger.error(f"Failed to save scripcode for {stock.symbol}: {e}")
    
    return scripcode

def _fetch_current_stock_price(stock):
    """
    Fetches current/last available price for a stock using MO API.
    Uses LTP data during market hours and EOD data as fallback.
    Updates the stock document with fetched data.
    Returns updated stock data or None if failed.
    """
    try:
        # Ensure we have scripcode - look it up if missing
        if not stock.scripcode:
            scripcode = _populate_missing_scripcode(stock)
            if not scripcode:
                logger.warning(f"Cannot fetch price for {stock.symbol} - no scripcode available")
                return None
        
        if not stock.exchange:
            logger.warning(f"Stock {stock.symbol} missing exchange")
            return None
            
        # Authenticate if needed
        if not mo_api.auth_token or (mo_api.login_time and (datetime.utcnow() - mo_api.login_time).total_seconds() > 600):
            if not mo_api.login():
                logger.error("Failed to authenticate with MO API")
                return None
        
        current_price = 0.0
        previous_close = 0.0
        data_source = "LTP"
        
        # Try LTP data first
        response = mo_api.get_ltp_data(stock.exchange, stock.scripcode)
        
        if response and response.get("status") == "SUCCESS":
            data = response.get("data", {})
            if data:
                current_price = float(data.get("ltp", 0)) / 100
                previous_close = float(data.get("close", 0)) / 100
                
        # If LTP data is not available or returns zero, try EOD data as fallback
        if current_price == 0.0:
            logger.info(f"LTP data not available for {stock.symbol}, trying EOD data")
            eod_response = mo_api.get_bulk_eod_data(stock.exchange)
            
            if eod_response and eod_response.get("status") == "SUCCESS":
                eod_data_map = eod_response.get("data", {})
                scripcode_str = str(stock.scripcode)
                
                if scripcode_str in eod_data_map:
                    eod_data = eod_data_map[scripcode_str]
                    current_price = float(eod_data.get("close", 0)) / 100
                    previous_close = float(eod_data.get("close", 0)) / 100  # For EOD, we use close as both current and previous
                    data_source = "EOD"
                    logger.info(f"Found EOD data for {stock.symbol}: ₹{current_price}")
        
        # If we have valid price data, update the stock
        if current_price > 0:
            # Calculate change and percent change
            change = current_price - previous_close if previous_close > 0 else 0
            percent_change = (change / previous_close * 100) if previous_close > 0 else 0
            
            # Update stock document
            stock.current_price = current_price
            stock.change = change
            stock.percent_change = percent_change
            stock.last_updated = datetime.utcnow()
            
            # Save to database
            try:
                stock.save()
                logger.info(f"Updated price for {stock.symbol}: ₹{current_price} (from {data_source})")
            except Exception as save_err:
                logger.error(f"Failed to save stock {stock.symbol}: {save_err}")
            
            return {
                "symbol": stock.symbol,
                "name": stock.name,
                "current_price": float(current_price),
                "change": float(change),
                "percent_change": float(percent_change)
            }
        else:
            logger.warning(f"No valid price data found for {stock.symbol} from both LTP and EOD sources")
            
    except Exception as e:
        logger.error(f"Error fetching price for {stock.symbol}: {str(e)}")
    
    return None

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
                    current_price = float(stock_ref.current_price) if stock_ref.current_price else 0.0
                    change = float(stock_ref.change) if stock_ref.change else 0.0
                    percent_change = float(stock_ref.percent_change) if stock_ref.percent_change else 0.0
                    
                    stocks_data.append({
                        "symbol": stock_ref.symbol,
                        "name": stock_ref.name,
                        "current_price": current_price,
                        "change": change,
                        "percent_change": percent_change
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
        
        logger.info(f"User {getattr(current_user, 'client_id', 'N/A')} created watchlist: {name}")
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


@bp.route('/watchlists/<watchlist_name>/stocks', methods=['GET', 'POST'])
@login_required
def manage_watchlist_stocks(watchlist_name):
    """
    GET: Fetch stocks for a specific watchlist.
    POST: Adds a stock to a specific watchlist and triggers a real-time data subscription.
    """
    user = User.objects(id=current_user.id).first()
    if not user:
        return jsonify({"error": "User not found"}), 404

    target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)
    if not target_watchlist:
        return jsonify({"error": "Watchlist not found"}), 404

    # Handle GET requests
    if request.method == 'GET':
        stocks_data = []
        for stock_ref in target_watchlist.stocks:
            if not stock_ref:
                continue
            
            # Check if we need to fetch current price data
            current_price = float(stock_ref.current_price) if stock_ref.current_price else 0.0
            change = float(stock_ref.change) if stock_ref.change else 0.0
            percent_change = float(stock_ref.percent_change) if stock_ref.percent_change else 0.0
            
            # If price is 0 or data is stale, try to fetch current price
            should_fetch_price = (
                current_price == 0.0 or 
                not stock_ref.last_updated or 
                (datetime.utcnow() - stock_ref.last_updated).total_seconds() > 3600  # older than 1 hour
            )
            
            if should_fetch_price:
                logger.info(f"Fetching current price for {stock_ref.symbol}")
                updated_data = _fetch_current_stock_price(stock_ref)
                if updated_data:
                    current_price = updated_data["current_price"]
                    change = updated_data["change"]
                    percent_change = updated_data["percent_change"]

            # Ensure live subscription for each stock in the watchlist
            try:
                if stock_ref.scripcode and stock_ref.exchange:
                    logger.debug(f"Ensuring live subscription for {stock_ref.symbol} ({stock_ref.scripcode})")
                    mo_socket_manager.register_scrip(symbol=stock_ref.symbol, exchange=stock_ref.exchange, scripcode=stock_ref.scripcode)
            except Exception as sub_e:
                logger.warning(f"Could not register {stock_ref.symbol} for live updates: {sub_e}")
            
            stocks_data.append({
                "symbol": stock_ref.symbol,
                "name": stock_ref.name,
                "current_price": current_price,
                "change": change,
                "percent_change": percent_change,
                "last_updated": int(stock_ref.last_updated.timestamp() * 1000) if stock_ref.last_updated else None
            })
        return jsonify({"name": target_watchlist.name, "stocks": stocks_data}), 200

    # Handle POST requests
    try:
        data = request.get_json()
        if not data or 'symbol' not in data:
            return jsonify({"error": "Stock symbol is required"}), 400
        
        symbol = data['symbol'].upper().strip()
        if not _validate_symbol(symbol):
            return jsonify({"error": "Invalid stock symbol format"}), 400

        # **LIMIT ENFORCEMENT (BACKEND)**
        if len(target_watchlist.stocks) >= MAX_STOCKS_PER_WATCHLIST:
            return jsonify({
                "error": f"Watchlist is full. Maximum of {MAX_STOCKS_PER_WATCHLIST} stocks allowed."
            }), 409 # 409 Conflict is a good status code here

        if any(s and getattr(s, 'symbol', None) == symbol for s in target_watchlist.stocks):
            return jsonify({"error": "Stock already in watchlist"}), 409

        name = data.get('name', symbol)
        scripcode = data.get('scripcode')
        if scripcode is not None and not _validate_scripcode(scripcode):
            return jsonify({"error": "Invalid scripcode"}), 400

        # Determine exchange from symbol format or explicit parameter
        exchange = data.get('exchange', 'NSE' if '.NS' in symbol.upper() else 'BSE')

        # Create or find the stock document
        stock = Stock.objects(symbol=symbol).first()
        created = False
        
        if not stock:
            stock = Stock(
                symbol=symbol,
                name=name,
                scripcode=scripcode,
                exchange=exchange
            )
            stock.save()
            created = True
        
        # If stock was just created and missing scripcode, try to look it up
        if created and not stock.scripcode:
            _populate_missing_scripcode(stock)

        # Add the stock reference to the user's watchlist
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
            
        # Find the specific watchlist and add the stock
        watchlist_updated = False
        for watchlist in user.watchlists:
            if watchlist.name == watchlist_name:
                if stock not in watchlist.stocks:
                    watchlist.stocks.append(stock)
                    watchlist_updated = True
                break
        
        if not watchlist_updated:
            return jsonify({"error": "Could not add stock, watchlist may not exist"}), 404
            
        # Save the user with updated watchlist
        user.save()

        # Attempt to fetch current price immediately so client can render non-zero
        price_payload = None
        try:
            updated_price = _fetch_current_stock_price(stock)
            if updated_price:
                price_payload = updated_price
                # Also emit a socket update so any open clients update live
                try:
                    # Reuse the same symbol key across realtime map
                    from app import socketio
                    socketio.emit('stock_update', {
                        'symbol': stock.symbol,
                        'ltp': updated_price.get('current_price', 0),
                        'change': updated_price.get('change', 0),
                        'percent_change': updated_price.get('percent_change', 0),
                        'last_updated': int(datetime.utcnow().timestamp() * 1000),
                    })
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Could not fetch immediate price for {stock.symbol}: {e}")

        # --- REAL-TIME SUBSCRIPTION TRIGGER ---
        if stock.scripcode and stock.exchange:
            try:
                logger.info(f"Attempting to register {symbol} ({stock.scripcode}) for real-time updates.")
                mo_socket_manager.register_scrip(
                    symbol=stock.symbol, exchange=stock.exchange, scripcode=stock.scripcode
                )
            except Exception as sub_err:
                logger.error(f"Failed to register scrip {symbol} with WebSocket manager: {sub_err}")
        
        logger.info(f"User {getattr(current_user, 'client_id', 'N/A')} added {symbol} to watchlist {watchlist_name}")
        return jsonify({
            "message": "Stock added to watchlist successfully",
            "stock": {"symbol": symbol, "name": name, "current_price": (price_payload or {}).get('current_price', 0), "change": (price_payload or {}).get('change', 0), "percent_change": (price_payload or {}).get('percent_change', 0)},
        }), 201
        
    except Exception as e:
        logger.error(f"Error adding stock to watchlist {watchlist_name}: {str(e)}", exc_info=True)
        return jsonify({"error": "Failed to add stock to watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>/stocks/<symbol>', methods=['DELETE'])
@login_required
def remove_stock_from_watchlist(watchlist_name, symbol):
    """
    Removes a stock from a specific watchlist and unsubscribes from real-time updates.
    """
    try:
        symbol = symbol.upper().strip()
        if not _validate_symbol(symbol):
            return jsonify({"error": "Invalid stock symbol format"}), 400

        # CORRECTED: Query by the 'symbol' field instead of 'id'
        stock_to_remove = Stock.objects(symbol=symbol).first()
        if not stock_to_remove:
            return jsonify({"error": "Stock not found"}), 404

        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
            
        # Find the specific watchlist and remove the stock reference
        stock_removed = False
        for watchlist in user.watchlists:
            if watchlist.name == watchlist_name:
                initial_len = len(watchlist.stocks)
                # Use a more robust method to remove the stock reference
                watchlist.stocks = [s for s in watchlist.stocks if s and s.id != stock_to_remove.id]
                if len(watchlist.stocks) < initial_len:
                    stock_removed = True
                break
        
        if not stock_removed:
            return jsonify({"error": "Stock not found in this watchlist"}), 404
            
        user.save()

        # ADDED: Unsubscribe from real-time updates for the removed stock
        if stock_to_remove.scripcode and stock_to_remove.exchange:
            try:
                logger.info(f"Unregistering {symbol} ({stock_to_remove.scripcode}) from real-time updates.")
                mo_socket_manager.unregister_scrip(
                    exchange=stock_to_remove.exchange, scripcode=stock_to_remove.scripcode
                )
            except Exception as unsub_err:
                logger.error(f"Failed to unregister scrip {symbol}: {unsub_err}")
            
        logger.info(f"User {getattr(current_user, 'client_id', 'N/A')} removed {symbol} from watchlist {watchlist_name}")
        return jsonify({"message": "Stock removed from watchlist successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error removing stock from watchlist {watchlist_name}: {str(e)}")
        return jsonify({"error": "Failed to remove stock from watchlist"}), 500

@bp.route('/watchlists/<watchlist_name>', methods=['DELETE'])
@login_required
def delete_watchlist(watchlist_name):
    """Deletes a watchlist by name."""
    try:
        user = User.objects(id=current_user.id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        target_watchlist = next((wl for wl in user.watchlists if wl.name == watchlist_name), None)
        
        if not target_watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        
        if not target_watchlist.is_deletable:
            return jsonify({"error": "This watchlist cannot be deleted"}), 403
        
        User.objects(id=current_user.id).update_one(pull__watchlists__name=watchlist_name)
        
        logger.info(f"User {getattr(current_user, 'client_id', 'N/A')} deleted watchlist: {watchlist_name}")
        return jsonify({"message": "Watchlist deleted successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error deleting watchlist for user {current_user.id}: {str(e)}")
        return jsonify({"error": "Failed to delete watchlist"}), 500