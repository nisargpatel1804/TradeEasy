from flask import Blueprint, jsonify, session
from decimal import Decimal
from app.models import Holding, Transaction, User
from app.utils.scraper import get_stock_price  # Adjust path as needed
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint('performance', __name__)

@bp.route('/performance', methods=['GET'])
def get_performance():
    """
    Calculates and returns the user's portfolio performance, including:
    - Invested amount
    - Current portfolio value
    - Realized profit/loss (from sell transactions)
    - Unrealized profit/loss (market value vs. invested)
    """
    if 'user_id' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    user = User.query.get(session['user_id'])
    if not user:
        return jsonify({"error": "User not found"}), 404

    try:
        # Fetch user holdings and transactions
        holdings = Holding.query.filter_by(user_id=user.id).all()
        transactions = Transaction.query.filter_by(user_id=user.id).all()

        # Initialize performance values
        invested_amount = Decimal("0")
        current_value = Decimal("0")
        realized_profit_loss = Decimal("0")

        # Calculate invested amount & current market value
        for holding in holdings:
            stock_data = get_stock_price(holding.symbol)

            if not stock_data or "price" not in stock_data or stock_data.get("error"):
                logger.warning(f"Stock data missing for {holding.symbol}, skipping calculation.")
                continue  # Skip stocks with missing or invalid data

            try:
                current_price = Decimal(str(stock_data.get('price', 0)))
            except Exception:
                logger.error(f"Error converting stock price for {holding.symbol}")
                current_price = Decimal("0")

            invested_amount += holding.average_price * holding.quantity
            current_value += current_price * holding.quantity

        # Calculate realized profit/loss (only from SELL transactions)
        for transaction in transactions:
            if transaction.action == "sell":
                buy_transactions = Transaction.query.filter_by(
                    user_id=user.id, symbol=transaction.symbol, action="buy"
                ).order_by(Transaction.transaction_date).all()

                if buy_transactions:
                    buy_price = buy_transactions[0].price  # Get first buy price (FIFO method)
                    sell_price = transaction.price
                    realized_profit_loss += (sell_price - buy_price) * transaction.quantity

        # Calculate unrealized profit/loss
        unrealized_profit_loss = current_value - invested_amount

        # Convert Decimal values to float for JSON serialization
        return jsonify({
            "invested_amount": float(invested_amount),
            "current_value": float(current_value),
            "realized_profit_loss": float(realized_profit_loss),
            "unrealized_profit_loss": float(unrealized_profit_loss)
        }), 200

    except Exception as e:
        logger.error(f"Unexpected error calculating performance: {e}")
        return jsonify({"error": "Unexpected server error"}), 500
