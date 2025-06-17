from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from decimal import Decimal, InvalidOperation
from app.models import Holding, Transaction
from app.utils.scraper import get_stock_price
from sqlalchemy import desc
import logging
from flask_cors import cross_origin

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Blueprint
bp = Blueprint('portfolio', __name__)

@bp.route('/portfolio', methods=['GET', 'OPTIONS'])
@cross_origin(origins=['http://localhost:5173'], methods=['GET', 'OPTIONS'], supports_credentials=True)
@login_required
def get_portfolio():
    """
    Fetches the user's portfolio, calculates total portfolio value, and returns holdings with live stock prices.
    Includes performance metrics and recent transactions.
    """
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    try:
        # Initialize portfolio value with user's cash balance
        try:
            balance = Decimal(str(current_user.balance))
        except (InvalidOperation, TypeError) as e:
            logger.error(f"Invalid balance format for user {current_user.id}: {e}")
            return jsonify({"error": "Invalid balance format"}), 500

        # Fetch user holdings
        holdings = Holding.query.filter_by(user_id=current_user.id).all()
        
        # Get recent transactions (last 5)
        recent_transactions = Transaction.query\
            .filter_by(user_id=current_user.id)\
            .order_by(desc(Transaction.transaction_date))\
            .limit(5)\
            .all()

        # Process holdings
        holdings_list = []
        total_investment = Decimal('0')
        current_value = Decimal('0')

        for holding in holdings:
            try:
                # Fetch live stock price
                stock_data = get_stock_price(holding.symbol)
                stock_price = Decimal(str(stock_data.get('price', '0')))
                
                # Calculate holding metrics
                holding_investment = holding.quantity * holding.average_price
                holding_current_value = holding.quantity * stock_price
                holding_profit_loss = holding_current_value - holding_investment
                holding_profit_loss_percentage = (
                    (holding_profit_loss / holding_investment * 100)
                    if holding_investment > 0 else 0
                )

                holdings_list.append({
                    "symbol": holding.symbol,
                    "quantity": holding.quantity,
                    "average_price": float(holding.average_price),  # Convert to float for JSON
                    "current_price": float(stock_price),
                    "investment_value": float(holding_investment),
                    "current_value": float(holding_current_value),
                    "profit_loss": float(holding_profit_loss),
                    "profit_loss_percentage": float(holding_profit_loss_percentage)
                })
                
                # Update portfolio metrics
                total_investment += holding_investment
                current_value += holding_current_value

            except (InvalidOperation, TypeError, ZeroDivisionError) as e:
                logger.error(f"Error processing holding {holding.symbol}: {e}")
                continue
            except Exception as e:
                logger.error(f"Failed to fetch stock price for {holding.symbol}: {e}")
                continue

        # Process recent transactions
        transactions_list = [{
            "symbol": t.symbol,
            "action": t.action,
            "quantity": t.quantity,
            "price": float(t.price),  # Convert to float for JSON
            "total_value": float(t.quantity * t.price),
            "date": t.transaction_date.isoformat()
        } for t in recent_transactions]

        # Calculate portfolio metrics
        portfolio_value = balance + current_value
        total_profit_loss = current_value - total_investment
        profit_loss_percentage = (
            (total_profit_loss / total_investment * 100)
            if total_investment > 0 else 0
        )

        return jsonify({
            "balance": float(balance),
            "portfolio_value": float(portfolio_value),
            "total_investment": float(total_investment),
            "current_value": float(current_value),
            "total_profit_loss": float(total_profit_loss),
            "profit_loss_percentage": float(profit_loss_percentage),
            "holdings": holdings_list,
            "total_holdings": len(holdings_list),
            "recent_transactions": transactions_list
        }), 200

    except Exception as e:
        logger.error(f"Error fetching portfolio for user {current_user.id}: {e}")
        return jsonify({"error": "Internal server error"}), 500