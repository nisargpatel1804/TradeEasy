from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import db, Watchlist, Stock, watchlist_stocks
from sqlalchemy.exc import SQLAlchemyError
import logging
import yfinance as yf
import pandas as pd
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint("watchlist", __name__)

# In-memory cache for watchlist stock prices
_WATCHLIST_CACHE = {}
_CACHE_TTL = 600  # Cache for 10 minutes

# ------------------------------------------------------
# Helpers
# ------------------------------------------------------

def _get_stocks_data(symbols, cache_key):
    """
    Get stock data with caching for better performance.
    """
    now = time.time()
    
    if cache_key in _WATCHLIST_CACHE:
        ts, cached_data = _WATCHLIST_CACHE[cache_key]
        if now - ts < _CACHE_TTL and cached_data:
            logger.info("Returning cached stock data for %s", cache_key)
            return cached_data

    logger.info("Fetching fresh stock data for %s", cache_key)
    if not symbols:
        return []

    try:
        # Use smaller batches to avoid API limitations
        batch_size = 20
        all_data = []
        
        # Map .NSE/.BSE to Yahoo-friendly .NS/.BO
        def _map_sym(s: str):
            s = s.upper()
            if s.endswith(".NSE"):
                return s.replace(".NSE", ".NS")
            if s.endswith(".BSE"):
                return s.replace(".BSE", ".BO")
            return s

        for i in range(0, len(symbols), batch_size):
            batch_original = symbols[i:i+batch_size]
            batch = [_map_sym(s) for s in batch_original]
            logger.info(f"Fetching batch of {len(batch)} symbols")
            
            # Use rounding=2 and handle errors
            data = yf.download(
                batch, 
                period="2d", 
                progress=False, 
                group_by='ticker',
                threads=True,
                ignore_tz=True,
                rounding=2
            )
            
            if not data.empty:
                all_data.append(data)
            time.sleep(1)  # Small delay between batches
            
        # Process the data
        stock_data = []
        
        for df in all_data:
            if df.empty:
                continue
                
            # Handle both single ticker (Series) and multiple ticker (DataFrame) cases
            if isinstance(df.columns, pd.MultiIndex):
                # Multiple tickers case - columns are a MultiIndex
                for symbol in set([col[1] for col in df.columns if col[0] == 'Close']):
                    try:
                        # Get Close prices for this symbol
                        close_series = df['Close'][symbol]
                        
                        # Need at least 2 data points for price comparison
                        if len(close_series) >= 2:
                            price_today = close_series.iloc[-1]
                            price_yest = close_series.iloc[-2]
                            
                            # Skip invalid data
                            if price_today <= 0 or price_yest <= 0 or pd.isna(price_today) or pd.isna(price_yest):
                                continue
                                
                            price = float(price_today)
                            change = float(price - price_yest)
                            percent = (change / price_yest) * 100 if price_yest > 0 else 0
                            
                            # Extract "market name" for display 
                            # RELIANCE.NS -> RELIANCE
                            display_name = symbol.split('.')[0]
                            
                            stock_data.append({
                                "symbol": symbol,
                                "name": display_name,
                                "price": round(price, 2),
                                "change": round(change, 2),
                                "percent_change": round(percent, 2),
                            })
                    except Exception as e:
                        logger.error(f"Could not process symbol {symbol} for {cache_key}: {e}")
                        continue
            else:
                # Single ticker case - columns are prices
                if 'Close' in df.columns and len(df) >= 2:
                    symbol = symbols[0]
                    try:
                        price_today = df['Close'].iloc[-1]
                        price_yest = df['Close'].iloc[-2]
                        
                        if price_today > 0 and price_yest > 0 and not pd.isna(price_today) and not pd.isna(price_yest):
                            price = float(price_today)
                            change = float(price - price_yest)
                            percent = (change / price_yest) * 100 if price_yest > 0 else 0
                            
                            # Extract "market name" for display
                            display_name = symbol.split('.')[0]
                            
                            stock_data.append({
                                "symbol": symbol,
                                "name": display_name,
                                "price": round(price, 2),
                                "change": round(change, 2),
                                "percent_change": round(percent, 2),
                            })
                    except Exception as e:
                        logger.error(f"Error processing single ticker {symbol}: {e}")
    
    except Exception as e:
        logger.error(f"yfinance download failed for {cache_key}: {e}")
        return _WATCHLIST_CACHE.get(cache_key, (0, []))[1] # Return stale data if available

    # ------------------------------------------------------------------
    # Fallback ◼️  — For symbols that yfinance could not return, try the
    #               smarter per-ticker `get_stock_price` with fallback
    #               to dummy data if needed.
    # ------------------------------------------------------------------
    processed_symbols = {item["symbol"] for item in stock_data}
    # Match missing vs original list ignoring mapping differences (.NS vs .NSE etc.)
    def _normalize_key(s):
        return s.replace(".NS", "").replace(".NSE", "").replace(".BO", "").replace(".BSE", "")
    processed_bases = {_normalize_key(k) for k in processed_symbols}
    missing = [s for s in symbols if _normalize_key(s) not in processed_bases]

    if missing:
        logger.info("Fetching %d missing symbols via get_stock_price fallback", len(missing))

        from app.utils.scraper import get_stock_price  # local import to avoid cycles

        for sym in missing:
            try:
                info = get_stock_price(sym, refresh=False)
                if not info or "error" in info:
                    continue

                stock_data.append({
                    "symbol": sym,
                    "name": sym.split(".")[0],
                    "price": round(info.get("price", 0), 2),
                    "change": round(info.get("price_change", 0), 2),
                    "percent_change": round(info.get("percent_change", 0), 2),
                })
            except Exception as e:
                logger.warning(f"Fallback fetch failed for {sym}: {e}")

    # Cache the results
    if stock_data:
        _WATCHLIST_CACHE[cache_key] = (now, stock_data)
        
    return stock_data

