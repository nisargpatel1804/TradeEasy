import logging
from flask import Blueprint, request, jsonify
from app.models import Stock
from mongoengine.queryset.visitor import Q

# Configure logging
search_bp = Blueprint("search", __name__)
logger = logging.getLogger(__name__)

@search_bp.route("/stocks/search", methods=["GET"])
def search_stocks():
    """
    Searches for stocks by symbol or name using a single, efficient mongoengine query.
    """
    query = request.args.get("query", "").strip()
    if len(query) < 1:
        return jsonify({"error": "A search query with at least 1 character is required."}), 400

    try:
        # Build a query that searches across multiple relevant fields
        # 'icontains' provides a case-insensitive substring search
        search_query = (
            Q(symbol__icontains=query) |
            Q(name__icontains=query) |
            Q(base_symbol__icontains=query)
        )
        
        # Filter only for stocks marked as active
        active_stocks_query = Q(is_active=True)

        # Combine queries and limit results for performance
        results = Stock.objects(active_stocks_query & search_query).limit(20)

        # Format results into the structure expected by the frontend
        formatted_results = [
            {
                "1. symbol": stock.symbol,
                "2. name": stock.name,
                "3. type": "Equity",
                "4. region": f"India ({stock.exchange})",
                "5. marketOpen": "09:15",
                "6. marketClose": "15:30",
                "7. timezone": "Asia/Kolkata",
                "8. currency": "INR",
                "9. matchScore": "1.0000"  # Simplified score, can be enhanced if needed
            }
            for stock in results
        ]
        
        return jsonify(formatted_results)

    except Exception as e:
        logger.error(f"An error occurred during stock search for query '{query}': {e}")
        return jsonify({"error": "An internal error occurred during search."}), 500
