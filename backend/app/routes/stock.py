import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, jsonify, request
from mongoengine.queryset.visitor import Q
from app.models import AQScrip, Stock
from app.socket_manager import MO_WebSocket_Manager

logger = logging.getLogger(__name__)
stock_bp = Blueprint('stock', __name__)

_eod_cache = {}
EOD_CACHE_TTL = 300
_stock_data_cache = {}
STOCK_DATA_CACHE_TTL = 2


def _parse_symbol_and_exchange(symbol: str) -> tuple[str, str | None]:
    clean_symbol = format_symbol(symbol)
    if not isinstance(symbol, str):
        return clean_symbol, None

    normalized = symbol.strip().upper()
    parts = normalized.split('.')
    if len(parts) >= 2:
        suffix = parts[-1]
        if suffix in ('NSE', 'BSE'):
            return clean_symbol, suffix
    return clean_symbol, None

def _get_cached_eod_data(mo_api, exchange: str, provider_available: bool = True) -> list:
    cache_key = f"eod_bulk_{exchange}"
    now = time.time()

    if cache_key in _eod_cache:
        cached_data, timestamp = _eod_cache[cache_key]
        if now - timestamp < EOD_CACHE_TTL:
            logger.debug("EOD cache HIT for %s", exchange)
            return cached_data

    logger.info("EOD cache MISS for %s", exchange)
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
    if not isinstance(symbol, str):
        return ""
    clean_symbol = symbol.strip().upper()
    if '.' in clean_symbol:
        return clean_symbol.split('.')[0]
    return clean_symbol


def _iter_instrument_candidates(symbol: str, preferred_exchange: str | None = None) -> list[dict]:
    candidates: list[dict] = []
    seen: set[tuple[str, int]] = set()

    def _add(exchange: str, scripcode: int, source: str):
        key = (exchange.upper(), int(scripcode))
        if key in seen:
            return
        seen.add(key)
        candidates.append({"exchange": key[0], "scripcode": key[1], "source": source})

    aq_matches = list(
        AQScrip.objects(
            Q(scripshortname=symbol) & (Q(exchangename='NSE') | Q(exchangename='BSE'))
        ).only('exchangename', 'scripcode')
    )
    for aq_doc in aq_matches:
        exch = str(getattr(aq_doc, 'exchangename', '')).upper()
        if exch in ('NSE', 'BSE') and getattr(aq_doc, 'scripcode', None):
            _add(exch, aq_doc.scripcode, f'AQScrip:{exch}')

    for stock_doc in Stock.objects(symbol__istartswith=symbol)[:5]:
        if stock_doc.exchange and stock_doc.scripcode:
            _add(stock_doc.exchange, stock_doc.scripcode, f"Stock:{stock_doc.symbol}")

    if preferred_exchange:
        preferred_exchange = preferred_exchange.upper()

    # Deterministic ordering avoids quote-source drift across calls.
    def _sort_key(item: dict):
        exch = str(item.get('exchange', '')).upper()
        preferred_rank = 0 if preferred_exchange and exch == preferred_exchange else 1
        return (preferred_rank, exch, int(item.get('scripcode', 0)))

    candidates.sort(key=_sort_key)
    return candidates


def _fetch_ltp_candidates_parallel(mo_api, candidates: list[dict]) -> dict[tuple[str, int], dict | None]:
    """Fetches candidate LTP payloads in parallel and returns them keyed by (exchange, scripcode)."""
    if not candidates:
        return {}

    max_workers = min(4, len(candidates))
    results: dict[tuple[str, int], dict | None] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(mo_api.get_ltp_data, candidate['exchange'], candidate['scripcode']): candidate
            for candidate in candidates
        }
        for future in as_completed(future_map):
            candidate = future_map[future]
            key = (candidate['exchange'], candidate['scripcode'])
            try:
                response = future.result()
                if response and response.get("status") == "SUCCESS" and response.get("data"):
                    results[key] = response.get("data")
                else:
                    results[key] = None
            except Exception:
                results[key] = None

    return results

def extract_price_with_fallback(api_data: dict) -> tuple[float, str]:
    if not api_data or not isinstance(api_data, dict):
        return (0.0, 'unavailable')

    ltp_paisa = api_data.get('ltp', 0)
    if ltp_paisa and ltp_paisa > 0:
        return (float(ltp_paisa) / 100.0, 'ltp')

    close_paisa = api_data.get('close', 0)
    if close_paisa and close_paisa > 0:
        return (float(close_paisa) / 100.0, 'close')

    prev_close_paisa = api_data.get('prevClose', 0)
    if prev_close_paisa and prev_close_paisa > 0:
        return (float(prev_close_paisa) / 100.0, 'prevClose')
    
    return (0.0, 'unavailable')

