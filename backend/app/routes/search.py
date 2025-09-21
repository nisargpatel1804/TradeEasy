import logging
from flask import Blueprint, request, jsonify
from app.models import AQScrip
from mongoengine.queryset.visitor import Q

# Configure logging
search_bp = Blueprint("search", __name__)
logger = logging.getLogger(__name__)

@search_bp.route("/stocks/search", methods=["GET"])
def search_stocks():
    """
    Searches for NSE equity stocks from the AQScrip collection.

    This endpoint searches by company name, symbol (short name), or full scrip name.
    It returns a clean JSON array with the data needed by the frontend, including
    the critical 'scripcode' for enabling real-time subscriptions.
    """
    query = request.args.get("query", "").strip()
    if len(query) < 1:
        # Return an empty list for short queries, as this is expected by the frontend.
        return jsonify([])

    try:
        # Build a query that searches across relevant fields using case-insensitive matching.
        search_query = (
            Q(scripname__icontains=query) |
            Q(scripfullname__icontains=query) |
            Q(scripshortname__icontains=query)
        )
        
        # Filter for active, non-suspended, non-banned equity stocks on the NSE exchange.
        filters = (
            Q(scripname__icontains="EQ") & 
            Q(issuspended="N") & 
            Q(isbanscrip="N") &
            Q(exchangename="NSE")
        )
        
        # Combine all queries and limit results for performance.
        results = AQScrip.objects(filters & search_query).limit(10)

        # --- UPDATED RESPONSE FORMAT ---
        # Format results into a clean structure expected by the frontend.
        formatted_results = []
        for scrip in results:
            # Extract the company name part before the hyphen for better readability.
            # e.g., "TATA CONSULTANCY SERV LT-TCS EQ" -> "TATA CONSULTANCY SERV LT"
            company_name = scrip.scripfullname
            if '-' in company_name:
                company_name = company_name.split('-')[0].strip()
            
            # Determine the symbol, preferring the short name (e.g., "TCS").
            symbol = scrip.scripshortname or scrip.scripname.replace(' EQ', '')
            
            formatted_results.append({
                # Clean keys for easier frontend access (e.g., stock.symbol)
                "symbol": f"{symbol}.NS",
                "name": company_name,
                "exchange": scrip.exchangename,
                # **CRITICAL**: Include the scripcode for real-time subscription
                "scripcode": scrip.scripcode
            })
        
        # The frontend expects a simple array of results.
        return jsonify(formatted_results)

    except Exception as e:
        logger.error(f"An error occurred during stock search for query '{query}': {e}")
        return jsonify({"error": "An internal error occurred during search."}), 500