def _get_movers_from_stocks(stocks_data, count=5):
    """Extract gainers and losers from a list of stock data"""
    if not stocks_data:
        return [], []
        
    # Sort stocks by percent change
    gainers = sorted(stocks_data, key=lambda x: x.get('percent_change', 0), reverse=True)[:count]
    losers = sorted(stocks_data, key=lambda x: x.get('percent_change', 0))[:count]
    
    return gainers, losers

def ensure_default_watchlists(user_id: int):
    """Create the essential default watchlist ('Main') for a user.

    The function is idempotent and safe to call on every request. Legacy
    watchlists named "Nifty50", "Nifty 50" or "Sensex" are cleaned up or
    renamed away as part of the transition to a lightweight setup.
    """

    # ------------------------------------------------------------------
    # Keep exactly three default watchlists for every user:
    #   1. Main (user-editable)
    #   2. Nifty50 (virtual index – non-editable)
    #   3. Sensex  (virtual index – non-editable)
    # ------------------------------------------------------------------

    default_names = ["Main", "Nifty50", "Sensex"]

    # NOTE: We intentionally keep the index watchlists now to simplify the
    # UI. Any stray custom/legacy watchlists will be ignored by the
    # frontend, but we do NOT automatically delete them here to avoid
    # accidental data loss.

    existing_names = {
        w.name for w in Watchlist.query.filter_by(user_id=user_id).all()
    }

    missing = [name for name in default_names if name not in existing_names]

    if missing:
        new_watchlists = [
            Watchlist(user_id=user_id, name=name, is_deletable=False) for name in missing
        ]
        db.session.add_all(new_watchlists)
        try:
            db.session.commit()
            logger.info("Created missing default watchlists %s for user %s", missing, user_id)
        except Exception as e:
            db.session.rollback()
            logger.error("Error creating default watchlists for user %s: %s", user_id, e)

# ------------------------------------------------------
# Routes
# ------------------------------------------------------

@bp.route("/watchlists", methods=["GET"])
@login_required
def get_watchlists():
    """Fetches all watchlists for the current user."""
    try:
        ensure_default_watchlists(current_user.id)

        watchlists = (
            Watchlist.query.filter_by(user_id=current_user.id)
            .order_by(Watchlist.id)
            .all()
        )
        return (
            jsonify([{"id": w.id, "name": w.name, "is_deletable": w.is_deletable} for w in watchlists]),
            200,
        )
    except SQLAlchemyError as e:
        logger.error("Database error fetching watchlists for user %s: %s", current_user.id, e)
        return jsonify({"error": "Database error"}), 500

@bp.route("/watchlists", methods=["POST"])
@login_required
def create_watchlist():
    """Disabled – creating custom watchlists is no longer supported."""
    return jsonify({"error": "Custom watchlists have been disabled"}), 403

@bp.route("/watchlists/<int:watchlist_id>", methods=["DELETE"])
@login_required
def delete_watchlist(watchlist_id):
    """Deletes a custom watchlist."""
    try:
        watchlist = Watchlist.query.get(watchlist_id)

        if not watchlist:
            return jsonify({"error": "Watchlist not found"}), 404
        if watchlist.user_id != current_user.id:
            return jsonify({"error": "Unauthorized"}), 403
        if not watchlist.is_deletable:
            return jsonify({"error": "This watchlist cannot be deleted"}), 403

        db.session.delete(watchlist)
        db.session.commit()
        return jsonify({"message": f"Watchlist '{watchlist.name}' deleted successfully"}), 200

    except SQLAlchemyError as e:
        db.session.rollback()
        logger.error(f"Database error deleting watchlist {watchlist_id}: {e}")
        return jsonify({"error": "Database error"}), 500

# --- Stock Management within a Watchlist ---

