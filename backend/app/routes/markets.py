import logging
import time
from flask import Blueprint, jsonify
from flask_login import login_required
from mongoengine.queryset.visitor import Q
from app.socket_manager import MO_WebSocket_Manager
from app.models import AQScrip

# --- Configuration ---
logger = logging.getLogger(__name__)
markets_bp = Blueprint("markets", __name__)

# --- In-Memory Cache with TTL ---
_api_cache = {}
CACHE_TTL_SECONDS = 30  # Cache API responses for 30 seconds to reduce load

# --- Configuration for Major Market Indices ---
MARKET_INDEX_CONFIG = {
    "nifty50": {"display": "Nifty 50", "exchange": "NSE", "terms": ["NIFTY 50"]},
    "sensex": {"display": "S&P BSE Sensex", "exchange": "BSE", "terms": ["SENSEX"]},
}

# --- Helper Functions ---

def _get_cached_or_fetch(cache_key, fetch_function, *args, **kwargs):
    """
    A simple time-based cache wrapper for API fetch functions to reduce redundant calls.
    """
    now = time.time()
    if cache_key in _api_cache:
        cached_data, timestamp = _api_cache[cache_key]
        if now - timestamp < CACHE_TTL_SECONDS:
            logger.debug(f"Cache HIT for key: {cache_key}")
            return cached_data
    
    logger.info(f"Cache MISS for key: {cache_key}. Fetching from API.")
    new_data = fetch_function(*args, **kwargs)
    if new_data and new_data.get("status") == "SUCCESS":
        _api_cache[cache_key] = (new_data, now)
    return new_data

def _to_rupees(paisa_value):
    """Safely converts a value from paisa to rupees."""
    try:
        return float(paisa_value or 0) / 100.0
    except (ValueError, TypeError):
        return 0.0

def _get_index_constituents(exchange, search_terms):
    """Finds constituent scrips for a major index from the database."""
    search_query = Q(exchangename=exchange) & (Q(scripname__in=search_terms) | Q(scripshortname__in=search_terms))
    index_doc = AQScrip.objects(search_query).first()
    
    if not index_doc or not index_doc.indicesidentifier:
        logger.warning(f"Could not resolve index identifier for {search_terms} on {exchange}")
        return []
    
    return list(AQScrip.objects(
        exchangename=exchange,
        indicesidentifier=index_doc.indicesidentifier,
        instrumentname__ne="INDEX" # Filter out the index itself from its own constituents
    ))

# --- API Routes ---

@markets_bp.route("/indices", methods=["GET"])
@login_required
def get_market_indices():
    """
    Provides a snapshot of major market indices by efficiently fetching and
    caching bulk data from the Motilal Oswal API.
    """
    try:
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token and not mo_api.login():
            logger.error("API authentication failed in /indices endpoint.")
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        market_status = "OPEN" if mo_api.market_hours.is_market_open() else "CLOSED"
        
        formatted_indices = []
        for exchange in ["NSE", "BSE"]:
            master_resp = _get_cached_or_fetch(f"index_master_{exchange}", mo_api.get_index_data, exchange)
            price_resp = _get_cached_or_fetch(f"bulk_eod_{exchange}", mo_api.get_bulk_eod_data, exchange)

            if not (master_resp and master_resp.get("status") == "SUCCESS" and price_resp and price_resp.get("status") == "SUCCESS"):
                continue

            price_map = price_resp.get("data", {})
            for index_info in master_resp.get("data", []):
                price_data = price_map.get(str(index_info.get("indexcode")))
                if price_data:
                    ltp = _to_rupees(price_data.get("ltp") or price_data.get("close"))
                    prev_close = _to_rupees(price_data.get("close"))
                    
                    if ltp > 0 and prev_close > 0:
                        change = ltp - prev_close
                        percent_change = (change / prev_close) * 100
                        
                        formatted_indices.append({
                            "symbol": f"{exchange}:{index_info.get('indexcode')}",
                            "name": index_info.get("indexname"),
                            "price": round(ltp, 2),
                            "change": round(change, 2),
                            "percent_change": round(percent_change, 2),
                        })

        return jsonify({
            "success": True,
            "market_status": market_status,
            "indices": formatted_indices,
            "last_updated": int(time.time() * 1000)
        })

    except Exception as e:
        logger.error(f"Error in /indices endpoint: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@markets_bp.route("/markets/<string:market_name>", methods=["GET"])
@login_required
def get_market_constituents(market_name):
    """
    Provides a detailed view of a specific market index, including the live prices
    of its constituent stocks.
    """
    config = MARKET_INDEX_CONFIG.get(market_name.lower())
    if not config:
        return jsonify({"success": False, "message": "Unsupported market index."}), 404

    try:
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token and not mo_api.login():
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        constituents = _get_index_constituents(config['exchange'], config['terms'])
        if not constituents:
            return jsonify({"success": False, "message": "Could not load market constituents."}), 404

        price_response = _get_cached_or_fetch(f"bulk_eod_{config['exchange']}", mo_api.get_bulk_eod_data, config['exchange'])
        price_map = price_response.get("data", {}) if price_response else {}

        stocks_payload, gainers, losers = [], 0, 0
        for scrip in constituents:
            price_data = price_map.get(str(scrip.scripcode))
            if price_data:
                ltp = _to_rupees(price_data.get("ltp") or price_data.get("close"))
                prev_close = _to_rupees(price_data.get("close"))
                if ltp > 0 and prev_close > 0:
                    change = ltp - prev_close
                    percent_change = (change / prev_close) * 100
                    if change > 0: gainers += 1
                    elif change < 0: losers += 1
                    
                    stocks_payload.append({
                        "symbol": f"{scrip.scripshortname}.{config['exchange']}",
                        "name": scrip.scripname.replace(" EQ", ""),
                        "price": round(ltp, 2),
                        "change": round(change, 2),
                        "percent_change": round(percent_change, 2),
                    })
        
        stocks_payload.sort(key=lambda x: x['symbol'])

        return jsonify({
            "success": True,
            "market_name": config['display'],
            "total_count": len(stocks_payload),
            "gainers": gainers,
            "losers": losers,
            "unchanged": len(stocks_payload) - (gainers + losers),
            "stocks": stocks_payload,
            "last_updated": int(time.time() * 1000)
        })

    except Exception as e:
        logger.error(f"Error in /markets/{market_name} endpoint: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
