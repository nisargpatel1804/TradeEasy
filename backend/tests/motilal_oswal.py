import requests
from app.config import Config

def get_headers():
    """Return headers without TOTP for public stock data."""
    return {
        "Content-Type": "application/json",
        "X-API-KEY": Config.MOTILAL_OSWAL_API_KEY,
    }

def fetch_stock_data(symbol):
    """Fetch stock data from Motilal Oswal API without TOTP."""
    url = f"{Config.MOTILAL_OSWAL_BASE_URL}/marketdata/{symbol}"
    try:
        response = requests.get(url, headers=get_headers())
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}
