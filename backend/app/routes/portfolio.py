import logging
import threading
import time
from copy import deepcopy
from decimal import Decimal
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from app.models import Holding, Transaction, ShortPosition
from app.services.cache import cache as app_cache
# Import the centralized, cached function directly from the stock routes file
from .stock import get_stock_data_from_api, format_symbol
from app.services.market_time import get_market_session, MarketSession

# --- Configuration ---
logger = logging.getLogger(__name__)
portfolio_bp = Blueprint('portfolio', __name__)

PORTFOLIO_CACHE_TTL_SECONDS = 5
PORTFOLIO_CACHE_STALE_SECONDS = 10
REALIZED_PNL_CACHE_TTL_SECONDS = 90

_portfolio_response_cache = {}
_portfolio_cache_lock = threading.Lock()
_portfolio_refresh_inflight = set()

# --- Helper Functions ---

def _to_decimal(value, default: str = '0') -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(default)


def _get_last_known_quote(symbol: str, cleaned_symbol: str) -> dict | None:
    """Attempts to retrieve a last-known quote from websocket manager caches."""
    try:
        from app.socket_manager import MO_WebSocket_Manager
        manager = MO_WebSocket_Manager()
        latest = getattr(manager, 'latest_stock_data', {}) or {}
        if not latest:
            return None

        candidates = [symbol, cleaned_symbol, f"{cleaned_symbol}.NSE"]
        for candidate in candidates:
            if candidate and candidate in latest:
                payload = latest.get(candidate) or {}
                ltp = _to_decimal(payload.get('ltp', 0))
                if ltp <= 0:
                    continue

                prev_close = _to_decimal(payload.get('prev_close', 0))
                change = _to_decimal(payload.get('change', 0))
                change_pct = _to_decimal(payload.get('percent_change', payload.get('change_pct', 0)))

                if prev_close > 0 and change == 0:
                    change = ltp - prev_close
                if prev_close > 0 and change_pct == 0:
                    change_pct = (change / prev_close) * Decimal('100')

                return {
                    'ltp': ltp,
                    'prev_close': prev_close if prev_close > 0 else ltp,
                    'change': change,
                    'change_pct': change_pct,
                    'is_stale': True,
                    'price_source': 'last_known_socket',
                    'last_updated': payload.get('last_updated'),
                }
    except Exception as err:
        logger.debug("Last-known quote lookup failed for %s: %s", symbol, err)
    return None


def _build_quote(cleaned_symbol: str, raw_data: dict | None, fallback_symbol: str) -> dict:
    """Builds a normalized quote payload with explicit freshness metadata."""
    if raw_data:
        ltp = _to_decimal(raw_data.get('ltp', 0))
        prev_close = _to_decimal(raw_data.get('close', 0))
        change = _to_decimal(raw_data.get('change', 0))
        change_pct = _to_decimal(raw_data.get('percent_change', 0))
        is_stale = bool(raw_data.get('is_stale', False))
        price_source = raw_data.get('price_source', 'ltp')
        last_updated = raw_data.get('last_updated')

        if ltp > 0:
            if prev_close <= 0:
                prev_close = ltp
            if prev_close > 0 and change == 0:
                change = ltp - prev_close
            if prev_close > 0 and change_pct == 0:
                change_pct = (change / prev_close) * Decimal('100')

            return {
                'ltp': ltp,
                'prev_close': prev_close,
                'change': change,
                'change_pct': change_pct,
                'is_stale': is_stale,
                'price_source': price_source,
                'last_updated': last_updated,
            }

    last_known = _get_last_known_quote(fallback_symbol, cleaned_symbol)
    if last_known:
        return last_known

    return {
        'ltp': Decimal('0'),
        'prev_close': Decimal('0'),
        'change': Decimal('0'),
        'change_pct': Decimal('0'),
        'is_stale': True,
        'price_source': 'unavailable',
        'last_updated': None,
    }


