from flask import Blueprint, jsonify, request
import yfinance as yf
from app import db
from app.models import MarketIndex
from app.utils.indices_scraper import fetch_market_indices
from app.utils.scraper import get_stock_price
import time
import logging
from app.config import AppConfig

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define Blueprint with correct naming convention
bp = Blueprint("indices", __name__)

@bp.route("/indices", methods=["GET"])
def get_market_indices():
    """
    API endpoint to fetch the latest market indices from the database.
    """
    try:
        indices = MarketIndex.query.all()

        # Fallback: if database is empty (first run) automatically fetch once.
        if not indices:
            fetch_market_indices()
            # Re-query after population attempt
            indices = MarketIndex.query.all()

        enriched = []
        for idx in indices:
            item = {
                "name": idx.name,
                "symbol": idx.symbol,
                "price": idx.price,
                "change": idx.change,
                "percent_change": idx.percent_change,
                "last_updated": idx.last_updated.strftime("%Y-%m-%d %H:%M:%S"),
            }
            enriched.append(item)

        return jsonify(enriched)
    except Exception as e:
        logger.error(f"Failed to fetch indices: {str(e)}")
        return jsonify({"error": f"Failed to fetch indices: {str(e)}"}), 500

@bp.route("/indices/update", methods=["POST"])
def update_market_indices():
    """
    API endpoint to manually trigger an update of market indices.
    """
    try:
        # Fetch latest data and update database
        fetch_market_indices()
        
        return jsonify({"message": "Market indices updated successfully"}), 200
    except Exception as e:
        logger.error(f"Failed to update indices: {str(e)}")
        return jsonify({"error": f"Failed to update indices: {str(e)}"}), 500
