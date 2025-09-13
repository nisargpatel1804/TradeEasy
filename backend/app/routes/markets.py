import logging
import time
from datetime import datetime
import pytz
from flask import Blueprint, jsonify, request, current_app
from flask_login import login_required
from app.moapi.mo_api import MotilalOswalAPI

# Import the batch function from stock.py for efficient data fetching
from app.stock.routes import batch_stock_data

# Import the list of Nifty 50 stocks
from app.utils.nifty50_constants import NIFTY_50_STOCKS_WITH_SCRIPCODES

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
markets_bp = Blueprint("markets", __name__)

# --- Constants ---
MAJOR_INDICES = [
    {"name": "NIFTY 50", "symbol": "NIFTY", "scripcode": "999920000"},
    {"name": "SENSEX", "symbol": "SENSEX", "scripcode": "999920001"},
    {"name": "NIFTY BANK", "symbol": "NIFTYBANK", "scripcode": "999920005"},
]

# --- In-memory Caching ---
_CACHE = {}

# --- Helper Functions ---
def _is_market_open():
    """Checks if the Indian stock market is currently open."""
    try:
        ist = pytz.timezone('Asia/Kolkata')
        now_ist = datetime.now(ist)
        is_weekday = now_ist.weekday() < 5
        is_market_hours = datetime.strptime("09:15", "%H:%M").time() <= now_ist.time() <= datetime.strptime("15:30", "%H:%M").time()
        return is_weekday and is_market_hours
    except Exception as e:
        logger.error(f"Error checking market status: {e}")
        return False

def batch_stock_data_internal(symbols_str):
    """Calls the batch_stock_data endpoint internally."""
    with current_app.test_request_context(f'/api/stocks/batch?symbols={symbols_str}'):
        return batch_stock_data()

# --- Core Data Fetching Logic ---
def _get_cached_data(cache_key, fetch_function, ttl_open, ttl_closed):
    """Generic caching and data fetching mechanism."""
    market_open = _is_market_open()
    cache_ttl = ttl_open if market_open else ttl_closed
    
    now = time.time()
    cached_item = _CACHE.get(cache_key)
    if cached_item and (now - cached_item['timestamp'] < cache_ttl):
        logger.info(f"Returning cached data for '{cache_key}'")
        return cached_item['data']
    
    logger.info(f"Fetching fresh data for '{cache_key}'")
    data = fetch_function()
    if data: # Only cache successful fetches
        _CACHE[cache_key] = {'timestamp': now, 'data': data}
    return data

def _fetch_nifty50_constituents(sort_by='name', sort_order='asc'):
    """
    Fetches and sorts Nifty 50 constituent stock data using an efficient batch API call.
    """
    symbols = [stock["symbol"] for stock in NIFTY_50_STOCKS_WITH_SCRIPCODES]
    
    batch_response = batch_stock_data_internal(','.join(symbols))
    live_data = batch_response.get_json().get('data', {})
    
    stocks_data = []
    for stock_info in NIFTY_50_STOCKS_WITH_SCRIPCODES:
        symbol = stock_info["symbol"]
        api_data = live_data.get(symbol, {})
        if not api_data.get('error'):
            stocks_data.append({
                "symbol": symbol, "name": stock_info["name"],
                "price": float(api_data.get("ltp", 0)),
                "change": float(api_data.get("change", 0)),
                "percent_change": float(api_data.get("p_change", 0))
            })

    stocks_data.sort(key=lambda x: x.get(sort_by, 0), reverse=(sort_order == 'desc'))
    return {"stocks": stocks_data, "market_open": _is_market_open()}

def _fetch_major_indices():
    """Fetches major index data from the API."""
    mo_api = MotilalOswalAPI()
    if not mo_api.auth_token and not mo_api.login():
        raise ConnectionError("Failed to log in to Motilal Oswal API.")
    
    indices_data = []
    for index_info in MAJOR_INDICES:
        response = mo_api.get_index_ltp_data("NSE", index_info["scripcode"])
        if response and response.get("status") == "SUCCESS":
            api_data = response.get("data", {})
            indices_data.append({
                "name": index_info["name"], "symbol": index_info["symbol"],
                "price": float(api_data.get("ltp", 0)),
                "change": float(api_data.get("change", 0)),
                "percent_change": float(api_data.get("p_change", 0))
            })
    return indices_data

# --- API Endpoints ---
@markets_bp.route("/indices", methods=["GET"])
@login_required
def get_market_indices():
    """Endpoint to get major market indices with intelligent caching."""
    try:
        data = _get_cached_data("indices", _fetch_major_indices, 15, 1800) # 15s cache when open, 30m when closed
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error in /indices endpoint: {e}")
        return jsonify({"error": "Failed to fetch market indices."}), 500

@markets_bp.route("/nifty50", methods=["GET"])
@login_required
def get_nifty50_stocks():
    """Endpoint to get Nifty 50 stocks with sorting."""
    try:
        sort_by = request.args.get('sort_by', 'name')
        sort_order = request.args.get('sort_order', 'asc')
        cache_key = f"nifty50_{sort_by}_{sort_order}"
        data = _get_cached_data(cache_key, lambda: _fetch_nifty50_constituents(sort_by, sort_order), 15, 1800)
        return jsonify(data)
    except Exception as e:
        logger.error(f"Error in /nifty50 endpoint: {e}")
        return jsonify({"error": "Failed to fetch Nifty 50 data."}), 500

@markets_bp.route("/gainers", methods=["GET"])
@login_required
def get_gainers():
    """Endpoint to get top 10 Nifty 50 gainers."""
    try:
        data = _get_cached_data("nifty50_gainers", lambda: _fetch_nifty50_constituents('percent_change', 'desc'), 15, 1800)
        gainers = [s for s in data['stocks'] if s['percent_change'] > 0][:10]
        return jsonify({"gainers": gainers, "market_open": data['market_open']})
    except Exception as e:
        logger.error(f"Error in /gainers endpoint: {e}")
        return jsonify({"error": "Failed to fetch top gainers."}), 500

@markets_bp.route("/losers", methods=["GET"])
@login_required
def get_losers():
    """Endpoint to get top 10 Nifty 50 losers."""
    try:
        data = _get_cached_data("nifty50_losers", lambda: _fetch_nifty50_constituents('percent_change', 'asc'), 15, 1800)
        losers = [s for s in data['stocks'] if s['percent_change'] < 0][:10]
        return jsonify({"losers": losers, "market_open": data['market_open']})
    except Exception as e:
        logger.error(f"Error in /losers endpoint: {e}")
        return jsonify({"error": "Failed to fetch top losers."}), 500

