from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import Watchlist, db
from sqlalchemy.exc import SQLAlchemyError
import logging
from app.utils.scraper import get_stock_price

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint("watchlist", __name__)

def is_indian_stock(symbol):
    """
    Checks if the stock symbol is an Indian stock (NSE or BSE).
    """
    return symbol.upper().endswith((".NS", ".BO"))

def format_symbol(symbol):
    """
    Converts .NSE to .NS and .BSE to .BO for yfinance compatibility.
    """
    symbol = symbol.upper()
    if symbol.endswith(".NSE"):
        return symbol.replace(".NSE", ".NS")
    elif symbol.endswith(".BSE"):
        return symbol.replace(".BSE", ".BO")
    elif not symbol.endswith((".NS", ".BO")):
        return f"{symbol}.NS"  # Default to NSE if no suffix
    return symbol

@bp.route("/watchlist", methods=["GET"])
@login_required
def get_watchlist():
    """
    Fetches the user's watchlist with real-time stock data.
    """
    try:
        watchlist_items = Watchlist.query.filter_by(user_id=current_user.id).all()

        if not watchlist_items:
            return jsonify({"success": True, "data": []}), 200

        watchlist_data = []
        for item in watchlist_items:
            formatted_symbol = format_symbol(item.symbol)
            stock_data = get_stock_price(formatted_symbol)
            if "error" not in stock_data:
                watchlist_data.append(stock_data)
            else:
                logger.error(f"Error fetching stock data for {formatted_symbol}: {stock_data['error']}")
                continue

        return jsonify({"success": True, "data": watchlist_data}), 200

    except SQLAlchemyError as e:
        logger.error(f"Database error fetching watchlist for user {current_user.id}: {e}")
        return jsonify({"success": False, "error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Unexpected error fetching watchlist: {e}")
        return jsonify({"success": False, "error": "Unexpected server error"}), 500

@bp.route("/watchlist/add", methods=["POST"])
@login_required
def add_to_watchlist():
    """
    Adds a stock symbol to the user's watchlist.
    """
    data = request.json
    symbol = data.get("symbol", "").strip().upper()

    if not symbol:
        return jsonify({"success": False, "error": "Stock symbol is required"}), 400

    # Format the symbol for yfinance
    formatted_symbol = format_symbol(symbol)

    try:
        # Check if symbol is already in the watchlist
        if Watchlist.query.filter_by(user_id=current_user.id, symbol=formatted_symbol).first():
            return jsonify({"success": False, "error": f"{formatted_symbol} is already in your watchlist"}), 400

        # Verify if the stock exists
        stock_data = get_stock_price(formatted_symbol)
        if "error" in stock_data:
            return jsonify({"success": False, "error": f"Invalid stock symbol: {formatted_symbol}"}), 400

        # Add new watchlist item
        new_item = Watchlist(user_id=current_user.id, symbol=formatted_symbol)
        db.session.add(new_item)
        db.session.commit()

        return jsonify({"success": True, "message": f"{formatted_symbol} added to watchlist", "data": stock_data}), 201

    except SQLAlchemyError as e:
        db.session.rollback()
        logger.error(f"Database error adding {formatted_symbol} to watchlist for user {current_user.id}: {e}")
        return jsonify({"success": False, "error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Unexpected error adding stock: {e}")
        return jsonify({"success": False, "error": "Unexpected server error"}), 500

@bp.route("/watchlist/remove", methods=["DELETE"])
@login_required
def remove_from_watchlist():
    """
    Removes a stock symbol from the user's watchlist.
    """
    data = request.json
    symbol = data.get("symbol", "").strip().upper()

    if not symbol:
        return jsonify({"success": False, "error": "Stock symbol is required"}), 400

    try:
        item = Watchlist.query.filter_by(user_id=current_user.id, symbol=symbol).first()

        if not item:
            return jsonify({"success": False, "error": f"{symbol} not found in watchlist"}), 404

        db.session.delete(item)
        db.session.commit()

        return jsonify({"success": True, "message": f"{symbol} removed from watchlist"}), 200

    except SQLAlchemyError as e:
        db.session.rollback()
        logger.error(f"Database error removing {symbol} from watchlist for user {current_user.id}: {e}")
        return jsonify({"success": False, "error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Unexpected error removing stock: {e}")
        return jsonify({"success": False, "error": "Unexpected server error"}), 500