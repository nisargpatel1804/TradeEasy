import requests
import time
from app.config import ALPHA_VANTAGE_API_KEY

# Cache timeout (1 hour = 3600 seconds)
CACHE_TIMEOUT = 3600
search_cache = {}

def get_from_cache(query):
    """Retrieve cached results if within the timeout period."""
    cached_data = search_cache.get(query)
    if cached_data:
        data, timestamp = cached_data
        if time.time() - timestamp < CACHE_TIMEOUT:
            print(f"✅ Cache hit for query: {query}")
            return data
    return None

def store_in_cache(query, data):
    """Store results in the cache with the current timestamp."""
    search_cache[query] = (data, time.time())
    print(f"💾 Cached results for query: {query}")

def filter_indian_stocks(results):
    """Filter results to include only NSE and BSE stocks."""
    if not isinstance(results, list):
        print("⚠️ Unexpected results format, expected a list.")
        return []

    return [
        stock for stock in results
        if stock.get("1. symbol", "").endswith((".NSE", ".BSE"))
    ]

def search_symbol(query):
    """Search for Indian stock symbols using the Alpha Vantage API."""
    if not query or not query.strip():
        return {"error": "Query parameter is required and cannot be empty."}

    # Check cache first
    cached_result = get_from_cache(query)
    if cached_result:
        return cached_result

    url = "https://www.alphavantage.co/query"
    params = {
        "function": "SYMBOL_SEARCH",
        "keywords": query,
        "apikey": ALPHA_VANTAGE_API_KEY,
        "datatype": "json"
    }

    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()

        data = response.json()
        print(f"🔍 Raw API response for '{query}':", data)

        if "bestMatches" in data and isinstance(data["bestMatches"], list):
            results = data["bestMatches"]
            indian_stocks = filter_indian_stocks(results)

            if not indian_stocks:
                print(f"❌ No NSE/BSE stocks found for '{query}'.")
                return []

            # Cache and return results
            store_in_cache(query, indian_stocks)
            return indian_stocks

        if "Note" in data:
            print("⚠️ API limit reached.")
            return {"error": "API limit reached. Please try again later."}

        return {"error": "No results found for the given query."}

    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
        return {"error": f"Failed to fetch data: {str(e)}"}
