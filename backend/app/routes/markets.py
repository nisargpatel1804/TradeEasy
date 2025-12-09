import logging
import time
from flask import Blueprint, jsonify
from flask_login import login_required
from mongoengine.queryset.visitor import Q
from app.socket_manager import MO_WebSocket_Manager
from app.models import AQScrip
from app.utils.market_indices import MAJOR_INDEX_TARGETS

# --- Configuration ---
logger = logging.getLogger(__name__)
markets_bp = Blueprint("markets", __name__)

# --- In-Memory Cache with TTL ---
_api_cache = {}
_index_lookup_warnings = set()
CACHE_TTL_SECONDS = 30  # Cache API responses for 30 seconds to reduce load

# --- Configuration for Major Market Indices ---
MARKET_INDEX_CONFIG = {
    "nifty50": {
        "display": "Nifty 50",
        "exchange": "NSE",
        "terms": ["NIFTY 50", "NIFTY50"],
        "codes": ["26009", "26000"],
    },
    "sensex": {
        "display": "S&P BSE Sensex",
        "exchange": "BSE",
        "terms": ["SENSEX"],
        "codes": ["999901"],
    },
}

PRICE_KEYS = ("ltp", "indexvalue", "indexValue", "lastprice", "lastPrice", "close", "Close")
CHANGE_KEYS = ("change", "indexchange", "indexChange")
PERCENT_KEYS = ("percent_change", "percentChange", "pChange", "pchange", "indexpercentchange")
PREV_CLOSE_KEYS = ("prevclose", "prevClose", "previousclose", "previousClose", "close", "Close")

STOCK_PRICE_KEYS = ("ltp", "LTP", "close", "Close", "lastprice", "LastPrice", "LastRate")
STOCK_PREV_CLOSE_KEYS = ("prevClose", "PrevClose", "prevclose", "PrevDayClose", "Close", "close")
SCRIP_LOOKUP_KEYS = ("token", "scripcode", "ScripCode", "InstrumentToken", "instrumenttoken")


def _extract_number(entry, candidate_keys):
    """Extracts the first valid numeric value for the provided keys."""
    if not isinstance(entry, dict):
        return None

    for key in candidate_keys:
        if key in entry:
            value = entry.get(key)
        else:
            # Support case-insensitive lookups without recreating the mapping each time
            matching_key = next((k for k in entry.keys() if isinstance(k, str) and k.lower() == key.lower()), None)
            value = entry.get(matching_key) if matching_key else None

        if value in (None, "", "NA", "NaN", "-", "null"):
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return None


def _normalize_index_payload(response):
    """Flattens the MO index LTP payload into a dictionary."""
    if not response:
        return {}

    data = response.get("data", response)
    if isinstance(data, list):
        return data[0] if data else {}
    if isinstance(data, dict):
        return data
    return {}

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

    logger.debug(f"Cache MISS for key: {cache_key}. Fetching from API.")
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


def _resolve_stock_price(entry, candidates):
    """Extracts and converts the first numeric value (stored in paisa) into rupees."""
    if not isinstance(entry, dict):
        return 0.0

    for key in candidates:
        if key in entry:
            value = entry.get(key)
            rupee_value = _to_rupees(value)
            if rupee_value > 0:
                return rupee_value

        # Case-insensitive fallback
        matching_key = next((k for k in entry.keys() if isinstance(k, str) and k.lower() == key.lower()), None)
        if matching_key:
            value = entry.get(matching_key)
            rupee_value = _to_rupees(value)
            if rupee_value > 0:
                return rupee_value

    return 0.0


def _split_movers(payload, limit=10):
    """Splits the stock payload into top gainers and losers."""
    gainers = [stock for stock in payload if stock.get("change", 0) > 0]
    losers = [stock for stock in payload if stock.get("change", 0) < 0]

    sorted_gainers = sorted(gainers, key=lambda item: item.get("percent_change", 0), reverse=True)[:limit]
    sorted_losers = sorted(losers, key=lambda item: item.get("percent_change", 0))[:limit]

    return {
        "gainers": sorted_gainers,
        "losers": sorted_losers,
        "gainer_count": len(gainers),
        "loser_count": len(losers),
        "unchanged_count": len(payload) - (len(gainers) + len(losers)),
    }