def _get_live_quote_map(symbols: list) -> dict:
    """
    Builds a normalized quote map used by portfolio summary and per-holding rows.
    """
    quote_map = {}
    unique_symbols = [s for s in set(symbols) if s]
    if not unique_symbols:
        return quote_map

    missing_symbols = []
    for symbol in unique_symbols:
        cleaned_symbol = format_symbol(symbol)
        socket_quote = _get_last_known_quote(symbol, cleaned_symbol)
        if socket_quote and _to_decimal(socket_quote.get('ltp', 0)) > 0:
            quote_map[symbol] = socket_quote
            quote_map.setdefault(cleaned_symbol, socket_quote)
        else:
            missing_symbols.append(symbol)

    if not missing_symbols:
        return quote_map

    # Only fetch symbols missing from websocket state.
    max_workers = min(4, len(missing_symbols))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(get_stock_data_from_api, symbol): symbol
            for symbol in missing_symbols
        }
        for future in as_completed(future_map):
            symbol = future_map[future]
            try:
                data = future.result()
            except Exception:
                data = None
            cleaned_symbol = format_symbol(symbol)
            quote = _build_quote(cleaned_symbol, data, symbol)
            quote_map[symbol] = quote
            quote_map.setdefault(cleaned_symbol, quote)

    return quote_map


def _parse_bool_arg(value, default: bool = True) -> bool:
    if value is None:
        return default
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'y', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'n', 'off'}:
        return False
    return default


def _should_include_holdings() -> bool:
    include_holdings = _parse_bool_arg(request.args.get('include_holdings'), default=True)
    fields = str(request.args.get('fields', '') or '').strip().lower()
    if not fields:
        return include_holdings

    tokens = {token.strip() for token in fields.split(',') if token.strip()}
    if 'holdings' in tokens:
        return True
    if 'summary' in tokens and 'holdings' not in tokens:
        return False
    return include_holdings


def _portfolio_cache_key(user_id: str, include_holdings: bool) -> str:
    variant = 'full' if include_holdings else 'summary'
    return f"portfolio:user:{user_id}:v1:{variant}"


def _get_portfolio_cache_entry(cache_key: str):
    now = time.time()
    with _portfolio_cache_lock:
        entry = _portfolio_response_cache.get(cache_key)
        if not entry:
            return None
        if entry.get('stale_until', 0) < now:
            _portfolio_response_cache.pop(cache_key, None)
            return None
        return entry


def _set_portfolio_cache_entry(cache_key: str, payload: dict):
    now = time.time()
    with _portfolio_cache_lock:
        _portfolio_response_cache[cache_key] = {
            'payload': payload,
            'fresh_until': now + PORTFOLIO_CACHE_TTL_SECONDS,
            'stale_until': now + PORTFOLIO_CACHE_TTL_SECONDS + PORTFOLIO_CACHE_STALE_SECONDS,
            'updated_at': int(now * 1000),
        }


def _mark_refresh_start(cache_key: str) -> bool:
    with _portfolio_cache_lock:
        if cache_key in _portfolio_refresh_inflight:
            return False
        _portfolio_refresh_inflight.add(cache_key)
        return True


def _mark_refresh_done(cache_key: str):
    with _portfolio_cache_lock:
        _portfolio_refresh_inflight.discard(cache_key)


def _cache_response_payload(payload: dict, from_cache: bool, stale: bool, refreshed_at: int | None = None) -> dict:
    body = deepcopy(payload)
    body['cache'] = {
        'hit': from_cache,
        'stale': stale,
        'refreshed_at': refreshed_at,
        'ttl_seconds': PORTFOLIO_CACHE_TTL_SECONDS,
    }
    return body


def _quote_for_position(quote: dict, fallback_price: Decimal) -> tuple[Decimal, Decimal, Decimal, Decimal, bool]:
    """
    Returns quote components with a safe fallback when live price is unavailable.

    If an instrument has no usable LTP, we fallback to a neutral price so portfolio
    P&L does not show artificial full-loss spikes from transient data outages.
    """
    ltp = _to_decimal(quote.get('ltp', 0))
    prev_close = _to_decimal(quote.get('prev_close', 0))
    change = _to_decimal(quote.get('change', 0))
    change_pct = _to_decimal(quote.get('change_pct', 0))
    is_stale = bool(quote.get('is_stale', False))

    if ltp <= 0:
        neutral = fallback_price if fallback_price > 0 else Decimal('0')
        return neutral, neutral, Decimal('0'), Decimal('0'), True

    if prev_close <= 0:
        prev_close = ltp

    return ltp, prev_close, change, change_pct, is_stale