@bp.route("/watchlists/<int:watchlist_id>/stocks", methods=["GET"])
@login_required
def get_watchlist_stocks(watchlist_id):
    """Fetches all stocks for a given watchlist with their price data."""
    try:
        watchlist = Watchlist.query.get(watchlist_id)
        if not watchlist or watchlist.user_id != current_user.id:
            return jsonify({"error": "Watchlist not found"}), 404

        # Get stock symbols from database for this watchlist
        stock_symbols = [
            row.stock_symbol for row in
            db.session.query(watchlist_stocks.c.stock_symbol)
            .filter_by(watchlist_id=watchlist.id)
            .all()
        ]
        
        # Fetch stock data
        cache_key = f"watchlist_{watchlist_id}"
        stocks_data = _get_stocks_data(stock_symbols, cache_key)
        
        # Get top gainers and losers
        gainers, losers = _get_movers_from_stocks(stocks_data)
        
        return jsonify({
            "id": watchlist.id, 
            "name": watchlist.name, 
            "stocks": stocks_data,
            "gainers": gainers,
            "losers": losers
        }), 200

    except SQLAlchemyError as e:
        logger.error(f"Database error fetching stocks for watchlist {watchlist_id}: {e}")
        return jsonify({"error": "Database error"}), 500

@bp.route("/watchlists/<int:watchlist_id>/stocks", methods=["POST"])
@login_required
def add_stock_to_watchlist(watchlist_id):
    """Adds a stock to a specific watchlist."""
    data = request.json
    symbol = data.get("symbol", "").strip().upper()

    # Convert common Indian suffixes to Yahoo-compatible versions
    if symbol.endswith(".NSE"):
        symbol = symbol.replace(".NSE", ".NS")
    elif symbol.endswith(".BSE"):
        symbol = symbol.replace(".BSE", ".BO")

    if not symbol:
        return jsonify({"error": "Stock symbol is required"}), 400

    try:
        watchlist = Watchlist.query.get(watchlist_id)
        if not watchlist or watchlist.user_id != current_user.id:
            return jsonify({"error": "Watchlist not found"}), 404

        # Check if stock exists in our DB, if not, create it
        stock = Stock.query.get(symbol)
        if not stock:
            stock = Stock(symbol=symbol, name=data.get("name", "")) # Optionally pass name from frontend search
            db.session.add(stock)
        
        # Add stock to watchlist if not already present
        if stock not in watchlist.stocks:
            watchlist.stocks.append(stock)
            db.session.commit()
            
            # Invalidate cache for this watchlist
            cache_key = f"watchlist_{watchlist_id}"
            if cache_key in _WATCHLIST_CACHE:
                del _WATCHLIST_CACHE[cache_key]
                
            return jsonify({"message": f"{symbol} added to {watchlist.name}"}), 201
        else:
            return jsonify({"error": f"{symbol} is already in {watchlist.name}"}), 409

    except SQLAlchemyError as e:
        db.session.rollback()
        logger.error(f"Database error adding stock to watchlist {watchlist_id}: {e}")
        return jsonify({"error": "Database error"}), 500


@bp.route("/watchlists/<int:watchlist_id>/stocks/<string:symbol>", methods=["DELETE"])
@login_required
def remove_stock_from_watchlist(watchlist_id, symbol):
    """Removes a stock from a specific watchlist."""
    try:
        watchlist = Watchlist.query.get(watchlist_id)
        stock_symbol = symbol.upper()

        # Convert common Indian suffixes to Yahoo-compatible versions
        if stock_symbol.endswith(".NSE"):
            stock_symbol = stock_symbol.replace(".NSE", ".NS")
        elif stock_symbol.endswith(".BSE"):
            stock_symbol = stock_symbol.replace(".BSE", ".BO")

        if not watchlist or watchlist.user_id != current_user.id:
            return jsonify({"error": "Watchlist not found"}), 404

        # Attempt to locate stock with multiple possible suffix variants
        def _variants(sym):
            if sym.endswith(".NS"):
                return [sym, sym.replace(".NS", ".NSE")]
            if sym.endswith(".NSE"):
                return [sym, sym.replace(".NSE", ".NS")]
            if sym.endswith(".BO"):
                return [sym, sym.replace(".BO", ".BSE")]
            if sym.endswith(".BSE"):
                return [sym, sym.replace(".BSE", ".BO")]
            return [sym]

        stock = None
        for variant in _variants(stock_symbol):
            candidate = Stock.query.get(variant)
            if candidate and candidate in watchlist.stocks:
                stock = candidate
                stock_symbol = variant  # use actual stored symbol for messages
                break

        if not stock:
            return jsonify({"error": "Stock not found in this watchlist"}), 404

        watchlist.stocks.remove(stock)
        db.session.commit()
        
        # Invalidate cache for this watchlist
        cache_key = f"watchlist_{watchlist_id}"
        if cache_key in _WATCHLIST_CACHE:
            del _WATCHLIST_CACHE[cache_key]
            
        return jsonify({"message": f"{stock_symbol} removed from {watchlist.name}"}), 200

    except SQLAlchemyError as e:
        db.session.rollback()
        logger.error(f"Database error removing stock from watchlist {watchlist_id}: {e}")
        return jsonify({"error": "Database error"}), 500