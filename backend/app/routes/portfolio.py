import logging
from decimal import Decimal, InvalidOperation
from flask import Blueprint, jsonify, current_app
from flask_login import login_required, current_user
from app.models import Holding, Transaction

# IMPORTANT: Import the batch function from stock.py
# Note: The 'routes' part might not be needed depending on your project structure.
# If you get an import error, try 'from app.stock import batch_stock_data'
from app.stock.routes import batch_stock_data

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
bp = Blueprint('portfolio', __name__)


# --- Helper Function for Internal API Calls ---
def batch_stock_data_internal(symbols_str):
    """
    Calls the batch_stock_data endpoint internally without a real HTTP request.
    This allows different parts of the backend to efficiently reuse the batching logic.
    """
    # Create a test request context to simulate a request to the batch endpoint
    with current_app.test_request_context(f'/api/stocks/batch?symbols={symbols_str}'):
        # Call the function directly
        response = batch_stock_data()
        return response


@bp.route('/portfolio', methods=['GET'])
@login_required
def get_portfolio_and_performance():
    """
    Fetches the user's complete portfolio and performance metrics in a single,
    efficient API call using a batch request for live prices.
    """
    try:
        # --- Initial Data Fetch from Database ---
        balance = Decimal(str(current_user.balance))
        holdings = Holding.objects(user=current_user)
        sell_transactions = Transaction.objects(user=current_user, action="sell")
        recent_transactions = Transaction.objects(user=current_user).order_by('-transaction_date').limit(5)

        # --- Batch Fetch Live Prices (MAJOR OPTIMIZATION) ---
        symbols_to_fetch = [h.symbol for h in holdings]
        live_prices = {}
        if symbols_to_fetch:
            # Call the batch endpoint internally to get all prices at once
            batch_response = batch_stock_data_internal(','.join(symbols_to_fetch))
            # The response is a Flask Response object, so we get its JSON data
            live_data = batch_response.get_json().get('data', {})
            for symbol, data in live_data.items():
                if not data.get('error'):
                    live_prices[symbol] = Decimal(str(data.get('ltp', 0)))

        # --- Initialize Metrics ---
        holdings_list = []
        total_investment = Decimal('0')
        current_holdings_value = Decimal('0')
        realized_profit_loss = Decimal('0')

        # --- Process Holdings for Unrealized P/L ---
        for holding in holdings:
            try:
                # Get the price from our pre-fetched dictionary; default to 0 if not found
                current_price = live_prices.get(holding.symbol, Decimal('0'))

                investment_value = holding.quantity * holding.average_price
                market_value = holding.quantity * current_price
                
                holdings_list.append({
                    "symbol": holding.symbol, "quantity": holding.quantity,
                    "average_price": float(holding.average_price),
                    "current_price": float(current_price),
                    "investment_value": float(investment_value),
                    "current_value": float(market_value),
                    "profit_loss": float(market_value - investment_value),
                })
                
                total_investment += investment_value
                current_holdings_value += market_value

            except (InvalidOperation, TypeError) as e:
                logger.error(f"Error processing holding {holding.symbol}: {e}")
                continue
        
        # --- Process Sell Transactions for Realized P/L (Simplified FIFO) ---
        for sell_txn in sell_transactions:
            buy_txns = Transaction.objects(user=current_user, symbol=sell_txn.symbol, action="buy", transaction_date__lte=sell_txn.transaction_date)
            if not buy_txns: continue

            total_cost = sum(b.price * b.quantity for b in buy_txns)
            total_qty = sum(b.quantity for b in buy_txns)
            avg_buy_price = total_cost / total_qty if total_qty > 0 else 0

            if avg_buy_price > 0:
                realized_profit_loss += (sell_txn.price - avg_buy_price) * sell_txn.quantity
        
        # --- Final Calculations ---
        unrealized_profit_loss = current_holdings_value - total_investment
        total_portfolio_value = balance + current_holdings_value
        
        transactions_list = [{
            "symbol": t.symbol, "action": t.action, "quantity": t.quantity,
            "price": float(t.price), "date": t.transaction_date.isoformat()
        } for t in recent_transactions]

        # --- Construct Final JSON Response ---
        return jsonify({
            "balance": float(balance),
            "portfolio_value": float(total_portfolio_value),
            "holdings_value": float(current_holdings_value),
            "total_investment": float(total_investment),
            "unrealized_profit_loss": float(unrealized_profit_loss),
            "realized_profit_loss": float(realized_profit_loss),
            "overall_profit_loss": float(unrealized_profit_loss + realized_profit_loss),
            "holdings": holdings_list,
            "recent_transactions": transactions_list
        }), 200

    except Exception as e:
        logger.error(f"Critical error fetching portfolio for user {current_user.id}: {e}")
        return jsonify({"error": "An internal error occurred while fetching portfolio data."}), 500

