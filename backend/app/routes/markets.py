import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import time as dt_time
from flask import Blueprint, jsonify

from app.moapi import get_mo_api_client
from app.services.market_data import MO_INDEX_CATALOG
from app.socket_manager import MO_WebSocket_Manager
from app.services.market_time import get_current_ist_time, is_market_holiday

# --- Configuration ---
logger = logging.getLogger(__name__)
markets_bp = Blueprint("markets", __name__)

# --- In-memory caches ---
_ltp_bulk_cache = {"data": {}, "ts": 0.0}
_ltp_bulk_cache_lock = threading.Lock()
_market_payload_cache = {"payload": None, "ts": 0.0}
_indices_payload_cache = {"payload": None, "ts": 0.0}
_nifty50_constituents = []
LTP_BULK_CACHE_TTL = 30
MARKET_PAYLOAD_CACHE_TTL = 5
INDICES_PAYLOAD_CACHE_TTL = 5
MARKET_PAYLOAD_CACHE_TTL_CLOSED = 300   # 5 min cache when market is closed
LTP_BULK_CACHE_TTL_CLOSED = 600          # 10 min LTP bulk cache when market is closed
INDICES_PAYLOAD_CACHE_TTL_CLOSED = 300   # 5 min cache for indices when market is closed
MARKET_LTP_MAX_WORKERS = max(1, int(os.getenv("MARKET_LTP_MAX_WORKERS", "8")))
INDEX_LTP_MAX_WORKERS = max(1, int(os.getenv("INDEX_LTP_MAX_WORKERS", "8")))
MARKET_OPEN_DISPLAY_START = dt_time(9, 15)
MARKET_CLOSE_DISPLAY_END = dt_time(15, 30)

