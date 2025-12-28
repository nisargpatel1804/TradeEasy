import logging
import time
from flask import Blueprint, jsonify, request
from app.models import AQScrip, Stock
from app.socket_manager import MO_WebSocket_Manager

# --- Configuration ---
logger = logging.getLogger(__name__)
stock_bp = Blueprint('stock', __name__)

# Module-level caches to avoid redundant API calls
_eod_cache = {}
EOD_CACHE_TTL = 300  # 5 minutes

_stock_data_cache = {}
STOCK_DATA_CACHE_TTL = 2  # seconds; keep small so UI stays fresh

def _get_cached_eod_data(mo_api, exchange: str, provider_available: bool = True) -> list:
    """Fetches and caches bulk EOD data for an exchange to minimize API calls."""
    cache_key = f"eod_bulk_{exchange}"
    now = time.time()
    
    if cache_key in _eod_cache:
        cached_data, timestamp = _eod_cache[cache_key]
        if now - timestamp < EOD_CACHE_TTL:
            logger.debug(f"EOD cache HIT for {exchange}")
            return cached_data
    
    logger.info(f"EOD cache MISS for {exchange}")
    # If provider is unavailable, avoid remote call and return empty list
    if not provider_available:
        logger.debug("MO provider unavailable - skipping remote EOD fetch")
        return []

    response = mo_api.get_eod_data(exchange)
    if response and response.get("status") == "SUCCESS":
        eod_data = response.get("data", [])
        _eod_cache[cache_key] = (eod_data, now)
        return eod_data
    
    return []

def format_symbol(symbol: str) -> str:
    """Cleans and standardizes a stock symbol by removing exchange suffixes."""
    if not isinstance(symbol, str):
        return ""
    clean_symbol = symbol.strip().upper()
    if '.' in clean_symbol:
        return clean_symbol.split('.')[0]
    return clean_symbol


def _iter_instrument_candidates(symbol: str) -> list[dict]:
    """Return ordered list of instrument candidates for a given base symbol.

    We prefer the daily master (AQScrip) and keep Stock docs as fallback.
    This protects against stale/incorrect scripcodes stored in user watchlist.
    """
    candidates: list[dict] = []
    seen: set[tuple[str, int]] = set()

    def _add(exchange: str, scripcode: int, source: str):
        key = (exchange.upper(), int(scripcode))
        if key in seen:
            return
        seen.add(key)
        candidates.append({"exchange": key[0], "scripcode": key[1], "source": source})

    # 1) Master table (preferred)
    aq_nse = AQScrip.objects(exchangename='NSE', scripshortname=symbol).first()
    if aq_nse:
        _add('NSE', aq_nse.scripcode, 'AQScrip:NSE')

    aq_bse = AQScrip.objects(exchangename='BSE', scripshortname=symbol).first()
    if aq_bse:
        _add('BSE', aq_bse.scripcode, 'AQScrip:BSE')

    # 2) Any existing Stock docs (fallback)
    # symbol is base (e.g., TCS); watchlist may store TCS.NS / TCS.NSE etc.
    for stock_doc in Stock.objects(symbol__istartswith=symbol)[:5]:
        if stock_doc.exchange and stock_doc.scripcode:
            _add(stock_doc.exchange, stock_doc.scripcode, f"Stock:{stock_doc.symbol}")

    return candidates

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

def get_stock_data_from_api(symbol: str) -> dict | None:
    """
    The centralized, cached function to fetch comprehensive stock data for a given symbol.
    It resolves the scripcode and uses the authenticated MO API instance.
    Falls back to EOD bulk data when LTP is unavailable (market closed).
    """
    clean_symbol = format_symbol(symbol)
    if not clean_symbol:
        return None

    now = time.time()
    cached = _stock_data_cache.get(clean_symbol)
    if cached:
        cached_data, cached_at = cached
        if now - cached_at < STOCK_DATA_CACHE_TTL:
            return cached_data

    try:
        # Get the singleton instance of the manager and its authenticated API object
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        provider_available = True
        if not getattr(mo_api, "auth_token", None):
            # avoid raising - prefer local fallbacks when provider is down
            if not mo_api.login():
                provider_available = False
                logger.warning("MO API login failed; falling back to cached/local data where possible.")

        # --- Step 1: Resolve Symbol to candidate instruments ---
        candidates = _iter_instrument_candidates(clean_symbol)
        if not candidates:
            logger.warning(f"Could not resolve instrument for symbol: {clean_symbol}")
            return None

        # --- Step 2: Try candidates until we get usable price data ---
        data = None
        exchange = None
        scripcode = None
        price_source = 'unavailable'
        ltp = 0.0

        for candidate in candidates:
            exchange = candidate['exchange']
            scripcode = candidate['scripcode']

            data = None
            # Only call remote API if provider available
            if provider_available:
                response = mo_api.get_ltp_data(exchange, scripcode)
                if response and response.get("status") == "SUCCESS" and response.get("data"):
                    data = response.get("data")
                else:
                    logger.debug(
                        f"No valid LTP data from API for {clean_symbol} ({exchange}:{scripcode}) [source={candidate.get('source')}]"
                    )
            else:
                logger.debug(f"Skipping remote LTP fetch for {clean_symbol} because provider is unavailable")

            # 'data' is already set when provider is available; use it directly.
            ltp, price_source = extract_price_with_fallback(data)

            if ltp <= 0:
                logger.info(f"LTP is zero for {clean_symbol}, attempting bulk EOD fallback ({exchange}:{scripcode})")
                eod_data_list = _get_cached_eod_data(mo_api, exchange, provider_available=provider_available)
                for eod_entry in eod_data_list:
                    if str(eod_entry.get("scripcode")) == str(scripcode):
                        candidate_ltp, candidate_source = extract_price_with_fallback(eod_entry)
                        if candidate_ltp > 0:
                            data = eod_entry
                            ltp = candidate_ltp
                            price_source = candidate_source
                            logger.info(
                                f"✓ Found {clean_symbol} in bulk EOD: ₹{ltp} (source: {price_source}) [{exchange}:{scripcode}]"
                            )
                            break

            if ltp > 0:
                # Optional: heal stale Stock docs that share this base symbol.
                try:
                    Stock.objects(symbol__istartswith=clean_symbol).update(
                        set__exchange=exchange,
                        set__scripcode=int(scripcode),
                    )
                except Exception:
                    # Best-effort only; do not fail the request.
                    pass

                break

        if not data or not exchange or not scripcode or ltp <= 0:
            logger.warning(f"No valid price available for {clean_symbol} (tried {len(candidates)} candidates)")
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

        result = {
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

        # Cache only successful responses.
        _stock_data_cache[clean_symbol] = (result, now)
        return result

    except Exception as e:
        logger.error(f"Error in get_stock_data_from_api for '{clean_symbol}': {e}", exc_info=True)
        # Clear only this symbol's cached entry on failure to allow retries
        _stock_data_cache.pop(clean_symbol, None)
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
