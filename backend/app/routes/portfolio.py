import logging
from decimal import Decimal
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
    realized_pnl = Decimal('0')
    
    # Track total matched quantity per lot across ALL sells
    lot_matched_totals = {}  # lot_id -> total_matched_qty
    
    # Get all executed sell transactions
    sell_transactions = Transaction.objects(
        user=user, 
        action="SELL", 
        status="EXECUTED"
    ).order_by('transaction_date')

    for sell_txn in sell_transactions:
        # Skip if this is a bracket order leg (already counted with parent)
        if sell_txn.bracket_order_type in ('STOP_LOSS', 'TARGET'):
            continue
            
        sell_qty_remaining = sell_txn.quantity
        sell_price = Decimal(str(sell_txn.price))
        
        # Find lots to match against (FIFO - oldest first)
        # Match ALL lots including fully sold ones (quantity=0, is_active=False)
        # This is critical for accurate P&L calculation
        lots = Lot.objects(
            user=user,
            symbol=sell_txn.symbol,
            product_type=sell_txn.product_type if hasattr(sell_txn, 'product_type') else 'CNC',
            purchase_date__lte=sell_txn.transaction_date
        ).order_by('purchase_date')
        
        # Match lots in FIFO order
        for lot in lots:
            if sell_qty_remaining <= 0:
                break
            
            lot_id = str(lot.id)
            
            # Calculate how much of this lot has been matched across ALL previous sells
            already_matched_total = lot_matched_totals.get(lot_id, 0)
            available_from_lot = lot.original_quantity - already_matched_total
            
            if available_from_lot <= 0:
                continue
            
            # Determine how many shares from this lot to match for THIS sell
            qty_to_match = min(sell_qty_remaining, available_from_lot)
            
            # Calculate P&L for this matched portion
            purchase_price = Decimal(str(lot.purchase_price))
            pnl_for_lot = (sell_price - purchase_price) * Decimal(qty_to_match)
            realized_pnl += pnl_for_lot
            
            sell_qty_remaining -= qty_to_match
            
            # Update global tracking of this lot's matched quantity
            lot_matched_totals[lot_id] = already_matched_total + qty_to_match
            
            logger.debug(
                f"FIFO Match: Sold {qty_to_match} of {sell_txn.symbol} "
                f"@{sell_price} (bought @{purchase_price}) = P&L: {pnl_for_lot}"
            )
        
        # If there's still quantity remaining, it might be a short sale
        # (for MIS intraday trading) - handle separately
        if sell_qty_remaining > 0:
            logger.warning(
                f"Sell transaction {sell_txn.id} has {sell_qty_remaining} shares "
                f"not matched to any lots (possible short sale or data inconsistency)"
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
        
        # --- Batch Fetch Live Prices (MAJOR OPTIMIZATION) ---
        all_symbols = [h.symbol for h in cnc_holdings] + [h.symbol for h in mis_holdings] + [s.symbol for s in short_positions]
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
                "product_type": "CNC"
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
                "product_type": "MIS"
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
