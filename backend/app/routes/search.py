# backend/app/routes/search.py
from flask import Blueprint, request, jsonify
from app.utils.alpha_vantage import search_symbol

search_bp = Blueprint("search", __name__)

@search_bp.route("/stocks/search", methods=["GET"])
def search_stocks():
    query = request.args.get("query")
    if not query or len(query.strip()) < 1:
        return jsonify({"error": "Query parameter is required and cannot be empty."}), 400

    try:
        results = search_symbol(query)
        print("🔍 Raw API Results:", results)

        if not isinstance(results, list):
            return jsonify({"error": "Unexpected response format from Alpha Vantage."}), 500

        filtered_results = [
            stock for stock in results
            if stock.get("1. symbol", "").endswith((".NSE", ".BSE"))
        ]

        if not filtered_results:
            return jsonify({"message": "No NSE or BSE stocks found."}), 404

        response = jsonify(filtered_results)
        response.headers["Content-Type"] = "application/json"  # Ensure JSON Content-Type
        return response

    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        return jsonify({"error": f"Failed to fetch stock data: {str(e)}"}), 500