# Authoritative static Nifty 50 universe used by the movers endpoint.
# Scripcodes are pinned here so /market can skip the cold NSE master-data lookup.
NIFTY50_STATIC_CONSTITUENTS = [
    {"symbol": "ADANIENT.NSE", "name": "ADANIENT", "exchange": "NSE", "scripcode": 25},
    {"symbol": "ADANIPORTS.NSE", "name": "ADANIPORTS", "exchange": "NSE", "scripcode": 15083},
    {"symbol": "APOLLOHOSP.NSE", "name": "APOLLOHOSP", "exchange": "NSE", "scripcode": 157},
    {"symbol": "ASIANPAINT.NSE", "name": "ASIANPAINT", "exchange": "NSE", "scripcode": 236},
    {"symbol": "AXISBANK.NSE", "name": "AXISBANK", "exchange": "NSE", "scripcode": 5900},
    {"symbol": "BAJAJ-AUTO.NSE", "name": "BAJAJ-AUTO", "exchange": "NSE", "scripcode": 16669},
    {"symbol": "BAJFINANCE.NSE", "name": "BAJFINANCE", "exchange": "NSE", "scripcode": 317},
    {"symbol": "BAJAJFINSV.NSE", "name": "BAJAJFINSV", "exchange": "NSE", "scripcode": 16675},
    {"symbol": "BEL.NSE", "name": "BEL", "exchange": "NSE", "scripcode": 383},
    {"symbol": "BHARTIARTL.NSE", "name": "BHARTIARTL", "exchange": "NSE", "scripcode": 10604},
    {"symbol": "BPCL.NSE", "name": "BPCL", "exchange": "NSE", "scripcode": 526},
    {"symbol": "BRITANNIA.NSE", "name": "BRITANNIA", "exchange": "NSE", "scripcode": 547},
    {"symbol": "CIPLA.NSE", "name": "CIPLA", "exchange": "NSE", "scripcode": 694},
    {"symbol": "COALINDIA.NSE", "name": "COALINDIA", "exchange": "NSE", "scripcode": 20374},
    {"symbol": "DRREDDY.NSE", "name": "DRREDDY", "exchange": "NSE", "scripcode": 881},
    {"symbol": "EICHERMOT.NSE", "name": "EICHERMOT", "exchange": "NSE", "scripcode": 910},
    {"symbol": "ETERNAL.NSE", "name": "ETERNAL", "exchange": "NSE", "scripcode": 5097},
    {"symbol": "GRASIM.NSE", "name": "GRASIM", "exchange": "NSE", "scripcode": 1232},
    {"symbol": "HCLTECH.NSE", "name": "HCLTECH", "exchange": "NSE", "scripcode": 7229},
    {"symbol": "HDFCBANK.NSE", "name": "HDFCBANK", "exchange": "NSE", "scripcode": 1333},
    {"symbol": "HDFCLIFE.NSE", "name": "HDFCLIFE", "exchange": "NSE", "scripcode": 467},
    {"symbol": "HEROMOTOCO.NSE", "name": "HEROMOTOCO", "exchange": "NSE", "scripcode": 1348},
    {"symbol": "HINDALCO.NSE", "name": "HINDALCO", "exchange": "NSE", "scripcode": 1363},
    {"symbol": "HINDUNILVR.NSE", "name": "HINDUNILVR", "exchange": "NSE", "scripcode": 1394},
    {"symbol": "ICICIBANK.NSE", "name": "ICICIBANK", "exchange": "NSE", "scripcode": 4963},
    {"symbol": "ITC.NSE", "name": "ITC", "exchange": "NSE", "scripcode": 1660},
    {"symbol": "INDUSINDBK.NSE", "name": "INDUSINDBK", "exchange": "NSE", "scripcode": 5258},
    {"symbol": "INFY.NSE", "name": "INFY", "exchange": "NSE", "scripcode": 1594},
    {"symbol": "JSWSTEEL.NSE", "name": "JSWSTEEL", "exchange": "NSE", "scripcode": 11723},
    {"symbol": "KOTAKBANK.NSE", "name": "KOTAKBANK", "exchange": "NSE", "scripcode": 1922},
    {"symbol": "LT.NSE", "name": "LT", "exchange": "NSE", "scripcode": 11483},
    {"symbol": "M&M.NSE", "name": "M&M", "exchange": "NSE", "scripcode": 2031},
    {"symbol": "MARUTI.NSE", "name": "MARUTI", "exchange": "NSE", "scripcode": 10999},
    {"symbol": "NESTLEIND.NSE", "name": "NESTLEIND", "exchange": "NSE", "scripcode": 17963},
    {"symbol": "NTPC.NSE", "name": "NTPC", "exchange": "NSE", "scripcode": 11630},
    {"symbol": "ONGC.NSE", "name": "ONGC", "exchange": "NSE", "scripcode": 2475},
    {"symbol": "POWERGRID.NSE", "name": "POWERGRID", "exchange": "NSE", "scripcode": 14977},
    {"symbol": "RELIANCE.NSE", "name": "RELIANCE", "exchange": "NSE", "scripcode": 2885},
    {"symbol": "SBILIFE.NSE", "name": "SBILIFE", "exchange": "NSE", "scripcode": 21808},
    {"symbol": "SBIN.NSE", "name": "SBIN", "exchange": "NSE", "scripcode": 3045},
    {"symbol": "SUNPHARMA.NSE", "name": "SUNPHARMA", "exchange": "NSE", "scripcode": 3351},
    {"symbol": "TCS.NSE", "name": "TCS", "exchange": "NSE", "scripcode": 11536},
    {"symbol": "TATACONSUM.NSE", "name": "TATACONSUM", "exchange": "NSE", "scripcode": 3432},
    {"symbol": "TATAMOTORS.NSE", "name": "TATAMOTORS", "exchange": "NSE", "scripcode": 3456},
    {"symbol": "TATASTEEL.NSE", "name": "TATASTEEL", "exchange": "NSE", "scripcode": 3499},
    {"symbol": "TECHM.NSE", "name": "TECHM", "exchange": "NSE", "scripcode": 13538},
    {"symbol": "TITAN.NSE", "name": "TITAN", "exchange": "NSE", "scripcode": 3506},
    {"symbol": "TRENT.NSE", "name": "TRENT", "exchange": "NSE", "scripcode": 1964},
    {"symbol": "ULTRACEMCO.NSE", "name": "ULTRACEMCO", "exchange": "NSE", "scripcode": 11532},
    {"symbol": "WIPRO.NSE", "name": "WIPRO", "exchange": "NSE", "scripcode": 3787},
]