def _calculate_realized_pnl_from_transactions(user) -> Decimal:
    """
    Calculates the total realized profit or loss using FIFO lot matching.
    
    The calculation works by:
    1. Finding all sell transactions
    2. For each sell, matching against purchase lots in FIFO order
    3. Calculating P&L based on actual purchase price of matched lots
    4. Tracking total matched quantity per lot to prevent double-counting
    
    Args:
        user: User object
    
    Returns:
        Decimal: Total realized P&L across all closed positions
    """
    realized_pnl = Decimal('0')

    def _txn_dt(txn: Transaction):
        return txn.execution_date or txn.transaction_date or datetime.utcnow()

    def _apply_fifo(fifo_state: defaultdict, txn: Transaction) -> Decimal:
        symbol = getattr(txn, 'symbol', None)
        action = (getattr(txn, 'action', '') or '').upper()
        product_type = getattr(txn, 'product_type', None) or 'CNC'

        if not symbol or action not in ('BUY', 'SELL'):
            return Decimal('0')

        qty = int(getattr(txn, 'quantity', 0) or 0)
        if qty <= 0:
            return Decimal('0')

        price = Decimal(str(getattr(txn, 'price', 0) or 0))
        key = (symbol, product_type)

        if action == 'BUY':
            fifo_state[key].append([qty, price])
            return Decimal('0')

        delta = Decimal('0')
        sell_remaining = qty
        while sell_remaining > 0 and fifo_state[key]:
            buy_qty, buy_price = fifo_state[key][0]
            matched = min(sell_remaining, buy_qty)
            delta += (price - buy_price) * Decimal(matched)
            buy_qty -= matched
            sell_remaining -= matched
            if buy_qty <= 0:
                fifo_state[key].popleft()
            else:
                fifo_state[key][0][0] = buy_qty

        if sell_remaining > 0:
            logger.warning(
                f"Realized P&L: Unmatched SELL for user {getattr(user, 'client_id', 'unknown')} "
                f"{symbol} {product_type}: qty={sell_remaining} (txn={txn.id})"
            )

        return delta

    try:
        executed_base_qs = Transaction.objects(user=user, status="EXECUTED")
        executed_count = executed_base_qs.count()
        if executed_count <= 0:
            return Decimal('0')

        latest_txn = executed_base_qs.only('id', 'execution_date', 'transaction_date').order_by('-transaction_date').first()
        latest_dt = latest_txn.execution_date or latest_txn.transaction_date if latest_txn else None
        latest_epoch = int(latest_dt.timestamp()) if latest_dt else 0

        state_key = f"portfolio:realized_pnl:state:user:{user.id}"
        state = app_cache.get(state_key) or {}

        state_count = int(state.get('processed_count', 0) or 0)
        state_epoch = int(state.get('last_processed_epoch', 0) or 0)
        can_incremental = bool(state) and executed_count >= state_count and latest_epoch >= state_epoch

        fifo = defaultdict(deque)
        if can_incremental:
            try:
                serialized_fifo = state.get('fifo', {}) or {}
                for skey, lots in serialized_fifo.items():
                    symbol, product_type = skey.split('|', 1)
                    fifo[(symbol, product_type)] = deque(
                        [[int(qty), Decimal(str(price))] for qty, price in (lots or [])]
                    )

                realized_pnl = Decimal(str(state.get('realized_pnl', 0) or 0))

                if executed_count == state_count and latest_epoch == state_epoch:
                    return realized_pnl

                last_dt = datetime.fromtimestamp(state_epoch) if state_epoch > 0 else datetime.utcfromtimestamp(0)
                new_txns = list(
                    executed_base_qs.filter(
                        __raw__={
                            '$or': [
                                {'transaction_date': {'$gt': last_dt}},
                                {'execution_date': {'$gt': last_dt}},
                            ]
                        }
                    )
                )
                new_txns.sort(key=_txn_dt)

                if len(new_txns) < max(0, executed_count - state_count):
                    can_incremental = False
                else:
                    for txn in new_txns:
                        realized_pnl += _apply_fifo(fifo, txn)
            except Exception as incremental_err:
                logger.debug("Incremental realized P&L path failed for user %s: %s", getattr(user, 'client_id', 'unknown'), incremental_err)
                can_incremental = False

        if not can_incremental:
            realized_pnl = Decimal('0')
            fifo = defaultdict(deque)
            executed = list(executed_base_qs.order_by('transaction_date'))
            executed.sort(key=_txn_dt)
            for txn in executed:
                realized_pnl += _apply_fifo(fifo, txn)

        serialized_fifo = {}
        for (symbol, product_type), lots in fifo.items():
            serialized_fifo[f"{symbol}|{product_type}"] = [
                [int(qty), str(price)] for qty, price in lots
            ]

        app_cache.set(
            state_key,
            {
                'processed_count': executed_count,
                'last_processed_epoch': latest_epoch,
                'realized_pnl': str(realized_pnl),
                'fifo': serialized_fifo,
            },
            ttl=REALIZED_PNL_CACHE_TTL_SECONDS,
        )

        return realized_pnl
    except Exception as calc_err:
        logger.warning("Realized P&L calculation failed for user %s: %s", getattr(user, 'client_id', 'unknown'), calc_err)
        return Decimal('0')


