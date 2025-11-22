import logging
from decimal import Decimal
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import Transaction, Holding, User
# Import the centralized, cached function for all stock data lookups
from .stock import get_stock_data_from_api, format_symbol

# --- Configuration ---
logger = logging.getLogger(__name__)
trade_bp = Blueprint('trade', __name__)

# --- Helper Functions ---

def _validate_and_process_trade_request(action: str, data: dict) -> tuple[dict, int]:
    """
    Centralized validation and price fetching for all trade orders.
    This function ensures data consistency and leverages the cached API function.
    """
    symbol_input = data.get('symbol')
    quantity_input = data.get('quantity')
    order_type = str(data.get('order_type', 'MARKET')).upper()

    # --- Step 1: Validate Basic Inputs ---
    if not symbol_input or not isinstance(quantity_input, int) or quantity_input <= 0:
        return {"success": False, "message": "A valid symbol and a positive integer quantity are required."}, 400
    
    if order_type not in ['MARKET', 'LIMIT']:
        return {"success": False, "message": "Invalid order type. Must be 'MARKET' or 'LIMIT'."}, 400

    quantity = int(quantity_input)

    # --- Step 2: Fetch Live Data Using Centralized Cached Function ---
    api_data = get_stock_data_from_api(symbol_input)
    if not api_data:
        return {"success": False, "message": f"Instrument '{format_symbol(symbol_input)}' is not available for trading."}, 404

    # --- Step 3: Determine Execution Price ---
    execution_price = Decimal(str(api_data.get('ltp', 0)))
    if execution_price <= 0:
        return {"success": False, "message": f"Could not fetch a valid market price for '{format_symbol(symbol_input)}'. Trading may be halted."}, 502

    if order_type == 'LIMIT':
        limit_price = Decimal(str(data.get('price', 0)))
        if limit_price <= 0:
            return {"success": False, "message": "A positive limit price is required for LIMIT orders."}, 400
        
        # For limit orders, the execution price is the limit price, but we check against LTP
        if action == 'BUY' and execution_price > limit_price:
            return {"success": False, "message": f"Buy limit not met. Current price ({execution_price}) is above your limit ({limit_price})."}, 409
        if action == 'SELL' and execution_price < limit_price:
            return {"success": False, "message": f"Sell limit not met. Current price ({execution_price}) is below your limit ({limit_price})."}, 409
        
        execution_price = limit_price

    total_amount = execution_price * Decimal(quantity)

    # --- Step 4: Return Processed Trade Data ---
    return {
        "success": True,
        "data": {
            "symbol": f"{api_data['symbol']}.{api_data['exchange']}",
            "quantity": quantity,
            "execution_price": execution_price,
            "total_amount": total_amount,
            "order_type": order_type
        }
    }, 200

# --- API Routes ---

@trade_bp.route('/buy', methods=['POST'])
@login_required
def buy():
    """Handles a buy order by validating the request and updating user records."""
    result, status_code = _validate_and_process_trade_request('BUY', request.get_json())
    if status_code != 200:
        return jsonify(result), status_code

    trade_data = result['data']
    user = User.objects.get(id=current_user.id) # Re-fetch user to ensure fresh data
    
    if Decimal(str(user.balance)) < trade_data['total_amount']:
        return jsonify({"success": False, "message": "Insufficient funds to complete this purchase."}), 402

    # --- Perform Database Operations ---
    try:
        user.balance -= float(trade_data['total_amount'])
        
        holding, created = Holding.objects.get_or_create(user=user, symbol=trade_data['symbol'])
        if not created:
            # Update average price for an existing holding
            old_total_cost = Decimal(str(holding.average_price)) * Decimal(holding.quantity)
            new_total_cost = old_total_cost + trade_data['total_amount']
            holding.quantity += trade_data['quantity']
            holding.average_price = float(new_total_cost / Decimal(holding.quantity))
        else:
            # Create a new holding
            holding.quantity = trade_data['quantity']
            holding.average_price = float(trade_data['execution_price'])
        
        Transaction(user=user, action='BUY', **trade_data).save()
        user.save()
        holding.save()

        logger.info(f"BUY order executed for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']}")
        return jsonify({
            "success": True, 
            "message": "Buy order executed successfully.",
            "new_balance": float(user.balance)
        }), 200

    except Exception as e:
        logger.error(f"Database error during BUY for {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "A database error occurred. The trade was not completed."}), 500

@trade_bp.route('/sell', methods=['POST'])
@login_required
def sell():
    """Handles a sell order by validating the request and updating user records."""
    result, status_code = _validate_and_process_trade_request('SELL', request.get_json())
    if status_code != 200:
        return jsonify(result), status_code
    
    trade_data = result['data']
    user = User.objects.get(id=current_user.id)
    holding = Holding.objects(user=user, symbol=trade_data['symbol']).first()

    if not holding or holding.quantity < trade_data['quantity']:
        return jsonify({"success": False, "message": "Insufficient shares to sell."}), 400

    # --- Perform Database Operations ---
    try:
        user.balance += float(trade_data['total_amount'])
        holding.quantity -= trade_data['quantity']
        
        Transaction(user=user, action='SELL', **trade_data).save()
        user.save()

        if holding.quantity == 0:
            holding.delete()
        else:
            holding.save()

        logger.info(f"SELL order executed for {user.client_id}: {trade_data['quantity']} of {trade_data['symbol']}")
        return jsonify({
            "success": True, 
            "message": "Sell order executed successfully.",
            "new_balance": float(user.balance)
        }), 200
        
    except Exception as e:
        logger.error(f"Database error during SELL for {user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "A database error occurred. The trade was not completed."}), 500