PRICE_KEYS = ("ltp", "indexvalue", "indexValue", "lastprice", "lastPrice", "close", "Close")
CHANGE_KEYS = ("change", "indexchange", "indexChange")
PERCENT_KEYS = ("percent_change", "percentChange", "pChange", "pchange", "indexpercentchange")
PREV_CLOSE_KEYS = ("prevclose", "prevClose", "previousclose", "previousClose", "close", "Close")


def _extract_number(entry, candidate_keys):
    """Extracts the first valid numeric value for the provided keys."""
    if not isinstance(entry, dict):
        return None

    for key in candidate_keys:
        if key in entry:
            value = entry.get(key)
        else:
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


def _split_movers(payload, limit=10):
    """Splits payload into two buckets: gainers (includes unchanged) and losers."""
    gainers = [stock for stock in payload if stock.get("change", 0) >= 0]
    losers = [stock for stock in payload if stock.get("change", 0) < 0]

    sorted_gainers = sorted(gainers, key=lambda item: item.get("percent_change", 0), reverse=True)[:limit]
    sorted_losers = sorted(losers, key=lambda item: item.get("percent_change", 0))[:limit]

    return {
        "gainers": sorted_gainers,
        "losers": sorted_losers,
        "gainer_count": len(gainers),
        "loser_count": len(losers),
        "unchanged_count": 0,
    }


def _is_live_market_window(now_ist=None) -> bool:
    now_ist = now_ist or get_current_ist_time()
    return (
        now_ist.weekday() < 5
        and not is_market_holiday(now_ist)
        and MARKET_OPEN_DISPLAY_START <= now_ist.time() <= MARKET_CLOSE_DISPLAY_END
    )


def _get_cached_market_payload(effective_ttl=MARKET_PAYLOAD_CACHE_TTL):
    payload = _market_payload_cache.get("payload")
    timestamp = float(_market_payload_cache.get("ts") or 0.0)
    if not payload or not timestamp:
        return None
    if (time.time() - timestamp) >= effective_ttl:
        _market_payload_cache["payload"] = None
        _market_payload_cache["ts"] = 0.0
        return None
    return dict(payload)


def _store_market_payload(payload):
    _market_payload_cache["payload"] = dict(payload)
    _market_payload_cache["ts"] = time.time()


def _get_cached_indices_payload(effective_ttl=INDICES_PAYLOAD_CACHE_TTL):
    payload = _indices_payload_cache.get("payload")
    timestamp = float(_indices_payload_cache.get("ts") or 0.0)
    if not payload or not timestamp:
        return None
    if (time.time() - timestamp) >= effective_ttl:
        _indices_payload_cache["payload"] = None
        _indices_payload_cache["ts"] = 0.0
        return None
    return dict(payload)


def _store_indices_payload(payload):
    _indices_payload_cache["payload"] = dict(payload)
    _indices_payload_cache["ts"] = time.time()


def _build_indices_response_payload(indices, market_status, provider_available=True):
    return {
        "success": True,
        "provider_available": bool(provider_available),
        "market_status": market_status,
        "indices": indices,
        "last_updated": int(time.time() * 1000),
    }


def _resolve_constituents() -> list[dict]:
    """Return the static Nifty 50 universe with pinned MO scripcodes."""
    global _nifty50_constituents

    if _nifty50_constituents and all(item.get("scripcode") is not None for item in _nifty50_constituents):
        return _nifty50_constituents

    _nifty50_constituents = [dict(item) for item in NIFTY50_STATIC_CONSTITUENTS]
    logger.info(
        "Nifty50 static universe loaded from pinned mapping: %d symbols, %d scripcodes resolved.",
        len(_nifty50_constituents),
        len(_nifty50_constituents),
    )
    return _nifty50_constituents