def _get_realized_pnl(user) -> Decimal:
    """Returns persisted realized P&L and recalculates when transaction state changed."""
    try:
        synced_at = getattr(user, 'realized_pnl_synced_at', None)
        persisted = getattr(user, 'realized_pnl', None)
        persisted_sell_count = int(getattr(user, 'realized_pnl_sell_count', 0) or 0)
        current_sell_count = Transaction.objects(user=user, status="EXECUTED", action="SELL").count()
        if synced_at is not None and persisted is not None and persisted_sell_count == current_sell_count:
            return Decimal(str(persisted))
    except Exception:
        pass

    realized = _calculate_realized_pnl_from_transactions(user)
    try:
        from datetime import datetime
        User = user.__class__
        sell_count = Transaction.objects(user=user, status="EXECUTED", action="SELL").count()
        User.objects(id=user.id).update_one(
            set__realized_pnl=float(realized),
            set__realized_pnl_synced_at=datetime.utcnow(),
            set__realized_pnl_sell_count=int(sell_count),
        )
    except Exception as persist_err:
        logger.warning("Failed to persist realized P&L for user %s: %s", getattr(user, 'client_id', 'unknown'), persist_err)

    return realized

# --- API Routes ---

def _compute_portfolio_payload(user, include_holdings: bool = True) -> dict:
    cnc_holdings = Holding.objects(user=user, product_type='CNC')
    mis_holdings = Holding.objects(user=user, product_type='MIS')
    short_positions = ShortPosition.objects(user=user, is_active=True)

    holding_keys = [(h.symbol, 'CNC') for h in cnc_holdings] + [(h.symbol, 'MIS') for h in mis_holdings]
    symbols_for_plans = list({sym for sym, _pt in holding_keys if sym})
    exit_plan_map = {}
    if symbols_for_plans:
        pending_plans = Transaction.objects(
            user=user,
            status='PENDING',
            action='SELL',
            symbol__in=symbols_for_plans,
        ).only(
            'id', 'symbol', 'product_type', 'order_type', 'bracket_order_type',
            'stop_loss_price', 'target_price', 'price', 'transaction_date'
        )

        def _dt(txn: Transaction):
            return txn.execution_date or txn.transaction_date

        for txn in pending_plans:
            symbol = getattr(txn, 'symbol', None)
            product_type = getattr(txn, 'product_type', None) or 'CNC'
            if not symbol:
                continue

            key = (symbol, product_type)
            plan = exit_plan_map.setdefault(key, {
                'stop_order_id': None,
                'stop_loss_price': None,
                'stop_dt': None,
                'target_order_id': None,
                'target_price': None,
                'target_dt': None,
            })

            bracket_type = getattr(txn, 'bracket_order_type', None)
            order_type = getattr(txn, 'order_type', None)
            txn_dt = _dt(txn)

            if bracket_type == 'STOP_LOSS' or order_type == 'STOP_LOSS':
                if plan['stop_dt'] is None or (txn_dt and txn_dt > plan['stop_dt']):
                    plan['stop_dt'] = txn_dt
                    plan['stop_order_id'] = str(txn.id)
                    if getattr(txn, 'stop_loss_price', None):
                        plan['stop_loss_price'] = float(txn.stop_loss_price)

            if bracket_type == 'TARGET' or (order_type == 'LIMIT' and getattr(txn, 'target_price', None) is not None):
                if plan['target_dt'] is None or (txn_dt and txn_dt > plan['target_dt']):
                    plan['target_dt'] = txn_dt
                    plan['target_order_id'] = str(txn.id)
                    if getattr(txn, 'target_price', None) is not None:
                        plan['target_price'] = float(txn.target_price)
                    else:
                        try:
                            plan['target_price'] = float(getattr(txn, 'price', 0) or 0)
                        except (TypeError, ValueError):
                            plan['target_price'] = None

    all_symbols = [h.symbol for h in cnc_holdings] + [h.symbol for h in mis_holdings] + [s.symbol for s in short_positions]
    if all_symbols:
        def _register_realtime_symbols_async(symbols):
            try:
                from app.socket_manager import MO_WebSocket_Manager
                MO_WebSocket_Manager().register_symbols_for_realtime(symbols)
            except Exception as sub_err:
                logger.warning("Portfolio realtime subscription failed: %s", sub_err)

        threading.Thread(
            target=_register_realtime_symbols_async,
            args=(all_symbols,),
            daemon=True,
            name="PortfolioRealtimeRegister",
        ).start()

    live_quote_map = _get_live_quote_map(all_symbols)
    now_ms = int(time.time() * 1000)
    market_session = get_market_session()
    is_pre_market = market_session == MarketSession.PRE_MARKET

    cnc_holdings_list = []
    mis_holdings_list = []
    short_positions_list = []
    total_investment = Decimal('0')
    current_holdings_value = Decimal('0')
    previous_close_exposure = Decimal('0')
    todays_pnl = Decimal('0')
    has_stale_prices = False
    latest_price_asof = 0

    for holding in cnc_holdings:
        avg_price = Decimal(str(holding.average_price))
        quantity = Decimal(holding.quantity)
        investment_value = avg_price * quantity
        cleaned_symbol = format_symbol(holding.symbol)
        quote = live_quote_map.get(holding.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, holding.symbol)
        live_price, prev_close, change, change_pct, quote_unusable = _quote_for_position(quote, avg_price)
        market_value = live_price * quantity
        pnl = market_value - investment_value
        day_pnl = (live_price - prev_close) * quantity if prev_close > 0 else Decimal('0')

        if quote['is_stale'] or quote_unusable:
            has_stale_prices = True
        if quote.get('last_updated'):
            try:
                latest_price_asof = max(latest_price_asof, int(quote.get('last_updated') or 0))
            except Exception:
                pass

        cnc_holdings_list.append({
            "symbol": holding.symbol,
            "quantity": holding.quantity,
            "reserved_quantity": holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0,
            "available_quantity": holding.quantity - (holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0),
            "average_price": float(avg_price),
            "ltp": float(live_price),
            "prev_close": float(prev_close),
            "change": float(change),
            "change_pct": float(change_pct),
            "is_stale": bool(quote['is_stale']),
            "price_source": quote['price_source'],
            "price_asof": int(quote['last_updated']) if quote.get('last_updated') else None,
            "investment_value": float(investment_value),
            "market_value": float(market_value),
            "unrealized_pnl": float(pnl),
            "todays_pnl": float(day_pnl),
            "product_type": "CNC",
            "exit_plan": {
                "stop_order_id": exit_plan_map.get((holding.symbol, 'CNC'), {}).get('stop_order_id'),
                "stop_loss_price": exit_plan_map.get((holding.symbol, 'CNC'), {}).get('stop_loss_price'),
                "target_order_id": exit_plan_map.get((holding.symbol, 'CNC'), {}).get('target_order_id'),
                "target_price": exit_plan_map.get((holding.symbol, 'CNC'), {}).get('target_price'),
            } if exit_plan_map.get((holding.symbol, 'CNC')) else None,
        })
        total_investment += investment_value
        current_holdings_value += market_value
        previous_close_exposure += (prev_close * quantity) if prev_close > 0 else Decimal('0')
        todays_pnl += day_pnl

    for holding in mis_holdings:
        avg_price = Decimal(str(holding.average_price))
        quantity = Decimal(holding.quantity)
        investment_value = avg_price * quantity
        cleaned_symbol = format_symbol(holding.symbol)
        quote = live_quote_map.get(holding.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, holding.symbol)
        live_price, prev_close, change, change_pct, quote_unusable = _quote_for_position(quote, avg_price)
        market_value = live_price * quantity
        pnl = market_value - investment_value
        day_pnl = (live_price - prev_close) * quantity if prev_close > 0 else Decimal('0')

        if quote['is_stale'] or quote_unusable:
            has_stale_prices = True
        if quote.get('last_updated'):
            try:
                latest_price_asof = max(latest_price_asof, int(quote.get('last_updated') or 0))
            except Exception:
                pass

        mis_holdings_list.append({
            "symbol": holding.symbol,
            "quantity": holding.quantity,
            "reserved_quantity": holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0,
            "available_quantity": holding.quantity - (holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0),
            "average_price": float(avg_price),
            "ltp": float(live_price),
            "prev_close": float(prev_close),
            "change": float(change),
            "change_pct": float(change_pct),
            "is_stale": bool(quote['is_stale']),
            "price_source": quote['price_source'],
            "price_asof": int(quote['last_updated']) if quote.get('last_updated') else None,
            "investment_value": float(investment_value),
            "market_value": float(market_value),
            "unrealized_pnl": float(pnl),
            "todays_pnl": float(day_pnl),
            "product_type": "MIS",
            "exit_plan": {
                "stop_order_id": exit_plan_map.get((holding.symbol, 'MIS'), {}).get('stop_order_id'),
                "stop_loss_price": exit_plan_map.get((holding.symbol, 'MIS'), {}).get('stop_loss_price'),
                "target_order_id": exit_plan_map.get((holding.symbol, 'MIS'), {}).get('target_order_id'),
                "target_price": exit_plan_map.get((holding.symbol, 'MIS'), {}).get('target_price'),
            } if exit_plan_map.get((holding.symbol, 'MIS')) else None,
        })
        total_investment += investment_value
        current_holdings_value += market_value
        previous_close_exposure += (prev_close * quantity) if prev_close > 0 else Decimal('0')
        todays_pnl += day_pnl

    for short_pos in short_positions:
        short_price = Decimal(str(short_pos.short_price))
        quantity = Decimal(short_pos.quantity)
        cleaned_symbol = format_symbol(short_pos.symbol)
        quote = live_quote_map.get(short_pos.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, short_pos.symbol)
        live_price, prev_close, change, change_pct, quote_unusable = _quote_for_position(quote, short_price)
        pnl = (short_price - live_price) * quantity
        day_pnl = (prev_close - live_price) * quantity if prev_close > 0 else Decimal('0')

        if quote['is_stale'] or quote_unusable:
            has_stale_prices = True
        if quote.get('last_updated'):
            try:
                latest_price_asof = max(latest_price_asof, int(quote.get('last_updated') or 0))
            except Exception:
                pass

        short_positions_list.append({
            "symbol": short_pos.symbol,
            "quantity": short_pos.quantity,
            "short_price": float(short_price),
            "ltp": float(live_price),
            "prev_close": float(prev_close),
            "change": float(change),
            "change_pct": float(change_pct),
            "is_stale": bool(quote['is_stale']),
            "price_source": quote['price_source'],
            "price_asof": int(quote['last_updated']) if quote.get('last_updated') else None,
            "todays_pnl": float(day_pnl),
            "unrealized_pnl": float(pnl),
            "product_type": "MIS_SHORT"
        })
        previous_close_exposure += (prev_close * quantity) if prev_close > 0 else Decimal('0')
        todays_pnl += day_pnl

    all_holdings = cnc_holdings_list + mis_holdings_list
    unrealized_pnl = current_holdings_value - total_investment
    short_pnl = sum(Decimal(str(s['unrealized_pnl'])) for s in short_positions_list)
    unrealized_pnl += short_pnl
    realized_pnl = _get_realized_pnl(user)
    total_pnl = unrealized_pnl + realized_pnl
    if is_pre_market:
        todays_pnl = Decimal('0')

    todays_pnl_pct = Decimal('0')
    if previous_close_exposure > 0:
        todays_pnl_pct = (todays_pnl / previous_close_exposure) * Decimal('100')
    total_pnl_pct = Decimal('0')
    if total_investment > 0:
        total_pnl_pct = (total_pnl / total_investment) * Decimal('100')

    cash_balance = Decimal(str(user.balance))
    total_portfolio_value = cash_balance + current_holdings_value
    price_asof = latest_price_asof or now_ms

    payload = {
        "success": True,
        "summary": {
            "cash_balance": float(cash_balance),
            "reserved_balance": float(user.reserved_balance),
            "available_balance": float(cash_balance - Decimal(str(user.reserved_balance))),
            "holdings_value": float(current_holdings_value),
            "total_portfolio_value": float(total_portfolio_value),
            "total_investment": float(total_investment),
            "unrealized_pnl": float(unrealized_pnl),
            "realized_pnl": float(realized_pnl),
            "total_pnl": float(total_pnl),
            "current_value": float(current_holdings_value),
            "invested_amount": float(total_investment),
            "todays_pnl": float(todays_pnl),
            "todays_pnl_pct": float(todays_pnl_pct),
            "total_pnl_pct": float(total_pnl_pct),
            "prev_close_exposure": float(previous_close_exposure),
            "price_asof": int(price_asof),
            "has_stale_prices": bool(has_stale_prices),
            "price_source": "mixed" if has_stale_prices else "live",
            "market_session": market_session,
            "calculation_contract": {
                "current_value": "sum(long_qty * ltp)",
                "invested_amount": "sum(long_qty * avg_price)",
                "todays_pnl": "sum((ltp-prev_close)*long_qty) + sum((prev_close-ltp)*short_qty)",
                "total_pnl": "realized_pnl + unrealized_pnl",
                "percentages": {
                    "total_pnl_pct": "total_pnl / invested_amount * 100",
                    "todays_pnl_pct": "todays_pnl / prev_close_exposure * 100"
                }
            },
            "invariants": {
                "total_pnl_equals_realized_plus_unrealized": True,
                "unrealized_equals_holdings_minus_invested_plus_short_pnl": True,
                "pre_market_todays_pnl_forced_zero": bool(is_pre_market)
            }
        },
        "holdings": all_holdings,
        "cnc_holdings": cnc_holdings_list,
        "mis_holdings": mis_holdings_list,
        "short_positions": short_positions_list
    }

    if not include_holdings:
        payload['holdings'] = []
        payload['cnc_holdings'] = []
        payload['mis_holdings'] = []
        payload['short_positions'] = []

    return payload


