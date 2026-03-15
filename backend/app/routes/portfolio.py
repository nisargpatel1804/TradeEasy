import logging
import threading
from decimal import Decimal
from collections import defaultdict, deque
from flask import Blueprint, jsonify
from flask_login import login_required, current_user
from app.models import Holding, Transaction, Lot, ShortPosition
# Import the centralized, cached function directly from the stock routes file
from .stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logger = logging.getLogger(__name__)
portfolio_bp = Blueprint('portfolio', __name__)

# --- Helper Functions ---

def _get_live_price_map(symbols: list) -> dict:
    """
    Builds a map of live prices by directly calling the cached API function.
    This is highly efficient for fetching prices for all user holdings.
    """
    price_map = {}
    # Use a set to fetch unique symbols only
    for symbol in set(symbols):
        # This call is fast due to the lru_cache in the get_stock_data_from_api function
        data = get_stock_data_from_api(symbol)
        if data and data.get('ltp'):
            # Use the cleaned base symbol as the key for consistency
            cleaned_symbol = format_symbol(symbol)
            price_map[cleaned_symbol] = Decimal(str(data['ltp']))
    return price_map

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

        live_price_map = _get_live_price_map(all_symbols)

        # --- Initialize Metrics ---
        cnc_holdings_list = []
        mis_holdings_list = []
        short_positions_list = []
        total_investment = Decimal('0')
        current_holdings_value = Decimal('0')

        # --- Process CNC Holdings ---
        for holding in cnc_holdings:
            avg_price = Decimal(str(holding.average_price))
            quantity = Decimal(holding.quantity)
            investment_value = avg_price * quantity

            cleaned_symbol = format_symbol(holding.symbol)
            live_price = live_price_map.get(cleaned_symbol, avg_price)
            market_value = live_price * quantity
            
            pnl = market_value - investment_value
            
            cnc_holdings_list.append({
                "symbol": holding.symbol,
                "quantity": holding.quantity,
                "reserved_quantity": holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0,  # CRITICAL FIX #17
                "available_quantity": holding.quantity - (holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0),  # CRITICAL FIX #17
                "average_price": float(avg_price),
                "ltp": float(live_price),
                "investment_value": float(investment_value),
                "market_value": float(market_value),
                "unrealized_pnl": float(pnl),
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

        # --- Process MIS (Intraday) Holdings ---
        for holding in mis_holdings:
            avg_price = Decimal(str(holding.average_price))
            quantity = Decimal(holding.quantity)
            investment_value = avg_price * quantity

            cleaned_symbol = format_symbol(holding.symbol)
            live_price = live_price_map.get(cleaned_symbol, avg_price)
            market_value = live_price * quantity
            
            pnl = market_value - investment_value
            
            mis_holdings_list.append({
                "symbol": holding.symbol,
                "quantity": holding.quantity,
                "reserved_quantity": holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0,  # CRITICAL FIX #17
                "available_quantity": holding.quantity - (holding.reserved_quantity if hasattr(holding, 'reserved_quantity') else 0),  # CRITICAL FIX #17
                "average_price": float(avg_price),
                "ltp": float(live_price),
                "investment_value": float(investment_value),
                "market_value": float(market_value),
                "unrealized_pnl": float(pnl),
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

        # --- Process Short Positions (MIS only) ---
        for short_pos in short_positions:
            short_price = Decimal(str(short_pos.short_price))
            quantity = Decimal(short_pos.quantity)
            
            cleaned_symbol = format_symbol(short_pos.symbol)
            live_price = live_price_map.get(cleaned_symbol, short_price)
            
            # For short positions: profit when price goes down
            # P&L = (short_price - current_price) * quantity
            pnl = (short_price - live_price) * quantity
            
            short_positions_list.append({
                "symbol": short_pos.symbol,
                "quantity": short_pos.quantity,
                "short_price": float(short_price),
                "ltp": float(live_price),
                "unrealized_pnl": float(pnl),
                "product_type": "MIS_SHORT"
            })

        # Combine all holdings
        all_holdings = cnc_holdings_list + mis_holdings_list

        # --- Final Performance Calculations ---
        unrealized_pnl = current_holdings_value - total_investment
        
        # Add P&L from short positions
        short_pnl = sum(Decimal(str(s['unrealized_pnl'])) for s in short_positions_list)
        unrealized_pnl += short_pnl
        
        realized_pnl = _calculate_realized_pnl(user)
        total_pnl = unrealized_pnl + realized_pnl
        cash_balance = Decimal(str(user.balance))
        total_portfolio_value = cash_balance + current_holdings_value

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
                "total_pnl": float(total_pnl)
            },
            "holdings": all_holdings,
            "cnc_holdings": cnc_holdings_list,
            "mis_holdings": mis_holdings_list,
            "short_positions": short_positions_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching portfolio for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
