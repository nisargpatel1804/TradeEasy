import csv
import io
import logging
import time
from flask import Blueprint, jsonify
from flask_login import login_required
from mongoengine.queryset.visitor import Q
import requests
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

# Nifty 50 constituents CSV (official source)
NIFTY50_CSV_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv"
NIFTY50_CACHE_TTL_SECONDS = 6 * 60 * 60  # refresh every 6 hours
_nifty50_cache = {"symbols": [], "timestamp": 0.0}

# Static fallback list (used only when the CSV is unreachable and no cached list exists).
# This keeps the app functional during transient network/provider issues.
NIFTY50_STATIC_SYMBOLS = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK",
    "BAJAJ-AUTO", "BAJFINANCE", "BAJAJFINSV", "BEL", "BHARTIARTL",
    "BPCL", "BRITANNIA", "CIPLA", "COALINDIA", "DRREDDY",
    "EICHERMOT", "ETERNAL", "GRASIM", "HCLTECH", "HDFCBANK",
    "HDFCLIFE", "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK",
    "ITC", "INDUSINDBK", "INFY", "JSWSTEEL", "KOTAKBANK",
    "LT", "M&M", "MARUTI", "NESTLEIND", "NTPC",
    "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN",
    "SUNPHARMA", "TCS", "TATACONSUM", "TATAMOTORS", "TATASTEEL",
    "TECHM", "TITAN", "TRENT", "ULTRACEMCO", "WIPRO",
]

# NOTE: This module now focuses on Nifty 50 via the official CSV.
# Other market/constituent routes were intentionally removed per spec.

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


def _resolve_stock_price_eod(entry, candidates):
    """Extracts the first numeric price from EOD payload (values are already in rupees)."""
    if not isinstance(entry, dict):
        return 0.0

    for key in candidates:
        value = entry.get(key)
        if value in (None, "", "NA", "NaN", "-", "null"):
            value = None

        if value is None:
            matching_key = next((k for k in entry.keys() if isinstance(k, str) and k.lower() == key.lower()), None)
            value = entry.get(matching_key) if matching_key else None

        if value in (None, "", "NA", "NaN", "-", "null"):
            continue

        try:
            numeric = float(value)
            if numeric > 0:
                return numeric
        except (TypeError, ValueError):
            continue

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


def _fetch_nifty50_symbols() -> list[str]:
    """Fetch Nifty 50 constituent symbols (tickers) from the official CSV."""
    now = time.time()
    if _nifty50_cache["symbols"] and (now - _nifty50_cache["timestamp"] < NIFTY50_CACHE_TTL_SECONDS):
        return list(_nifty50_cache["symbols"])

    try:
        # Use browser-like headers to avoid being blocked by the server
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1"
        }

        # NiftyIndices can be slow/occasionally block default clients.
        # Try a couple times before falling back.
        resp = None
        last_error = None
        for attempt in range(2):
            try:
                resp = requests.get(NIFTY50_CSV_URL, headers=headers, timeout=(10, 30))
                resp.raise_for_status()
                break
            except Exception as exc:
                last_error = exc
                # Short sleep before retry
                time.sleep(1)

        if resp is None:
            raise last_error or RuntimeError("CSV fetch failed")

        content = resp.content.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(content))

        symbols: list[str] = []
        for row in reader:
            # Column is typically "Symbol"
            sym = (row.get("Symbol") or row.get("SYMBOL") or "").strip().upper()
            if sym:
                symbols.append(sym)

        # Keep order stable, de-dup just in case
        seen = set()
        deduped = []
        for sym in symbols:
            if sym in seen:
                continue
            seen.add(sym)
            deduped.append(sym)

        if deduped:
            _nifty50_cache["symbols"] = deduped
            _nifty50_cache["timestamp"] = now
            logger.info(f"Successfully fetched {len(deduped)} symbols from Nifty CSV.")
        return deduped
    except Exception as e:
        # Warn but don't error out - fallback to static list to keep app running
        logger.warning(f"Failed to fetch Nifty 50 CSV (using static fallback): {e}")
        
        # Best-effort fallback to last cached result
        cached = list(_nifty50_cache.get("symbols") or [])
        if cached:
            return cached
        return list(NIFTY50_STATIC_SYMBOLS)