def _refresh_portfolio_cache_async(user_id: str, cache_key: str, include_holdings: bool):
    try:
        from app.models import User
        user = User.objects(id=user_id).first()
        if not user:
            return
        payload = _compute_portfolio_payload(user, include_holdings=include_holdings)
        _set_portfolio_cache_entry(cache_key, payload)
    except Exception as refresh_err:
        logger.warning("Async portfolio refresh failed for user %s: %s", user_id, refresh_err)
    finally:
        _mark_refresh_done(cache_key)


def _schedule_portfolio_refresh(user_id: str, cache_key: str, include_holdings: bool):
    if not _mark_refresh_start(cache_key):
        return
    threading.Thread(
        target=_refresh_portfolio_cache_async,
        args=(str(user_id), cache_key, include_holdings),
        daemon=True,
        name="PortfolioCacheRefresh",
    ).start()


@portfolio_bp.route('/portfolio', methods=['GET'])
@login_required
def get_portfolio():
    """Fetches portfolio with short-lived cache and stale-while-revalidate behavior."""
    try:
        user = current_user
        include_holdings = _should_include_holdings()
        cache_key = _portfolio_cache_key(str(user.id), include_holdings)
        cache_entry = _get_portfolio_cache_entry(cache_key)
        now = time.time()

        if cache_entry:
            is_fresh = now <= cache_entry.get('fresh_until', 0)
            cached_payload = cache_entry.get('payload') or {}
            refreshed_at = cache_entry.get('updated_at')
            if is_fresh:
                return jsonify(_cache_response_payload(cached_payload, from_cache=True, stale=False, refreshed_at=refreshed_at)), 200

            _schedule_portfolio_refresh(str(user.id), cache_key, include_holdings)
            return jsonify(_cache_response_payload(cached_payload, from_cache=True, stale=True, refreshed_at=refreshed_at)), 200

        payload = _compute_portfolio_payload(user, include_holdings=include_holdings)
        _set_portfolio_cache_entry(cache_key, payload)
        return jsonify(_cache_response_payload(payload, from_cache=False, stale=False, refreshed_at=int(now * 1000))), 200
    except Exception as e:
        logger.error(f"Error fetching portfolio for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
