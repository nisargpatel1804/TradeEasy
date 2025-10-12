import logging
from decimal import Decimal
from flask import Blueprint, jsonify
from flask_login import login_required, current_user
from app.models import Holding, Transaction
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
    Calculates the total realized profit or loss from all sell transactions.
    Uses a simplified average cost basis for calculation.
    """
    realized_pnl = Decimal('0')
    sell_transactions = Transaction.objects(user=user, action="SELL")

    for sell_txn in sell_transactions:
        # Find all buy transactions for the same symbol that occurred before this sale
        buy_txns = Transaction.objects(
            user=user,
            symbol=sell_txn.symbol,
            action="BUY",
            transaction_date__lte=sell_txn.transaction_date
        )

        if not buy_txns:
            continue

        total_cost = sum(Decimal(str(b.price)) * Decimal(b.quantity) for b in buy_txns)
        total_qty = sum(b.quantity for b in buy_txns)
        
        if total_qty > 0:
            avg_buy_price = total_cost / Decimal(total_qty)
            profit_loss = (Decimal(str(sell_txn.price)) - avg_buy_price) * Decimal(sell_txn.quantity)
            realized_pnl += profit_loss
            
    return realized_pnl

# --- API Routes ---

@portfolio_bp.route('/portfolio', methods=['GET'])
@login_required
def get_portfolio():
    """
    Fetches the user's complete portfolio, including holdings, cash balance,
    and performance metrics, using an efficient batch price lookup.
    """
    try:
        # --- Initial Data Fetch from Database ---
        user = current_user
        holdings = Holding.objects(user=user)
        
        # --- Batch Fetch Live Prices (MAJOR OPTIMIZATION) ---
        symbols_to_fetch = [h.symbol for h in holdings]
        live_price_map = _get_live_price_map(symbols_to_fetch)

        # --- Initialize Metrics ---
        holdings_list = []
        total_investment = Decimal('0')
        current_holdings_value = Decimal('0')

        # --- Process Holdings for Unrealized P/L ---
        for holding in holdings:
            avg_price = Decimal(str(holding.average_price))
            quantity = Decimal(holding.quantity)
            investment_value = avg_price * quantity

            # Use the live price if available, otherwise fall back to the average buy price
            cleaned_symbol = format_symbol(holding.symbol)
            live_price = live_price_map.get(cleaned_symbol, avg_price)
            market_value = live_price * quantity
            
            pnl = market_value - investment_value
            
            holdings_list.append({
                "symbol": holding.symbol,
                "quantity": holding.quantity,
                "average_price": float(avg_price),
                "ltp": float(live_price),
                "investment_value": float(investment_value),
                "market_value": float(market_value),
                "unrealized_pnl": float(pnl)
            })
            total_investment += investment_value
            current_holdings_value += market_value

        # --- Final Performance Calculations ---
        unrealized_pnl = current_holdings_value - total_investment
        realized_pnl = _calculate_realized_pnl(user)
        total_pnl = unrealized_pnl + realized_pnl
        cash_balance = Decimal(str(user.balance))
        total_portfolio_value = cash_balance + current_holdings_value

        return jsonify({
            "success": True,
            "summary": {
                "cash_balance": float(cash_balance),
                "holdings_value": float(current_holdings_value),
                "total_portfolio_value": float(total_portfolio_value),
                "total_investment": float(total_investment),
                "unrealized_pnl": float(unrealized_pnl),
                "realized_pnl": float(realized_pnl),
                "total_pnl": float(total_pnl)
            },
            "holdings": holdings_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching portfolio for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
