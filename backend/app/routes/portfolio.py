import logging
import threading
import time
from decimal import Decimal
from collections import defaultdict, deque
from flask import Blueprint, jsonify
from flask_login import login_required, current_user
from app.models import Holding, Transaction, ShortPosition
# Import the centralized, cached function directly from the stock routes file
from .stock import get_stock_data_from_api, format_symbol
from app.services.market_time import get_market_session, MarketSession

# --- Configuration ---
logger = logging.getLogger(__name__)
portfolio_bp = Blueprint('portfolio', __name__)

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

        candidates = [symbol, cleaned_symbol, f"{cleaned_symbol}.NSE", f"{cleaned_symbol}.BSE"]
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
    # Use a set to fetch unique symbols only
    for symbol in set(symbols):
        # This call is fast due to the lru_cache in the get_stock_data_from_api function
        data = get_stock_data_from_api(symbol)
        cleaned_symbol = format_symbol(symbol)
        quote = _build_quote(cleaned_symbol, data, symbol)
        quote_map[symbol] = quote
        quote_map.setdefault(cleaned_symbol, quote)
    return quote_map

def _calculate_realized_pnl(user) -> Decimal:
    """
    Calculates the total realized profit or loss using FIFO lot matching.
    Prevents double-counting by tracking matched lot quantities.
    
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
    # NOTE: Older databases may not have Lot documents for historical trades.
    # To make realized P&L reliable across all users, compute FIFO P&L directly
    # from executed BUY/SELL transactions.
    realized_pnl = Decimal('0')

    executed = list(
        Transaction.objects(user=user, status="EXECUTED").order_by('transaction_date')
    )

    # FIFO queues by (symbol, product_type)
    fifo = defaultdict(deque)

    def _txn_dt(txn: Transaction):
        return txn.execution_date or txn.transaction_date

    # Process in chronological order of execution when possible.
    executed.sort(key=_txn_dt)

    for txn in executed:
        symbol = getattr(txn, 'symbol', None)
        action = (getattr(txn, 'action', '') or '').upper()
        product_type = getattr(txn, 'product_type', None) or 'CNC'

        if not symbol or action not in ('BUY', 'SELL'):
            continue

        qty = int(getattr(txn, 'quantity', 0) or 0)
        if qty <= 0:
            continue

        price = Decimal(str(getattr(txn, 'price', 0) or 0))
        key = (symbol, product_type)

        if action == 'BUY':
            fifo[key].append([qty, price])
            continue

        # SELL: match against prior buys for this symbol/product_type
        sell_remaining = qty
        while sell_remaining > 0 and fifo[key]:
            buy_qty, buy_price = fifo[key][0]
            matched = min(sell_remaining, buy_qty)
            realized_pnl += (price - buy_price) * Decimal(matched)
            buy_qty -= matched
            sell_remaining -= matched
            if buy_qty <= 0:
                fifo[key].popleft()
            else:
                fifo[key][0][0] = buy_qty

        if sell_remaining > 0:
            # Unmatched SELL (short sell or missing BUY history). Ignore for realized P&L.
            logger.warning(
                f"Realized P&L: Unmatched SELL for user {getattr(user, 'client_id', 'unknown')} "
                f"{symbol} {product_type}: qty={sell_remaining} (txn={txn.id})"
            )

    return realized_pnl

# --- API Routes ---

@portfolio_bp.route('/portfolio', methods=['GET'])
@login_required
def get_portfolio():
    """
    Fetches the user's complete portfolio, including holdings, cash balance,
    and performance metrics, using an efficient batch price lookup.
    Supports both CNC (delivery) and MIS (intraday) positions.
    """
    try:
        # --- Initial Data Fetch from Database ---
        user = current_user
        cnc_holdings = Holding.objects(user=user, product_type='CNC')
        mis_holdings = Holding.objects(user=user, product_type='MIS')
        short_positions = ShortPosition.objects(user=user, is_active=True)

        # Build an exit-plan lookup from existing pending bracket legs (if any)
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
        
        # --- Batch Fetch Live Prices (MAJOR OPTIMIZATION) ---
        all_symbols = [h.symbol for h in cnc_holdings] + [h.symbol for h in mis_holdings] + [s.symbol for s in short_positions]

        # Ensure these symbols are subscribed to the live websocket feed.
        # Run asynchronously so portfolio API latency is not tied to external provider latency.
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

        # --- Initialize Metrics ---
        cnc_holdings_list = []
        mis_holdings_list = []
        short_positions_list = []
        total_investment = Decimal('0')
        current_holdings_value = Decimal('0')
        previous_close_exposure = Decimal('0')
        todays_pnl = Decimal('0')
        has_stale_prices = False
        latest_price_asof = 0

        # --- Process CNC Holdings ---
        for holding in cnc_holdings:
            avg_price = Decimal(str(holding.average_price))
            quantity = Decimal(holding.quantity)
            investment_value = avg_price * quantity

            cleaned_symbol = format_symbol(holding.symbol)
            quote = live_quote_map.get(holding.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, holding.symbol)
            live_price = quote['ltp']
            market_value = live_price * quantity
            
            pnl = market_value - investment_value
            
            prev_close = quote['prev_close']
            change = quote['change']
            change_pct = quote['change_pct']
            day_pnl = (live_price - prev_close) * quantity if prev_close > 0 else Decimal('0')

            if quote['is_stale']:
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

        # --- Process MIS (Intraday) Holdings ---
        for holding in mis_holdings:
            avg_price = Decimal(str(holding.average_price))
            quantity = Decimal(holding.quantity)
            investment_value = avg_price * quantity

            cleaned_symbol = format_symbol(holding.symbol)
            quote = live_quote_map.get(holding.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, holding.symbol)
            live_price = quote['ltp']
            market_value = live_price * quantity
            
            pnl = market_value - investment_value
            
            prev_close = quote['prev_close']
            change = quote['change']
            change_pct = quote['change_pct']
            day_pnl = (live_price - prev_close) * quantity if prev_close > 0 else Decimal('0')

            if quote['is_stale']:
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

        # --- Process Short Positions (MIS only) ---
        for short_pos in short_positions:
            short_price = Decimal(str(short_pos.short_price))
            quantity = Decimal(short_pos.quantity)
            
            cleaned_symbol = format_symbol(short_pos.symbol)
            quote = live_quote_map.get(short_pos.symbol) or live_quote_map.get(cleaned_symbol) or _build_quote(cleaned_symbol, None, short_pos.symbol)
            live_price = quote['ltp']
            
            # For short positions: profit when price goes down
            # P&L = (short_price - current_price) * quantity
            pnl = (short_price - live_price) * quantity
            prev_close = quote['prev_close']
            change = quote['change']
            change_pct = quote['change_pct']
            day_pnl = (prev_close - live_price) * quantity if prev_close > 0 else Decimal('0')

            if quote['is_stale']:
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

        # Combine all holdings
        all_holdings = cnc_holdings_list + mis_holdings_list

        # --- Final Performance Calculations ---
        unrealized_pnl = current_holdings_value - total_investment
        
        # Add P&L from short positions
        short_pnl = sum(Decimal(str(s['unrealized_pnl'])) for s in short_positions_list)
        unrealized_pnl += short_pnl
        
        realized_pnl = _calculate_realized_pnl(user)
        total_pnl = unrealized_pnl + realized_pnl
        if is_pre_market:
            # Product rule: during 9:00-9:15 pre-market window, day change is forced to zero.
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

        return jsonify({
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
        }), 200

    except Exception as e:
        logger.error(f"Error fetching portfolio for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
