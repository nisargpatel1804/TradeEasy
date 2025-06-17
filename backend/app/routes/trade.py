from flask import Blueprint, request, jsonify, session
from app.models import Transaction, Holding, User, db
from app.utils.scraper import get_stock_price
from sqlalchemy.exc import SQLAlchemyError
from decimal import Decimal, ROUND_DOWN
from datetime import datetime
import logging
import re

logger = logging.getLogger(__name__)

bp = Blueprint('trade', __name__, url_prefix='/trade')

# ------------------------------
# Validation Helpers
# ------------------------------

def validate_symbol(symbol):
    return bool(re.match(r'^[A-Z0-9.]{1,12}$', symbol))

def validate_quantity(quantity):
    try:
        return int(Decimal(quantity).quantize(Decimal('1'), rounding=ROUND_DOWN))
    except:
        return None

def validate_price(price):
    try:
        return Decimal(str(price)).quantize(Decimal('0.01'))
    except:
        return None

# ------------------------------
# Trade Processor
# ------------------------------

def process_trade(action, data):
    symbol = data.get('symbol', '').upper().strip()
    quantity = validate_quantity(data.get('quantity'))
    price = validate_price(data.get('price')) if data.get('price') else None
    order_type = data.get('orderType', 'market').lower()
    stop_loss = validate_price(data.get('stopLoss')) if data.get('stopLoss') else None

    if not symbol or not validate_symbol(symbol):
        logger.error(f"Invalid symbol: {symbol}")
        return {"error": "Invalid stock symbol"}, 400

    if not quantity or quantity <= 0:
        logger.error(f"Invalid quantity: {data.get('quantity')}")
        return {"error": "Invalid quantity"}, 400

    if order_type not in ['market', 'limit']:
        return {"error": "Invalid order type"}, 400

    if order_type == 'limit' and (not price or price <= 0):
        return {"error": "Limit order requires a valid price"}, 400

    if stop_loss and stop_loss <= 0:
        return {"error": "Invalid stop loss"}, 400

    try:
        stock_data = get_stock_price(symbol)
        if 'error' in stock_data:
            return {"error": f"Stock price fetch failed: {stock_data['error']}"}, 400

        current_price = Decimal(str(stock_data['price'])).quantize(Decimal('0.01'))

        if order_type == 'limit':
            if action == 'buy' and current_price > price:
                return {"error": "Limit price not met for buy"}, 400
            if action == 'sell' and current_price < price:
                return {"error": "Limit price not met for sell"}, 400

        execution_price = current_price if order_type == 'market' else price
        total_amount = execution_price * Decimal(quantity)

        return {
            "symbol": symbol,
            "quantity": quantity,
            "execution_price": execution_price,
            "current_price": current_price,
            "total_amount": total_amount,
            "order_type": order_type,
            "stop_loss": stop_loss
        }

    except Exception as e:
        logger.error(f"Trade processing error: {e}")
        return {"error": "Trade processing failed"}, 500

# ------------------------------
# BUY Endpoint
# ------------------------------