def _seed_and_subscribe_nifty50(socket_manager: MO_WebSocket_Manager) -> list[dict]:
    """Ensure all Nifty 50 scrips are subscribed and seeded with initial snapshots."""
    mo_api = socket_manager.mo_api
    symbols = _fetch_nifty50_symbols()
    if not symbols:
        # Secondary fallback: derive constituents from the scrip master (index identifier)
        # if available in the database.
        try:
            docs = _get_index_constituents("NSE", search_terms=["NIFTY 50", "NIFTY50"], preferred_codes=["26000", "26009"])
            derived = []
            for doc in docs:
                if doc and doc.scripshortname:
                    derived.append(str(doc.scripshortname).upper())
            if derived:
                symbols = derived
        except Exception as e:
            logger.warning(f"Unable to derive Nifty 50 constituents from DB: {e}")

    if not symbols:
        return []

    # Resolve to MO scripcodes via master DB
    aq_scrips = list(AQScrip.objects(exchangename="NSE", scripshortname__in=symbols).only(
        "scripcode", "scripshortname", "scripname", "exchangename"
    ))
    by_short = {str(doc.scripshortname).upper(): doc for doc in aq_scrips if doc and doc.scripshortname}

    # Fetch bulk EOD once for seeding prev_close + fallback price.
    # NOTE: MO EOD values are already in rupees (not paisa).
    eod_list = []
    try:
        eod_resp = _get_cached_or_fetch("eod_bulk_NSE", mo_api.get_eod_data, "NSE")
        if eod_resp and eod_resp.get("status") == "SUCCESS":
            eod_list = eod_resp.get("data", []) or []
    except Exception as e:
        logger.warning(f"Unable to fetch NSE EOD bulk for seeding: {e}")

    eod_by_scrip = _normalize_price_map(eod_list, SCRIP_LOOKUP_KEYS) if eod_list else {}

    constituents: list[dict] = []
    subscribed_count = 0
    seeded_count = 0

    for ticker in symbols:
        doc = by_short.get(ticker)
        if not doc:
            logger.debug(f"Nifty50 ticker '{ticker}' not found in AQScrip.")
            continue

        full_symbol = f"{ticker}.NSE"
        scripcode = int(doc.scripcode)

        # Queue websocket subscription (idempotent)
        try:
            socket_manager.register_scrip(symbol=full_symbol, exchange="NSE", scripcode=scripcode, exchange_type="CASH")
            subscribed_count += 1
        except Exception as e:
            logger.warning(f"Failed to register websocket for {full_symbol}: {e}")

        # Seed prev_close + initial snapshot (so % change works immediately)
        price_data = eod_by_scrip.get(str(scripcode)) if eod_by_scrip else None
        if isinstance(price_data, dict):
            ltp = _resolve_stock_price_eod(price_data, STOCK_PRICE_KEYS)
            prev_close = _resolve_stock_price_eod(price_data, STOCK_PREV_CLOSE_KEYS)

            if prev_close > 0:
                composite_key = f"NSE:{scripcode}"
                with socket_manager.data_lock:
                    socket_manager.scrip_prev_close[composite_key] = prev_close

            if ltp > 0 and prev_close > 0:
                change = ltp - prev_close
                percent_change = (change / prev_close) * 100 if prev_close else 0.0
                payload = {
                    "symbol": full_symbol,
                    "ltp": round(ltp, 2),
                    "change": round(change, 2),
                    "percent_change": round(percent_change, 2),
                    "volume": int(price_data.get("volume", 0) or 0),
                    "price_source": "eod_seed",
                    "last_updated": int(time.time() * 1000),
                }
                with socket_manager.data_lock:
                    # Don't clobber a fresher websocket value, but DO replace empty/zero snapshots.
                    existing = socket_manager.latest_stock_data.get(full_symbol)
                    existing_ltp = 0.0
                    if isinstance(existing, dict):
                        try:
                            existing_ltp = float(existing.get("ltp") or 0.0)
                        except (TypeError, ValueError):
                            existing_ltp = 0.0

                    if not existing or existing_ltp <= 0:
                        socket_manager.latest_stock_data[full_symbol] = payload
                seeded_count += 1

        constituents.append({
            "symbol": full_symbol,
            "name": (doc.scripname or ticker).replace(" EQ", ""),
            "exchange": "NSE",
            "scripcode": scripcode,
        })

    logger.info(
        "Nifty50 init complete: %s constituents, %s registered, %s seeded",
        len(constituents),
        subscribed_count,
        seeded_count,
    )
    return constituents

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


@markets_bp.route("/market", methods=["GET"])
def get_market():
    """Returns Nifty 50 constituents + real-time movers (server-side)."""
    try:
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token and not mo_api.login():
            return jsonify({"success": False, "message": "Market data provider is currently unavailable."}), 503

        constituents = _seed_and_subscribe_nifty50(socket_manager)
        if not constituents:
            return jsonify({"success": False, "message": "Could not load Nifty 50 constituents."}), 503

        market_status = "OPEN" if mo_api.market_hours.is_market_open() else "CLOSED"

        # Build stock payload from the websocket manager's latest cache
        symbols = [item["symbol"] for item in constituents]
        latest_map = socket_manager.get_latest_stock_data(symbols=symbols)

        stocks_payload = []
        for item in constituents:
            symbol = item["symbol"]
            latest = latest_map.get(symbol) or {}
            ltp = float(latest.get("ltp") or 0.0)
            change = float(latest.get("change") or 0.0)
            percent_change = float(latest.get("percent_change") or 0.0)
            stocks_payload.append({
                "symbol": symbol,
                "name": item.get("name") or symbol,
                "ltp": round(ltp, 2),
                "change": round(change, 2),
                "percent_change": round(percent_change, 2),
                "exchange": "NSE",
            })

        # Movers should be classified from live websocket-derived fields
        movers = _split_movers(stocks_payload, limit=10)

        return jsonify({
            "success": True,
            "market_name": "Nifty 50",
            "market_status": market_status,
            "total_count": len(stocks_payload),
            "gainers": movers["gainers"],
            "losers": movers["losers"],
            "gainer_count": movers["gainer_count"],
            "loser_count": movers["loser_count"],
            "unchanged": movers["unchanged_count"],
            "stocks": sorted(stocks_payload, key=lambda x: x["symbol"]),
            "last_updated": int(time.time() * 1000),
        }), 200

    except Exception as e:
        logger.error(f"Error in /market endpoint: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500