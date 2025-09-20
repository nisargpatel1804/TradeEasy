import logging
from decimal import Decimal, InvalidOperation
from flask import Blueprint, jsonify, current_app
from flask_login import login_required, current_user
from app.models import Holding, Transaction

# IMPORTANT: Import the batch function from stock.py
# Note: The 'routes' part might not be needed depending on your project structure.
# If you get an import error, try 'from app.stock import batch_stock_data'
from app.routes.stock import batch_stock_data

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


@bp.route('/performance', methods=['GET'])
@login_required
def get_performance():
    """
    Fetches focused performance metrics for the user's portfolio.
    This provides a lightweight view of performance data without detailed holdings.
    """
    try:
        # --- Initial Data Fetch from Database ---
        balance = Decimal(str(current_user.balance))
        holdings = Holding.objects(user=current_user)
        sell_transactions = Transaction.objects(user=current_user, action="sell")
        all_transactions = Transaction.objects(user=current_user).order_by('-transaction_date')

        # --- Batch Fetch Live Prices (MAJOR OPTIMIZATION) ---
        symbols_to_fetch = [h.symbol for h in holdings]
        live_prices = {}
        if symbols_to_fetch:
            # Call the batch endpoint internally to get all prices at once
            batch_response = batch_stock_data_internal(','.join(symbols_to_fetch))
            if batch_response[1] == 200:  # Check if successful
                live_prices = batch_response[0].get_json().get("stocks", {})

        # --- Calculate Current Portfolio Values ---
        total_investment = Decimal(0)
        current_holdings_value = Decimal(0)
        realized_profit_loss = Decimal(0)
        total_trades = len(all_transactions)
        winning_trades = 0
        losing_trades = 0

        # Process holdings for unrealized P/L
        for holding in holdings:
            try:
                investment_value = holding.average_price * holding.quantity
                stock_data = live_prices.get(holding.symbol, {})
                current_price = Decimal(str(stock_data.get('ltp', holding.average_price)))
                market_value = current_price * holding.quantity
                
                total_investment += investment_value
                current_holdings_value += market_value

            except (InvalidOperation, TypeError) as e:
                logger.error(f"Error processing holding {holding.symbol}: {e}")
                continue
        
        # --- Process Sell Transactions for Realized P/L and Win/Loss Rate ---
        for sell_txn in sell_transactions:
            buy_txns = Transaction.objects(user=current_user, symbol=sell_txn.symbol, action="buy", transaction_date__lte=sell_txn.transaction_date)
            if not buy_txns: continue

            total_cost = sum(b.price * b.quantity for b in buy_txns)
            total_qty = sum(b.quantity for b in buy_txns)
            avg_buy_price = total_cost / total_qty if total_qty > 0 else 0

            if avg_buy_price > 0:
                trade_profit_loss = (sell_txn.price - avg_buy_price) * sell_txn.quantity
                realized_profit_loss += trade_profit_loss
                
                # Count winning/losing trades
                if trade_profit_loss > 0:
                    winning_trades += 1
                else:
                    losing_trades += 1
        
        # --- Performance Calculations ---
        unrealized_profit_loss = current_holdings_value - total_investment
        total_profit_loss = unrealized_profit_loss + realized_profit_loss
        total_portfolio_value = balance + current_holdings_value
        
        # Performance percentages
        total_return_percentage = (float(total_profit_loss) / float(total_investment) * 100) if total_investment > 0 else 0
        unrealized_return_percentage = (float(unrealized_profit_loss) / float(total_investment) * 100) if total_investment > 0 else 0
        realized_return_percentage = (float(realized_profit_loss) / float(total_investment) * 100) if total_investment > 0 else 0
        
        # Win rate
        total_closed_trades = winning_trades + losing_trades
        win_rate = (winning_trades / total_closed_trades * 100) if total_closed_trades > 0 else 0
        
        # Get daily performance (last 30 days)
        from datetime import datetime, timedelta
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        recent_transactions = list(Transaction.objects(user=current_user, transaction_date__gte=thirty_days_ago).order_by('transaction_date'))
        
        daily_performance = []
        # Get last 7 transactions safely
        last_transactions = recent_transactions[-7:] if len(recent_transactions) >= 7 else recent_transactions
        for txn in last_transactions:
            daily_performance.append({
                "date": txn.transaction_date.strftime('%Y-%m-%d'),
                "action": txn.action,
                "symbol": txn.symbol,
                "profit_loss": 0.0  # Will be calculated properly in future enhancement
            })

        # --- Construct Performance Response ---
        return jsonify({
            "total_investment": float(total_investment),
            "current_value": float(current_holdings_value),
            "total_portfolio_value": float(total_portfolio_value),
            "unrealized_profit_loss": float(unrealized_profit_loss),
            "realized_profit_loss": float(realized_profit_loss),
            "total_profit_loss": float(total_profit_loss),
            "total_return_percentage": round(total_return_percentage, 2),
            "unrealized_return_percentage": round(unrealized_return_percentage, 2),
            "realized_return_percentage": round(realized_return_percentage, 2),
            "cash_balance": float(balance),
            "statistics": {
                "total_trades": total_trades,
                "winning_trades": winning_trades,
                "losing_trades": losing_trades,
                "win_rate": round(win_rate, 2),
                "total_holdings": len(holdings)
            },
            "daily_performance": daily_performance
        }), 200

    except Exception as e:
        logger.error(f"Critical error fetching performance for user {current_user.id}: {e}")
        return jsonify({"error": "An internal error occurred while fetching performance data."}), 500

