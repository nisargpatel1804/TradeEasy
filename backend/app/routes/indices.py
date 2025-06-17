from flask import Blueprint, jsonify
from app import db
from app.models import MarketIndex
from app.utils.indices_scraper import fetch_market_indices  # Import scraper function

# Define Blueprint with correct naming convention
bp = Blueprint("indices", __name__)

@bp.route("/indices", methods=["GET"])
def get_market_indices():
    """
    API endpoint to fetch the latest market indices from the database.
    """
    try:
        indices = MarketIndex.query.all()
        indices_data = [
            {
                "name": index.name,
                "symbol": index.symbol,
                "price": index.price,
                "change": index.change,
                "percent_change": index.percent_change,
                "last_updated": index.last_updated.strftime("%Y-%m-%d %H:%M:%S")
            }
            for index in indices
        ]
        return jsonify(indices_data)
    except Exception as e:
        return jsonify({"error": f"Failed to fetch indices: {str(e)}"}), 500

@bp.route("/indices/update", methods=["POST"])
def update_market_indices():
    """
    API endpoint to manually trigger an update of market indices.
    """
    try:
        fetch_market_indices()  # Fetch latest data and update database
        return jsonify({"message": "Market indices updated successfully"}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to update indices: {str(e)}"}), 500