def _fetch_ltp_bulk(constituents: list[dict], mo_api, effective_ttl: float = LTP_BULK_CACHE_TTL) -> dict[str, dict]:
    """
    Fetch LTP + prev_close for all Nifty 50 stocks.
    Prioritizes WebSocket in-memory cache first, falling back to REST for missing symbols.
    """
    now = time.time()
    cached_data = _ltp_bulk_cache.get("data") or {}
    cached_ts = float(_ltp_bulk_cache.get("ts") or 0.0)
    if cached_data and (now - cached_ts) < effective_ttl:
        return cached_data

    if not constituents:
        return {}

    with _ltp_bulk_cache_lock:
        cached_data = _ltp_bulk_cache.get("data") or {}
        cached_ts = float(_ltp_bulk_cache.get("ts") or 0.0)
        if cached_data and (time.time() - cached_ts) < effective_ttl:
            return cached_data

        results = {}
        missing_constituents = []

        # 1. Query WebSocket Manager memory cache first
        try:
            socket_manager = MO_WebSocket_Manager()
            symbols = [item["symbol"] for item in constituents if item.get("symbol")]
            ws_cache = socket_manager.get_latest_stock_data(symbols)

            for item in constituents:
                symbol = item.get("symbol")
                scripcode = str(item.get("scripcode") or "")
                if not scripcode:
                    continue

                clean_sym = symbol.split('.')[0] if symbol and '.' in symbol else symbol
                ws_payload = ws_cache.get(symbol) or ws_cache.get(clean_sym)

                if ws_payload and ws_payload.get('ltp'):
                    ltp_val = float(ws_payload['ltp'])
                    prev_close_val = float(ws_payload.get('prev_close') or ws_payload.get('close') or ltp_val)
                    if ltp_val > 0 and prev_close_val > 0:
                        results[scripcode] = {
                            "ltp": round(ltp_val, 2),
                            "prev_close": round(prev_close_val, 2),
                        }
                        continue

                missing_constituents.append(item)
        except Exception as ws_err:
            logger.debug("Failed querying WS cache for bulk LTP, falling back to REST: %s", ws_err)
            missing_constituents = constituents

        # 2. Fetch missing symbols via REST ThreadPoolExecutor
        if missing_constituents:
            def _fetch_one(item):
                scripcode = int(item.get("scripcode") or 0)
                if not scripcode:
                    return None

                try:
                    response = mo_api.get_ltp_data("NSE", scripcode)
                    if not response or response.get("status") != "SUCCESS":
                        return None

                    data = response.get("data") or {}
                    if isinstance(data, list):
                        data = data[0] if data else {}
                    if not isinstance(data, dict):
                        return None

                    prev_close = float(data.get("close") or 0) / 100.0
                    ltp_price = float(data.get("ltp") or data.get("close") or 0) / 100.0
                    if ltp_price <= 0 or prev_close <= 0:
                        return None

                    return str(scripcode), {
                        "ltp": round(ltp_price, 2),
                        "prev_close": round(prev_close, 2),
                    }
                except Exception as exc:
                    logger.debug("Failed bulk LTP REST fetch for scripcode=%s: %s", scripcode, exc)
                    return None

            max_workers = min(MARKET_LTP_MAX_WORKERS, len(missing_constituents))
            executor = ThreadPoolExecutor(max_workers=max_workers)
            futures = {executor.submit(_fetch_one, item): item for item in missing_constituents}
            timed_out = False
            try:
                for future in as_completed(futures, timeout=20):
                    res = future.result()
                    if res:
                        scripcode, payload = res
                        results[scripcode] = payload
            except FuturesTimeoutError:
                timed_out = True
                logger.warning(
                    "Timed out waiting for REST LTP responses; returning partial data (%d/%d).",
                    len(results),
                    len(futures),
                )
                for future in futures:
                    if not future.done():
                        future.cancel()
            finally:
                executor.shutdown(wait=not timed_out, cancel_futures=timed_out)

        _ltp_bulk_cache["data"] = results
        _ltp_bulk_cache["ts"] = time.time()
        return results


