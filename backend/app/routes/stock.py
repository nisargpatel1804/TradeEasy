import logging
import time
from flask import Blueprint, jsonify, request
from functools import lru_cache
from app.models import AQScrip, Stock
from app.socket_manager import MO_WebSocket_Manager

# --- Configuration ---
logger = logging.getLogger(__name__)
stock_bp = Blueprint('stock', __name__)

# Module-level cache for bulk EOD data to avoid redundant API calls
_eod_cache = {}
EOD_CACHE_TTL = 300  # 5 minutes

# --- Helper Functions ---

def format_symbol(symbol: str) -> str:
    """Cleans and standardizes a stock symbol by removing exchange suffixes."""
    if not isinstance(symbol, str): return ""
    clean_symbol = symbol.strip().upper()
    if '.' in clean_symbol:
        return clean_symbol.split('.')[0]
    return clean_symbol

def _get_cached_eod_data(mo_api, exchange: str) -> list:
    """Fetches and caches bulk EOD data for an exchange to minimize API calls."""
    cache_key = f"eod_bulk_{exchange}"
    now = time.time()
    
    if cache_key in _eod_cache:
        cached_data, timestamp = _eod_cache[cache_key]
        if now - timestamp < EOD_CACHE_TTL:
            logger.debug(f"EOD cache HIT for {exchange}")
            return cached_data
    
    logger.info(f"EOD cache MISS for {exchange}, fetching from API")
    response = mo_api.get_eod_data(exchange)
    if response and response.get("status") == "SUCCESS":
        eod_data = response.get("data", [])
        _eod_cache[cache_key] = (eod_data, now)
        return eod_data
    
    return []

# --- Helper Functions ---

def format_symbol(symbol: str) -> str:
    """Cleans and standardizes a stock symbol by removing exchange suffixes."""
    if not isinstance(symbol, str): return ""
    clean_symbol = symbol.strip().upper()
    if '.' in clean_symbol:
        return clean_symbol.split('.')[0]
    return clean_symbol

def extract_price_with_fallback(api_data: dict) -> tuple[float, str]:
    """
    Extracts the best available price from API response data, falling back to
    close/prevClose when ltp is zero (market closed scenario).
    
    Returns:
        tuple[float, str]: (price_in_rupees, source_field)
        source_field is one of: 'ltp', 'close', 'prevClose', or 'unavailable'
    """
    if not api_data or not isinstance(api_data, dict):
        return (0.0, 'unavailable')
    
    # Try ltp first (live trading price)
    ltp_paisa = api_data.get('ltp', 0)
    if ltp_paisa and ltp_paisa > 0:
        return (float(ltp_paisa) / 100.0, 'ltp')
    
    # Fallback to close (previous day's close or latest EOD)
    close_paisa = api_data.get('close', 0)
    if close_paisa and close_paisa > 0:
        return (float(close_paisa) / 100.0, 'close')
    
    # Last resort: prevClose (some APIs use this field)
    prev_close_paisa = api_data.get('prevClose', 0)
    if prev_close_paisa and prev_close_paisa > 0:
        return (float(prev_close_paisa) / 100.0, 'prevClose')
    
    return (0.0, 'unavailable')

# --- Core Data Fetching Logic ---

@lru_cache(maxsize=512)
def get_stock_data_from_api(symbol: str) -> dict | None:
    """
    The centralized, cached function to fetch comprehensive stock data for a given symbol.
    It resolves the scripcode and uses the authenticated MO API instance.
    Falls back to EOD bulk data when LTP is unavailable (market closed).
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

        # --- Step 3: Extract Price with Fallback Logic ---
        data = response["data"]
        
        ltp, price_source = extract_price_with_fallback(data)
        
        # If still zero, try fetching from bulk EOD data as final fallback
        if ltp <= 0:
            logger.info(f"LTP is zero for {clean_symbol}, attempting bulk EOD fallback")
            eod_data_list = _get_cached_eod_data(mo_api, exchange)
            
            # Find our scripcode in the bulk response
            for eod_entry in eod_data_list:
                if str(eod_entry.get("scripcode")) == str(scripcode):
                    ltp, price_source = extract_price_with_fallback(eod_entry)
                    if ltp > 0:
                        data = eod_entry  # Use EOD entry for remaining fields
                        logger.info(f"✓ Found {clean_symbol} in bulk EOD: ₹{ltp} (source: {price_source})")
                        break
        
        if ltp <= 0:
            logger.warning(f"No valid price available for {clean_symbol} ({scripcode}) - all fields zero")
            return None
        
        # Get the actual previous day's close for accurate change calculation
        # The field hierarchy matters:
        # - 'prevClose' or 'prevclose' = actual previous trading day's close
        # - 'close' = current day's close (which might be same as ltp during market hours)
        # We should prioritize prevClose to avoid showing 0% change when using close as LTP fallback
        prev_close = float(data.get('prevClose', 0)) / 100.0
        if prev_close <= 0:
            prev_close = float(data.get('prevclose', 0)) / 100.0
        if prev_close <= 0:
            # Only use 'close' as last resort for prev_close
            prev_close = float(data.get('close', 0)) / 100.0
        
        # Calculate change and percent change
        # If we can't find prev_close and using fallback price, set change to 0
        if prev_close > 0:
            change = ltp - prev_close
            percent_change = (change / prev_close * 100.0)
        else:
            # No previous close available - show 0 change
            prev_close = ltp
            change = 0.0
            percent_change = 0.0

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
            'price_source': price_source,  # 'ltp', 'close', or 'prevClose'
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
