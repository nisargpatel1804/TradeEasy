import re
import logging
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from flask import Blueprint, request, jsonify, session
from flask_login import login_required, current_user
from app.models import Transaction, Holding, User
from app.moapi.mo_api import MotilalOswalAPI

# Configure logging
logger = logging.getLogger(__name__)

# The url_prefix is now handled in the main __init__.py for consistency
bp = Blueprint('trade', __name__)

# --- Validation Helpers ---

def validate_symbol(symbol):
    """Validates the stock symbol format."""
    return bool(re.match(r'^[A-Z0-9.&-]{1,20}$', symbol))

def validate_quantity(quantity):
    """Validates and converts quantity to a positive integer."""
    try:
        qty = int(quantity)
        return qty if qty > 0 else None
    except (ValueError, TypeError):
        return None

def validate_price(price):
    """Validates and converts a price to a Decimal with 2 decimal places."""
    try:
        return Decimal(str(price)).quantize(Decimal('0.01'))
    except (ValueError, TypeError):
        return None

# --- Core Trade Processor ---

def process_trade(action, data):
    """
    Validates trade data and fetches live market price from the Motilal Oswal API.
    This is the single source of truth for pricing at the time of a trade.
    """
    symbol = data.get('symbol', '').upper().strip()
    quantity = validate_quantity(data.get('quantity'))
    limit_price = validate_price(data.get('price')) if data.get('orderType', 'market').lower() == 'limit' else None
    order_type = data.get('orderType', 'market').lower()

    # --- Initial Validation ---
    if not symbol or not validate_symbol(symbol):
        return {"error": "Invalid or missing stock symbol"}, 400
    if not quantity:
        return {"error": "Quantity must be a positive whole number"}, 400
    if order_type == 'limit' and not limit_price:
        return {"error": "A valid price is required for limit orders"}, 400

    # --- Fetch Live Price from MO API ---
    try:
        mo_api = MotilalOswalAPI()
        if not mo_api.auth_token and not mo_api.login():
            raise ConnectionError("Could not log in to trading API.")

        # Assuming NSE for all trades for consistency
        response = mo_api.get_ltp_data("NSE", symbol)

        if not response or response.get('status') != 'SUCCESS':
            msg = response.get('message', 'Unknown API error') if response else 'No response from API'
            logger.error(f"API price fetch failed for {symbol}: {msg}")
            return {"error": f"Could not fetch live price for {symbol}. Please try again."}, 404

        api_data = response['data']
        current_price = Decimal(str(api_data.get('ltp', 0)))

        # --- Determine Execution Price ---
        execution_price = current_price
        if order_type == 'limit':
            if action == 'buy' and current_price > limit_price:
                return {"error": f"Buy limit not met. Current price {current_price} > limit {limit_price}"}, 400
            if action == 'sell' and current_price < limit_price:
                return {"error": f"Sell limit not met. Current price {current_price} < limit {limit_price}"}, 400
            execution_price = limit_price # Execute at the user's specified limit price

        total_amount = execution_price * Decimal(quantity)

        return {
            "symbol": symbol, "quantity": quantity, "execution_price": execution_price,
            "total_amount": total_amount, "order_type": order_type,
            "limit_price": limit_price, "current_price": current_price,
            "success": True
        }

    except Exception as e:
        logger.error(f"Error in trade processing for {symbol}: {e}")
        return {"error": "An internal error occurred while processing the trade."}, 500


@bp.route('/buy', methods=['POST'])
@login_required
def buy():
    """Handles a buy order request."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    trade_result = process_trade('buy', data)
    if not trade_result.get("success"):
        # Return error from process_trade
        return jsonify(trade_result), trade_result.get("status_code", 400)

    try:
        if current_user.balance < trade_result['total_amount']:
            return jsonify({"error": "Insufficient funds to complete this purchase."}), 400

        # --- Update User Balance and Holdings ---
        current_user.balance -= trade_result['total_amount']
        
        holding = Holding.objects(user=current_user.id, symbol=trade_result['symbol']).first()
        if holding:
            # Update existing holding
            old_total_cost = holding.average_price * holding.quantity
            new_total_cost = old_total_cost + trade_result['total_amount']
            holding.quantity += trade_result['quantity']
            holding.average_price = new_total_cost / holding.quantity
        else:
            # Create new holding
            holding = Holding(
                user=current_user.id,
                symbol=trade_result['symbol'],
                quantity=trade_result['quantity'],
                average_price=trade_result['execution_price']
            )
        
        # --- Create Transaction Record ---
        transaction = Transaction(
            user=current_user.id, symbol=trade_result['symbol'], action='buy',
            quantity=trade_result['quantity'], price=trade_result['execution_price'],
            order_type=trade_result['order_type'], limit_price=trade_result['limit_price']
        )

        # Save all changes to the database
        current_user.save()
        holding.save()
        transaction.save()

        return jsonify({
            "message": f"Successfully purchased {trade_result['quantity']} shares of {trade_result['symbol']}",
            "newBalance": f"{current_user.balance:.2f}",
            "transactionId": str(transaction.id)
        }), 200

    except Exception as e:
        logger.error(f"Database error during buy transaction: {e}")
        return jsonify({"error": "Failed to save transaction. Please try again."}), 500

@bp.route('/sell', methods=['POST'])
@login_required
def sell():
    """Handles a sell order request."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    trade_result = process_trade('sell', data)
    if not trade_result.get("success"):
        return jsonify(trade_result), trade_result.get("status_code", 400)

    try:
        holding = Holding.objects(user=current_user.id, symbol=trade_result['symbol']).first()

        if not holding or holding.quantity < trade_result['quantity']:
            return jsonify({"error": f"Insufficient shares. You only own {holding.quantity if holding else 0}."}), 400

        # --- Update User Balance and Holdings ---
        current_user.balance += trade_result['total_amount']
        holding.quantity -= trade_result['quantity']

        # --- Create Transaction Record ---
        transaction = Transaction(
            user=current_user.id, symbol=trade_result['symbol'], action='sell',
            quantity=trade_result['quantity'], price=trade_result['execution_price'],
            order_type=trade_result['order_type'], limit_price=trade_result['limit_price']
        )

        current_user.save()
        if holding.quantity == 0:
            holding.delete() # Remove holding if all shares are sold
        else:
            holding.save()
        transaction.save()

        return jsonify({
            "message": f"Successfully sold {trade_result['quantity']} shares of {trade_result['symbol']}",
            "newBalance": f"{current_user.balance:.2f}",
            "transactionId": str(transaction.id)
        }), 200

    except Exception as e:
        logger.error(f"Database error during sell transaction: {e}")
        return jsonify({"error": "Failed to save transaction. Please try again."}), 500