def _get_index_constituents(exchange, search_terms, preferred_codes=None):
    """Finds constituent scrips for a major index from the database."""
    normalized_exchange = (exchange or "").upper()
    normalized_terms = [term.strip() for term in (search_terms or []) if term]
    normalized_codes = [str(code).strip() for code in (preferred_codes or []) if code]

    base_query = Q(exchangename=normalized_exchange) & Q(instrumentname="INDEX")

    index_doc = None
    if normalized_codes:
        numeric_codes = []
        for code in normalized_codes:
            try:
                numeric_codes.append(int(code))
            except (TypeError, ValueError):
                continue
        if numeric_codes:
            index_doc = AQScrip.objects(base_query & Q(scripcode__in=numeric_codes)).first()

    if not index_doc and normalized_terms:
        term_query = Q()
        for term in normalized_terms:
            term_query |= Q(scripname__icontains=term) | Q(scripshortname__icontains=term)
        if term_query:
            index_doc = AQScrip.objects(base_query & term_query).first()

    if not index_doc:
        warning_key = (normalized_exchange, tuple(sorted(normalized_terms or normalized_codes)))
        if warning_key not in _index_lookup_warnings:
            logger.warning(f"Could not resolve index identifier for {normalized_terms or normalized_codes} on {normalized_exchange}")
            _index_lookup_warnings.add(warning_key)
        return []

    if not index_doc.indicesidentifier:
        logger.warning(f"Index document for {normalized_terms or normalized_codes} on {normalized_exchange} lacks indicesidentifier")
        return []

    return list(AQScrip.objects(
        exchangename=normalized_exchange,
        indicesidentifier=index_doc.indicesidentifier,
        instrumentname__ne="INDEX"  # Filter out the index itself from its own constituents
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
        
        index_payloads = {}

        for exchange in ["NSE", "BSE"]:
            try:
                master_resp = _get_cached_or_fetch(f"index_master_{exchange}", mo_api.get_index_data, exchange)

                if not (master_resp and master_resp.get("status") == "SUCCESS"):
                    logger.warning(f"Failed to fetch index master data for {exchange}")
                    continue

                master_list = master_resp.get("data", []) or []

                for entry in master_list:
                    try:
                        indexcode = str(entry.get("indexcode") or entry.get("IndexCode") or entry.get("scripcode"))
                        display_name = entry.get("indexname") or entry.get("IndexName") or entry.get("name")

                        if not indexcode or not display_name:
                            continue

                        price = _extract_number(entry, PRICE_KEYS)
                        change = _extract_number(entry, CHANGE_KEYS)
                        percent_change = _extract_number(entry, PERCENT_KEYS)
                        prev_close = _extract_number(entry, PREV_CLOSE_KEYS)

                        if not price or price <= 0:
                            cache_key = f"index_ltp_{exchange}_{indexcode}"
                            ltp_resp = _get_cached_or_fetch(cache_key, mo_api.get_index_ltp, exchange, indexcode)
                            ltp_data = _normalize_index_payload(ltp_resp)

                            price = _extract_number(ltp_data, PRICE_KEYS) or price
                            if change is None:
                                change = _extract_number(ltp_data, CHANGE_KEYS)
                            if percent_change is None:
                                percent_change = _extract_number(ltp_data, PERCENT_KEYS)
                            if not prev_close or prev_close <= 0:
                                prev_close = _extract_number(ltp_data, PREV_CLOSE_KEYS)

                        if not price or price <= 0:
                            continue

                        if (not prev_close or prev_close <= 0) and change is not None:
                            approx_prev = price - change
                            if approx_prev > 0:
                                prev_close = approx_prev

                        if (not prev_close or prev_close <= 0) and percent_change not in (None, 0):
                            try:
                                ratio = 1 + (percent_change / 100.0)
                                if ratio:
                                    approx_prev = price / ratio
                                    if approx_prev > 0:
                                        prev_close = approx_prev
                            except ZeroDivisionError:
                                pass

                        if change is None and prev_close and prev_close > 0:
                            change = price - prev_close

                        if percent_change is None and prev_close and prev_close > 0:
                            percent_change = ((price - prev_close) / prev_close) * 100

                        change = change if change is not None else 0.0
                        percent_change = percent_change if percent_change is not None else 0.0

                        symbol = f"{exchange}:{indexcode}"
                        payload = {
                            "symbol": symbol,
                            "name": display_name,
                            "exchange": exchange,
                            "price": round(price, 2),
                            "change": round(change, 2),
                            "percent_change": round(percent_change, 2),
                            "entityType": "index",
                        }

                        index_payloads[symbol] = payload
                        socket_manager.update_index_metadata(
                            indexcode=indexcode,
                            name=display_name,
                            exchange=exchange,
                            prev_close=prev_close,
                            latest_payload=payload,
                        )
                    except Exception as entry_error:
                        logger.error(f"Error processing index entry on {exchange}: {entry_error}", exc_info=True)
                        continue
            except Exception as exchange_error:
                logger.error(f"Error fetching indices for {exchange}: {exchange_error}", exc_info=True)
                continue

        if not index_payloads and MAJOR_INDEX_TARGETS:
            for exchange, targets in MAJOR_INDEX_TARGETS.items():
                for target in targets:
                    for code in target.get("codes", []):
                        symbol = f"{exchange}:{code}"
                        index_payloads[symbol] = {
                            "symbol": symbol,
                            "name": target.get("display") or symbol,
                            "exchange": exchange,
                            "price": 0.0,
                            "change": 0.0,
                            "percent_change": 0.0,
                            "entityType": "index",
                        }

        formatted_indices = sorted(index_payloads.values(), key=lambda item: (item["exchange"], item["name"]))

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

        constituents = _get_index_constituents(config['exchange'], config.get('terms'), config.get('codes'))
        if not constituents:
            return jsonify({"success": False, "message": "Could not load market constituents."}), 404

        price_response = _get_cached_or_fetch(f"bulk_eod_{config['exchange']}", mo_api.get_bulk_eod_data, config['exchange'])
        price_map = _normalize_price_map(price_response.get("data", {}) if price_response else {}, SCRIP_LOOKUP_KEYS)

        stocks_payload = []
        for scrip in constituents:
            price_data = price_map.get(str(scrip.scripcode))
            if not price_data:
                continue

            ltp = _resolve_stock_price(price_data, STOCK_PRICE_KEYS)
            prev_close = _resolve_stock_price(price_data, STOCK_PREV_CLOSE_KEYS)

            if ltp <= 0 or prev_close <= 0:
                continue

            change = ltp - prev_close
            percent_change = (change / prev_close) * 100 if prev_close else 0.0

            stocks_payload.append({
                "symbol": f"{scrip.scripshortname}.{config['exchange']}",
                "name": scrip.scripname.replace(" EQ", ""),
                "price": round(ltp, 2),
                "change": round(change, 2),
                "percent_change": round(percent_change, 2),
                "exchange": config['exchange'],
            })
        
        stocks_payload.sort(key=lambda x: x['symbol'])

        movers = _split_movers(stocks_payload, limit=10)

        return jsonify({
            "success": True,
            "market_name": config['display'],
            "total_count": len(stocks_payload),
            "gainers": movers["gainers"],
            "losers": movers["losers"],
            "gainer_count": movers["gainer_count"],
            "loser_count": movers["loser_count"],
            "unchanged": movers["unchanged_count"],
            "stocks": stocks_payload,
            "last_updated": int(time.time() * 1000)
        })

    except Exception as e:
        logger.error(f"Error in /markets/{market_name} endpoint: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