@bp.route('/buy', methods=['POST', 'OPTIONS'])
def buy():
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400

    trade_data = process_trade('buy', data)
    if isinstance(trade_data, tuple) and 'error' in trade_data[0]:
        return jsonify(trade_data[0]), trade_data[1]

    try:
        with db.session.begin():
            user = db.session.execute(
                db.select(User).filter_by(id=session['user_id']).with_for_update()
            ).scalar_one()

            if user.balance < trade_data['total_amount']:
                return jsonify({"error": "Insufficient balance"}), 400

            user.balance -= trade_data['total_amount']

            transaction = Transaction(
                user_id=user.id,
                symbol=trade_data['symbol'],
                action='buy',
                quantity=trade_data['quantity'],
                price=trade_data['execution_price'],
                limit_price=trade_data['execution_price'] if trade_data['order_type'] == 'limit' else None,
                stop_loss=trade_data['stop_loss'],
                status='executed',
                order_type=trade_data['order_type'],
                executed_at=datetime.utcnow()
            )
            db.session.add(transaction)

            holding = db.session.execute(
                db.select(Holding)
                .filter_by(user_id=user.id, symbol=trade_data['symbol'])
                .with_for_update()
            ).scalar_one_or_none()

            if holding:
                old_qty = Decimal(holding.quantity)
                new_qty = old_qty + Decimal(trade_data['quantity'])
                total_cost = (holding.average_price * old_qty) + (trade_data['execution_price'] * trade_data['quantity'])
                holding.average_price = (total_cost / new_qty).quantize(Decimal('0.01'))
                holding.quantity = int(new_qty)
                holding.update_values(trade_data['current_price'])
            else:
                holding = Holding(
                    user_id=user.id,
                    symbol=trade_data['symbol'],
                    quantity=trade_data['quantity'],
                    average_price=trade_data['execution_price']
                )
                holding.update_values(trade_data['current_price'])
                db.session.add(holding)

        return jsonify({
            "success": True,
            "message": "Buy order executed",
            "symbol": trade_data['symbol'],
            "quantity": str(trade_data['quantity']),
            "price": str(trade_data['execution_price']),
            "orderType": trade_data['order_type'],
            "newBalance": str(user.balance),
            "transactionId": transaction.id
        }), 200

    except SQLAlchemyError as e:
        logger.error(f"Buy DB error: {e}")
        return jsonify({"error": "Transaction failed"}), 500
    except Exception as e:
        logger.error(f"Buy general error: {e}")
        return jsonify({"error": "Unexpected error occurred"}), 500

# ------------------------------
# SELL Endpoint
# ------------------------------

@bp.route('/sell', methods=['POST', 'OPTIONS'])
def sell():
    if request.method == 'OPTIONS':
        return jsonify({'status': 'ok'}), 200

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400

    trade_data = process_trade('sell', data)
    if isinstance(trade_data, tuple) and 'error' in trade_data[0]:
        return jsonify(trade_data[0]), trade_data[1]

    try:
        with db.session.begin():
            user = db.session.execute(
                db.select(User).filter_by(id=session['user_id']).with_for_update()
            ).scalar_one()

            holding = db.session.execute(
                db.select(Holding)
                .filter_by(user_id=user.id, symbol=trade_data['symbol'])
                .with_for_update()
            ).scalar_one_or_none()

            if not holding or holding.quantity < trade_data['quantity']:
                return jsonify({"error": "Insufficient holdings"}), 400

            holding.quantity -= trade_data['quantity']
            holding.update_values(trade_data['current_price'])

            if holding.quantity == 0:
                db.session.delete(holding)

            user.balance += trade_data['total_amount']

            transaction = Transaction(
                user_id=user.id,
                symbol=trade_data['symbol'],
                action='sell',
                quantity=trade_data['quantity'],
                price=trade_data['execution_price'],
                limit_price=trade_data['execution_price'] if trade_data['order_type'] == 'limit' else None,
                stop_loss=trade_data['stop_loss'],
                status='executed',
                order_type=trade_data['order_type'],
                executed_at=datetime.utcnow()
            )
            db.session.add(transaction)

        return jsonify({
            "success": True,
            "message": "Sell order executed",
            "symbol": trade_data['symbol'],
            "quantity": str(trade_data['quantity']),
            "price": str(trade_data['execution_price']),
            "orderType": trade_data['order_type'],
            "newBalance": str(user.balance),
            "transactionId": transaction.id
        }), 200

    except SQLAlchemyError as e:
        logger.error(f"Sell DB error: {e}")
        return jsonify({"error": "Transaction failed"}), 500
    except Exception as e:
        logger.error(f"Sell general error: {e}")
        return jsonify({"error": "Unexpected error occurred"}), 500