def _build_market_payload(constituents, ltp_bulk=None, market_status="CLOSED"):
    ltp_bulk = ltp_bulk or {}

    stocks_payload = []
    for item in constituents:
        symbol = item["symbol"]
        scripcode = str(item.get("scripcode")) if item.get("scripcode") is not None else None
        ltp_entry = ltp_bulk.get(scripcode) if scripcode else {}
        prev_close = float((ltp_entry or {}).get("prev_close") or 0.0)

        price = float((ltp_entry or {}).get("ltp") or 0.0)
        change = 0.0
        percent_change = 0.0
        if price > 0 and prev_close > 0:
            change = price - prev_close
            percent_change = (change / prev_close) * 100.0

        stocks_payload.append({
            "symbol": symbol,
            "name": item.get("name") or symbol,
            "ltp": round(price, 2),
            "change": round(change, 2),
            "percent_change": round(percent_change, 2),
            "exchange": "NSE",
        })

    movers = _split_movers(stocks_payload, limit=10)
    return {
        "success": True,
        "provider_available": market_status == "OPEN",
        "market_name": "Nifty 50",
        "market_status": market_status,
        "total_count": len(stocks_payload),
        "gainers": movers["gainers"],
        "losers": movers["losers"],
        "gainer_count": movers["gainer_count"],
        "loser_count": movers["loser_count"],
        "unchanged": movers["unchanged_count"],
        "stocks": stocks_payload,
        "last_updated": int(time.time() * 1000),
    }


def _build_index_payload(name, exchange, code, ltp_payload=None):
    ltp_payload = ltp_payload or {}

    price = _extract_number(ltp_payload, PRICE_KEYS)
    prev_close = _extract_number(ltp_payload, PREV_CLOSE_KEYS)
    change = _extract_number(ltp_payload, CHANGE_KEYS)
    percent_change = _extract_number(ltp_payload, PERCENT_KEYS)

    if (not prev_close or prev_close <= 0) and change is not None and price is not None:
        approx_prev = price - change
        if approx_prev > 0:
            prev_close = approx_prev

    if (change is None or percent_change is None) and price and prev_close and prev_close > 0:
        change = price - prev_close
        percent_change = (change / prev_close) * 100.0

    if not price or price <= 0:
        return None

    if (change is None or percent_change is None) and (not prev_close or prev_close <= 0):
        return None

    if change is None:
        change = 0.0
    if percent_change is None:
        percent_change = 0.0

    return {
        "symbol": f"{exchange}:{code}",
        "name": name,
        "exchange": exchange,
        "price": round(float(price), 2),
        "change": round(float(change), 2),
        "percent_change": round(float(percent_change), 2),
        "entityType": "index",
        "prev_close": round(float(prev_close), 2) if prev_close and prev_close > 0 else 0.0,
    }


def _fetch_index_payloads_bulk(mo_api, index_catalog):
    """Fetch all configured index LTP payloads in parallel for cold /indices loads."""
    catalog_items = []
    for exchange, entries in index_catalog.items():
        for catalog_entry in entries:
            code = str(catalog_entry.get("code") or "").strip()
            name = catalog_entry.get("name") or f"{exchange}:{code}"
            if not code:
                logger.warning("Skipping index with missing code for %s: %s", exchange, catalog_entry)
                continue
            catalog_items.append((exchange, code, name))

    if not catalog_items:
        return []

    def _fetch_one(item):
        exchange, code, name = item
        try:
            ltp_resp = mo_api.get_index_ltp(exchange, int(code))
            ltp_data = _normalize_index_payload(ltp_resp)
            payload = _build_index_payload(name=name, exchange=exchange, code=code, ltp_payload=ltp_data)
            if not payload:
                logger.warning("Skipping incomplete index payload for %s:%s", exchange, code)
                return None
            return payload
        except Exception as exc:
            logger.warning("Failed fetching index payload for %s:%s: %s", exchange, code, exc)
            return None

    results = []
    max_workers = min(INDEX_LTP_MAX_WORKERS, len(catalog_items))
    executor = ThreadPoolExecutor(max_workers=max_workers)
    futures = {executor.submit(_fetch_one, item): item for item in catalog_items}
    timed_out = False
    try:
        for future in as_completed(futures, timeout=20):
            payload = future.result()
            if payload:
                results.append(payload)
    except FuturesTimeoutError:
        timed_out = True
        logger.warning(
            "Timed out waiting for index LTP responses; returning partial data (%d/%d).",
            len(results),
            len(futures),
        )
        for future in futures:
            if not future.done():
                future.cancel()
    finally:
        executor.shutdown(wait=not timed_out, cancel_futures=timed_out)

    return results

