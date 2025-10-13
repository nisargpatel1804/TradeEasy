import logging
from flask import Blueprint, request, jsonify
from app.models import AQScrip
from mongoengine.queryset.visitor import Q

# --- Configuration ---
logger = logging.getLogger(__name__)
search_bp = Blueprint("search", __name__)

# --- Constants ---
SEARCH_RESULT_LIMIT = 15

# --- API Route ---

@search_bp.route("/search", methods=["GET"])
def search_stocks():
    """
    Searches for tradable equity stocks across multiple exchanges (NSE and BSE)
    based on a user's query. It prioritizes symbols and short names for relevance.
    """
    query = request.args.get("q", "").strip()
    if len(query) < 2:
        # Avoid broad, slow queries; return an empty list for short inputs.
        return jsonify([])

    try:
        # Convert query to uppercase for matching with stock symbols
        query_upper = query.upper()
        
        # --- Build a Multi-Field Search Query ---
        # This query looks for the search term in the most relevant fields.
        # It's case-insensitive ('i' prefix) and checks for substrings ('contains').
        search_query = (
            Q(scripshortname__icontains=query) |
            Q(scripname__icontains=query) |
            Q(scripfullname__icontains=query)
        )

        # --- Filter for Relevant, Tradable Stocks ---
        # This ensures we only return active, regular equity stocks.
        # Using optiontype='EQ' to filter for equity stocks (instrumentname is whitespace-padded)
        filters = (
            Q(optiontype="EQ") &
            Q(issuspended="N") &
            Q(isbanscrip="N")
        )

        # --- Execute the Query and Format Results ---
        # Prioritize NSE results, but also include results from BSE.
        # The limit prevents the response from becoming too large and slow.
        results = AQScrip.objects(filters & search_query).limit(SEARCH_RESULT_LIMIT)
        
        logger.info(f"Search query '{query}' returned {results.count()} results")

        formatted_results = []
        seen_symbols = set()  # Avoid duplicates across exchanges
        
        for scrip in results:
            # Create the symbol in the format expected by the frontend
            symbol = f"{scrip.scripshortname}.{scrip.exchangename}"
            
            # Skip duplicates (prioritize NSE over BSE)
            if scrip.scripshortname in seen_symbols and scrip.exchangename != "NSE":
                continue
            seen_symbols.add(scrip.scripshortname)
            
            # Clean up the company name for better display on the frontend.
            company_name = scrip.scripfullname.split('-')[0].strip() if scrip.scripfullname and '-' in scrip.scripfullname else (scrip.scripname or scrip.scripshortname)
            
            formatted_results.append({
                "symbol": symbol,
                "name": company_name,
                "exchange": scrip.exchangename,
                # The scripcode is critical for subscribing to real-time data.
                "scripcode": scrip.scripcode
            })
        
        # The frontend expects a simple array of search results.
        return jsonify(formatted_results)

    except Exception as e:
        logger.error(f"Error during stock search for query '{query}': {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred during search."}), 500
