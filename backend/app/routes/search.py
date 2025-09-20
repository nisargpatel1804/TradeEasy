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
    Searches for EQ stocks from AQScrip collection by scripname or scripfullname.
    Only returns stocks with 'EQ' in scripname and displays them in full company name format.
    """
    query = request.args.get("query", "").strip()
    if len(query) < 1:
        return jsonify({"error": "A search query with at least 1 character is required."}), 400

    try:
        # Build a query that searches across relevant fields and filters for EQ stocks
        # 'icontains' provides a case-insensitive substring search
        # Allow searching by scripshortname (e.g., "TATAMOTORS") and scripfullname (e.g., "TATA MOTORS LIMITED-TATAMOTORS EQ")
        search_query = (
            Q(scripname__icontains=query) |
            Q(scripfullname__icontains=query) |
            Q(scripshortname__icontains=query)
        )
        
        # Filter only for equity stocks (scripname contains 'EQ') and active stocks
        eq_stocks_query = Q(scripname__icontains="EQ") & Q(issuspended="N") & Q(isbanscrip="N")
        
        # Filter for NSE exchange only (you can modify this if needed)
        exchange_query = Q(exchangename="NSE")

        # Combine queries and limit results for performance
        results = AQScrip.objects(eq_stocks_query & exchange_query & search_query).limit(20)

        # Format results into the structure expected by the frontend
        # Extract company name from scripfullname (format: "TATA CONSULTANCY SERV LT-TCS EQ")
        formatted_results = []
        for scrip in results:
            # Extract the company name part before the hyphen
            company_name = scrip.scripfullname
            if '-' in company_name:
                company_name = company_name.split('-')[0].strip()
            
            # Use scripshortname for symbol (e.g., "TCS")
            symbol = scrip.scripshortname or scrip.scripname.replace(' EQ', '')
            
            formatted_results.append({
                "1. symbol": f"{symbol}.NS",  # Add .NS suffix for NSE
                "2. name": company_name,
                "3. type": "Equity",
                "4. region": f"India ({scrip.exchangename})",
                "5. marketOpen": "09:15",
                "6. marketClose": "15:30",
                "7. timezone": "Asia/Kolkata",
                "8. currency": "INR",
                "9. matchScore": "1.0000"
            })
        
        return jsonify({"bestMatches": formatted_results})

    except Exception as e:
        logger.error(f"An error occurred during stock search for query '{query}': {e}")
        return jsonify({"error": "An internal error occurred during search."}), 500
