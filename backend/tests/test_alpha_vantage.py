import pytest
from app.utils.alpha_vantage import search_symbol

# Test queries for popular Indian stocks
test_queries = ["reliance", "tcs", "hdfc", "infosys"]

@pytest.mark.parametrize("query", test_queries)
def test_search_indian_stocks(query):
    """Test Alpha Vantage stock search for Indian NSE/BSE stocks."""
    print(f"\n🔍 Testing search for '{query}' (NSE/BSE only)...")

    results = search_symbol(query)

    if "error" in results:
        pytest.fail(f"❌ API Error for '{query}': {results['error']}")
    else:
        assert isinstance(results, list), f"Expected list, got {type(results)} for '{query}'"
        assert all("1. symbol" in stock and "2. name" in stock for stock in results), \
            f"Unexpected result structure for '{query}'"

        print(f"✅ {len(results)} results found for '{query}':")
        for stock in results:
            print(f"  - {stock['1. symbol']} | {stock['2. name']} | Exchange: India")

# Run directly for quick testing
if __name__ == "__main__":
    print("🚀 Running standalone test for Alpha Vantage API...\n")
    for query in test_queries:
        test_search_indian_stocks(query)
