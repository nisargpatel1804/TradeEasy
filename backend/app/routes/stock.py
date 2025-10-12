import logging
import time
from flask import Blueprint, jsonify, request
from functools import lru_cache
from app.models import AQScrip, Stock
from app.socket_manager import MO_WebSocket_Manager

# --- Configuration ---
logger = logging.getLogger(__name__)
stock_bp = Blueprint('stock', __name__)

# --- Helper Functions ---

def format_symbol(symbol: str) -> str:
    """Cleans and standardizes a stock symbol by removing exchange suffixes."""
    if not isinstance(symbol, str): return ""
    clean_symbol = symbol.strip().upper()
    if '.' in clean_symbol:
        return clean_symbol.split('.')[0]
    return clean_symbol

# --- Core Data Fetching Logic ---

@lru_cache(maxsize=512)
def get_stock_data_from_api(symbol: str) -> dict | None:
    """
    The centralized, cached function to fetch comprehensive stock data for a given symbol.
    It resolves the scripcode and uses the authenticated MO API instance.
    """
    clean_symbol = format_symbol(symbol)
    if not clean_symbol:
        return None

    try:
        # Get the singleton instance of the manager and its authenticated API object
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token and not mo_api.login():
            raise ConnectionError("MO API login failed. Cannot fetch stock data.")

        # --- Step 1: Resolve Symbol to Scripcode and Exchange ---
        instrument = _resolve_instrument(clean_symbol)
        if not instrument:
            logger.warning(f"Could not resolve instrument for symbol: {clean_symbol}")
            return None
        
        exchange, scripcode = instrument['exchange'], instrument['scripcode']

        # --- Step 2: Fetch Live/EOD Data from API ---
        response = mo_api.get_ltp_data(exchange, scripcode)
        if not response or response.get("status") != "SUCCESS" or not response.get("data"):
            logger.warning(f"No valid LTP data from API for {clean_symbol} ({scripcode})")
            return None

        # --- Step 3: Format and Return Data ---
        data = response["data"]
        ltp = float(data.get('ltp', 0)) / 100.0
        prev_close = float(data.get('close', 0)) / 100.0
        
        change = ltp - prev_close if prev_close > 0 else 0.0
        percent_change = (change / prev_close * 100.0) if prev_close > 0 else 0.0

        return {
            'symbol': clean_symbol,
            'exchange': exchange,
            'scripcode': scripcode,
            'ltp': round(ltp, 2),
            'change': round(change, 2),
            'percent_change': round(percent_change, 2),
            'open': float(data.get('open', 0)) / 100.0,
            'high': float(data.get('high', 0)) / 100.0,
            'low': float(data.get('low', 0)) / 100.0,
            'close': prev_close,
            'volume': int(data.get('volume', 0)),
            'last_updated': int(time.time() * 1000)
        }

    except Exception as e:
        logger.error(f"Error in get_stock_data_from_api for '{clean_symbol}': {e}", exc_info=True)
        # Clear the cache for this specific symbol on failure to allow retries
        get_stock_data_from_api.cache_clear()
        return None

def _resolve_instrument(symbol: str) -> dict | None:
    """Finds the exchange and scripcode for a symbol using the database."""
    # Priority 1: Check the Stock collection (user-specific/watchlist stocks)
    stock_doc = Stock.objects(symbol__startswith=symbol).first()
    if stock_doc:
        return {'exchange': stock_doc.exchange, 'scripcode': stock_doc.scripcode}

    # Priority 2: Check the master AQScrip collection
    # Search NSE first as it's the most common
    aq_scrip = AQScrip.objects(exchangename='NSE', scripshortname=symbol).first()
    if aq_scrip:
        return {'exchange': 'NSE', 'scripcode': aq_scrip.scripcode}
    
    # Fallback to BSE if not found on NSE
    aq_scrip = AQScrip.objects(exchangename='BSE', scripshortname=symbol).first()
    if aq_scrip:
        return {'exchange': 'BSE', 'scripcode': aq_scrip.scripcode}
        
    return None

# --- API Routes ---

@stock_bp.route("/stock/<string:symbol>", methods=["GET"])
def get_stock_details(symbol):
    """
    Provides a complete overview for a single stock, including price data,
    and placeholder financial ratios.
    """
    try:
        api_data = get_stock_data_from_api(symbol)
        if not api_data:
            return jsonify({"success": False, "message": f"Data not available for symbol '{symbol}'."}), 404
        
        # Placeholder for fundamental data not available from this API
        financials = {
            "market_cap": "N/A", "pe_ratio": "N/A", "dividend_yield": "N/A",
            "note": "Fundamental data requires a different data provider."
        }

        return jsonify({
            "success": True,
            "price_data": api_data,
            "financials": financials
        })
    except Exception as e:
        logger.error(f"Error in get_stock_details for {symbol}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@stock_bp.route("/stocks/batch", methods=["GET"])
def batch_stock_data():
    """
    Efficiently fetches data for multiple stock symbols in a single request.
    Leverages the cached `get_stock_data_from_api` function.
    """
    symbols_param = request.args.get('symbols', '')
    if not symbols_param:
        return jsonify({"success": False, "message": "Query parameter 'symbols' is required."}), 400

    symbols = list(set(s.strip() for s in symbols_param.split(',') if s.strip()))
    if len(symbols) > 50:
        return jsonify({"success": False, "message": "Maximum of 50 symbols per batch request."}), 413

    batch_result = {}
    for symbol in symbols:
        # Each call here is fast due to the LRU cache
        data = get_stock_data_from_api(symbol)
        clean_symbol = format_symbol(symbol)
        if data:
            batch_result[clean_symbol] = data
        else:
            batch_result[clean_symbol] = {"error": "Data not found"}

    return jsonify({"success": True, "data": batch_result})