def get_stock_data_from_api(symbol: str) -> dict | None:
    clean_symbol, preferred_exchange = _parse_symbol_and_exchange(symbol)
    if not clean_symbol:
        return None

    cache_key = f"{clean_symbol}:{preferred_exchange or 'AUTO'}"

    now = time.time()
    cached = _stock_data_cache.get(cache_key)
    if cached:
        cached_data, cached_at = cached
        if now - cached_at < STOCK_DATA_CACHE_TTL:
            return cached_data

    try:
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api
        provider_available = bool(mo_api.login())
        if not provider_available:
            logger.warning("MO API login failed; falling back where possible")

        candidates = _iter_instrument_candidates(clean_symbol, preferred_exchange=preferred_exchange)
        if not candidates:
            return None

        data = None
        exchange = None
        scripcode = None
        price_source = 'unavailable'
        ltp = 0.0

        ltp_candidates = {}
        if provider_available:
            ltp_candidates = _fetch_ltp_candidates_parallel(mo_api, candidates)
        else:
            logger.debug("Skipping remote LTP fetch for %s because provider unavailable", clean_symbol)

        for candidate in candidates:
            exchange = candidate['exchange']
            scripcode = candidate['scripcode']

            data = ltp_candidates.get((exchange, scripcode)) if provider_available else None
            if provider_available and not data:
                logger.debug("No valid LTP data for %s (%s:%s)", clean_symbol, exchange, scripcode)

            ltp, price_source = extract_price_with_fallback(data)

            if ltp <= 0:
                logger.info("LTP is zero for %s, attempting bulk EOD fallback (%s:%s)", clean_symbol, exchange, scripcode)
                eod_data_list = _get_cached_eod_data(mo_api, exchange, provider_available=provider_available)
                for eod_entry in eod_data_list:
                    if str(eod_entry.get("scripcode")) == str(scripcode):
                        candidate_ltp, candidate_source = extract_price_with_fallback(eod_entry)
                        if candidate_ltp > 0:
                            data = eod_entry
                            ltp = candidate_ltp
                            price_source = candidate_source
                            logger.info("Found %s in bulk EOD: %s (%s:%s)", clean_symbol, ltp, exchange, scripcode)
                            break

            if ltp > 0:
                try:
                    Stock.objects(symbol__istartswith=clean_symbol).update(
                        set__exchange=exchange,
                        set__scripcode=int(scripcode),
                    )
                except Exception:
                    logger.debug("Failed to update Stock docs for %s", clean_symbol)
                break

        if not data or not exchange or not scripcode or ltp <= 0:
            logger.warning("No valid price available for %s", clean_symbol)
            return None

        prev_close = float(data.get('prevClose', 0)) / 100.0
        if prev_close <= 0:
            prev_close = float(data.get('prevclose', 0)) / 100.0
        if prev_close <= 0:
            prev_close = float(data.get('close', 0)) / 100.0

        if prev_close > 0:
            change = ltp - prev_close
            percent_change = (change / prev_close * 100.0)
        else:
            prev_close = ltp
            change = 0.0
            percent_change = 0.0

        is_stale = (price_source != 'ltp') or (not provider_available)
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
            'price_source': price_source,
            'provider_available': provider_available,
            'is_stale': is_stale,
            'last_updated': int(time.time() * 1000)
        }

        _stock_data_cache[cache_key] = (result, now)
        return result

    except Exception:
        logger.error("Error in get_stock_data_from_api for '%s'", clean_symbol, exc_info=True)
        _stock_data_cache.pop(cache_key, None)
        return None

@stock_bp.route("/stock/<string:symbol>", methods=["GET"])
def get_stock_details(symbol):
    try:
        api_data = get_stock_data_from_api(symbol)
        if not api_data:
            return jsonify({"success": False, "message": f"Data not available for symbol '{symbol}'."}), 404

        financials = {
            "market_cap": "N/A", "pe_ratio": "N/A", "dividend_yield": "N/A",
            "note": "Fundamental data requires a different data provider."
        }

        return jsonify({
            "success": True,
            "price_data": api_data,
            "financials": financials
        })
    except Exception:
        logger.error("Error in get_stock_details for %s", symbol, exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@stock_bp.route("/stocks/batch", methods=["GET"])
def batch_stock_data():
    symbols_param = request.args.get('symbols', '')
    if not symbols_param:
        return jsonify({"success": False, "message": "Query parameter 'symbols' is required."}), 400

    symbols = list(set(s.strip() for s in symbols_param.split(',') if s.strip()))
    if len(symbols) > 50:
        return jsonify({"success": False, "message": "Maximum of 50 symbols per batch request."}), 413

    batch_result = {}
    for symbol in symbols:
        data = get_stock_data_from_api(symbol)
        clean_symbol = format_symbol(symbol)
        if data:
            batch_result[clean_symbol] = data
        else:
            batch_result[clean_symbol] = {"error": "Data not found"}

    return jsonify({"success": True, "data": batch_result})
