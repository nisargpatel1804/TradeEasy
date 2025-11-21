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

def _normalize_price_map(raw_data, key_candidates):
    """Converts the API's price payload into a dictionary keyed by the first matching identifier."""
    if isinstance(raw_data, dict):
        return raw_data

    normalized = {}
    if isinstance(raw_data, list):
        for entry in raw_data:
            if not isinstance(entry, dict):
                continue

            for key in key_candidates:
                identifier = entry.get(key)
                if identifier is None or identifier == "":
                    continue

                normalized[str(identifier)] = entry
                break

    return normalized

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
    formatted_indices = []
    try:
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token and not mo_api.login():
            logger.error("API authentication failed in /indices endpoint.")
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        market_status = "OPEN" if mo_api.market_hours.is_market_open() else "CLOSED"
        
        # Define major indices to fetch live prices for
        MAJOR_INDICES = {
            "NSE": {"26000": "NIFTY 50"},
            "BSE": {"999901": "S&P BSE SENSEX"}
        }
        
        for exchange in ["NSE", "BSE"]:
            try:
                master_resp = _get_cached_or_fetch(f"index_master_{exchange}", mo_api.get_index_data, exchange)
                
                if not (master_resp and master_resp.get("status") == "SUCCESS"):
                    logger.warning(f"Failed to fetch index master data for {exchange}")
                    continue

                for index_info in master_resp.get("data", []):
                    indexcode = str(index_info.get("indexcode"))
                    
                    # For major indices, fetch live LTP
                    if indexcode in MAJOR_INDICES.get(exchange, {}):
                        try:
                            cache_key = f"index_ltp_{exchange}_{indexcode}"
                            ltp_resp = _get_cached_or_fetch(cache_key, mo_api.get_index_ltp, exchange, indexcode)
                            
                            if not (ltp_resp and ltp_resp.get("status") == "SUCCESS"):
                                logger.warning(f"Failed to fetch LTP for {exchange}:{indexcode}")
                                continue
                            
                            # Handle both dict and list responses
                            raw_data = ltp_resp.get("data", {})
                            if isinstance(raw_data, list):
                                ltp_data = raw_data[0] if raw_data else {}
                            else:
                                ltp_data = raw_data
                            
                            if not ltp_data:
                                logger.warning(f"Empty LTP data for {exchange}:{indexcode}")
                                continue
                            
                            logger.debug(f"Processing index {exchange}:{indexcode}")
                            
                            ltp = _to_rupees(ltp_data.get("ltp"))
                            if ltp <= 0:
                                logger.warning(f"Invalid LTP for {exchange}:{indexcode}: {ltp}")
                                continue
                            
                            # Try to get change and percent_change directly from API
                            change = _to_rupees(ltp_data.get("change"))
                            percent_change = None
                            
                            # Try different field names for percent change
                            pchange_raw = ltp_data.get("pChange") or ltp_data.get("percentChange") or ltp_data.get("percent_change")
                            if pchange_raw is not None:
                                try:
                                    percent_change = float(pchange_raw)
                                except (ValueError, TypeError):
                                    percent_change = None
                            
                            # If change/percent not directly available, calculate from prev close
                            if change == 0 and percent_change is None:
                                prev_close = _to_rupees(ltp_data.get("prevClose"))
                                if prev_close <= 0:
                                    prev_close = _to_rupees(ltp_data.get("prevclose"))
                                if prev_close <= 0:
                                    prev_close = _to_rupees(ltp_data.get("close"))
                                
                                logger.debug(f"Calculating change for {exchange}:{indexcode} - LTP: {ltp}, PrevClose: {prev_close}")
                                
                                if ltp > 0 and prev_close > 0 and ltp != prev_close:
                                    change = ltp - prev_close
                                    percent_change = (change / prev_close) * 100
                                    logger.debug(f"Calculated change: {change}, percent: {percent_change}")
                            
                            # If still no percent_change but we have change, calculate it
                            if percent_change is None and change != 0 and ltp > 0:
                                prev_close = ltp - change
                                if prev_close > 0:
                                    percent_change = (change / prev_close) * 100
                            
                            # Fallback: use index_info master data if available
                            if change == 0 and percent_change is None:
                                master_change = _to_rupees(index_info.get("change"))
                                master_pchange = index_info.get("pChange") or index_info.get("percentChange")
                                if master_change != 0:
                                    change = master_change
                                if master_pchange is not None:
                                    try:
                                        percent_change = float(master_pchange)
                                    except (ValueError, TypeError):
                                        pass
                            
                            # Final safety check: ensure we have valid values
                            if change is None:
                                change = 0.0
                            if percent_change is None:
                                percent_change = 0.0
                            
                            formatted_indices.append({
                                "symbol": f"{exchange}:{indexcode}",
                                "name": index_info.get("indexname"),
                                "price": round(ltp, 2),
                                "change": round(change, 2),
                                "percent_change": round(percent_change, 2),
                                "entityType": "index",
                            })
                        except Exception as e:
                            logger.error(f"Error processing index {exchange}:{indexcode}: {e}", exc_info=True)
                            continue
            except Exception as e:
                logger.error(f"Error fetching indices for {exchange}: {e}", exc_info=True)
                continue

        return jsonify({
            "success": True,
            "market_status": market_status,
            "indices": formatted_indices,
            "last_updated": int(time.time() * 1000)
        }), 200

    except Exception as e:
        logger.error(f"Error in /indices endpoint: {e}", exc_info=True)
        return jsonify({
            "success": False, 
            "message": "An internal server error occurred.",
            "indices": formatted_indices  # Return whatever we managed to fetch
        }), 500

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
                # Use prevClose (actual previous day's close) for accurate percent change
                prev_close = _to_rupees(price_data.get("prevClose"))
                if prev_close <= 0:
                    prev_close = _to_rupees(price_data.get("prevclose"))
                if prev_close <= 0:
                    # Fallback to close only if prevClose not available
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