# --- API Routes ---

@markets_bp.route("/indices", methods=["GET"])
def get_market_indices():
    """Returns the full configured index catalog with direct MO index LTP data."""
    try:
        socket_manager = MO_WebSocket_Manager()
        now_ist = get_current_ist_time()
        in_live_window = _is_live_market_window(now_ist)
        market_status = "OPEN" if in_live_window else "CLOSED"
        effective_indices_ttl = INDICES_PAYLOAD_CACHE_TTL if in_live_window else INDICES_PAYLOAD_CACHE_TTL_CLOSED
        cache_max_age = 5 if in_live_window else 300
        cached_payload = _get_cached_indices_payload(effective_indices_ttl)
        if cached_payload:
            cached_payload["market_status"] = market_status
            response = jsonify(cached_payload)
            response.headers["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
            return response, 200

        cached_manager_indices = socket_manager.get_latest_indices_data()
        if cached_manager_indices:
            sorted_indices = sorted(cached_manager_indices, key=lambda item: (item.get("exchange", ""), item.get("name", "")))
            payload = _build_indices_response_payload(sorted_indices, market_status=market_status, provider_available=True)
            _store_indices_payload(payload)
            response = jsonify(payload)
            response.headers["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
            return response, 200

        mo_api = get_mo_api_client()
        if not mo_api.login():
            logger.error("API authentication failed in /indices endpoint.")
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        formatted_indices = []
        for payload in _fetch_index_payloads_bulk(mo_api, MO_INDEX_CATALOG):
            code = str(payload.get("symbol", "").split(":")[-1]).strip()
            latest_payload = {key: value for key, value in payload.items() if key != "prev_close"}
            formatted_indices.append(latest_payload)
            socket_manager.update_index_metadata(
                indexcode=code,
                name=payload.get("name"),
                exchange=payload.get("exchange"),
                prev_close=payload.get("prev_close"),
                latest_payload=latest_payload,
            )

        formatted_indices.sort(key=lambda item: (item["exchange"], item["name"]))
        payload = _build_indices_response_payload(formatted_indices, market_status=market_status, provider_available=True)
        _store_indices_payload(payload)

        response = jsonify(payload)
        response.headers["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
        return response, 200

    except Exception as e:
        logger.error(f"Error in /indices endpoint: {e}", exc_info=True)
        return jsonify({
            "success": False, 
            "message": "An internal server error occurred.",
            "indices": []
        }), 500


@markets_bp.route("/market", methods=["GET"])
def get_market():
    """Returns Nifty 50 gainers/losers from direct MO LTP data for the static universe."""
    try:
        mo_api = get_mo_api_client()
        now_ist = get_current_ist_time()
        in_live_window = _is_live_market_window(now_ist)
        effective_payload_ttl = MARKET_PAYLOAD_CACHE_TTL if in_live_window else MARKET_PAYLOAD_CACHE_TTL_CLOSED
        effective_ltp_ttl = LTP_BULK_CACHE_TTL if in_live_window else LTP_BULK_CACHE_TTL_CLOSED
        cache_max_age = 5 if in_live_window else 300
        cached_payload = _get_cached_market_payload(effective_payload_ttl)
        if cached_payload:
            cached_payload["market_status"] = "OPEN" if in_live_window else "CLOSED"
            response = jsonify(cached_payload)
            response.headers["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
            return response, 200

        provider_available = bool(mo_api.login())
        if not provider_available:
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        constituents = _resolve_constituents()
        if not constituents:
            return jsonify({"success": False, "message": "Could not load Nifty 50 constituents."}), 503

        market_status = "OPEN" if in_live_window else "CLOSED"

        ltp_bulk = _fetch_ltp_bulk(constituents, mo_api, effective_ltp_ttl)
        payload = _build_market_payload(constituents=constituents, ltp_bulk=ltp_bulk, market_status=market_status)
        payload["provider_available"] = True
        _store_market_payload(payload)

        response = jsonify(payload)
        response.headers["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
        return response, 200

    except Exception as e:
        logger.error(f"Error in /market endpoint: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500