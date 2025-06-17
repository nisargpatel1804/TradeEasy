import yfinance as yf
from datetime import datetime, timedelta
import logging
import math
import numpy as np
import time
import random
from urllib.parse import quote
import re
from fake_useragent import UserAgent
from app.config import AppConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Anti-ban configuration
MIN_DELAY = 2  # Minimum delay between requests in seconds
MAX_DELAY = 5  # Maximum delay between requests in seconds
MAX_RETRIES = 3  # Maximum number of retries for failed requests
ua = UserAgent()

stock_price_cache = {}

def random_delay():
    """Add random delay between requests to avoid rate limiting"""
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

def get_random_headers():
    """Generate random headers for each request"""
    return {
        'User-Agent': ua.random,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive'
    }

def safe_request(url, max_retries=MAX_RETRIES):
    """Make HTTP request with retries and random delays"""
    for attempt in range(max_retries):
        try:
            random_delay()
            headers = get_random_headers()
            resp = requests.get(url, headers=headers, timeout=10)
            
            if resp.status_code == 429:
                wait_time = (attempt + 1) * 5
                logger.warning(f"Rate limited. Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                continue
                
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            logger.warning(f"Attempt {attempt + 1} failed: {str(e)}")
            if attempt == max_retries - 1:
                raise
            time.sleep((attempt + 1) * 2)
    return None

def format_market_cap(market_cap):
    try:
        if isinstance(market_cap, (int, float)):
            if market_cap >= 1_00_00_00_000:
                return f"{market_cap / 1_00_00_00:,.2f} Cr"
            elif market_cap >= 10_00_000:
                return f"{market_cap / 10_000:,.2f} Lac"
            else:
                return f"{market_cap:,.0f}"
    except Exception:
        pass
    return "00"

def format_volume(volume):
    try:
        if isinstance(volume, (int, float)):
            if volume >= 1_00_000:
                return f"{volume / 1_00_000:,.0f} L"
            else:
                return f"{volume:,.0f}"
    except Exception:
        pass
    return "00"

def get_stock_data(symbol):
    return yf.Ticker(symbol.upper())

def get_stock_price(symbol="RELIANCE.NS", refresh=False):
    symbol = symbol.upper()

    if AppConfig.API_BLOCKED:
        logger.warning(f"API blocked for {symbol}. Returning dummy data.")
        return get_dummy_stock_data(symbol)

    try:
        if not refresh and symbol in stock_price_cache:
            cached_data, timestamp = stock_price_cache[symbol]
            if datetime.now() - timestamp < timedelta(minutes=5):
                return cached_data

        stock = get_stock_data(symbol)
        history = stock.history(period="2d")

        if history.empty:
            raise ValueError(f"No history for {symbol}")

        today_data = history.iloc[-1]
        yesterday_data = history.iloc[-2]

        price = round(today_data["Close"], 2)
        high = round(today_data["High"], 2)
        low = round(today_data["Low"], 2)
        open_price = round(today_data["Open"], 2)
        volume = int(today_data["Volume"]) if not math.isnan(today_data["Volume"]) else 0
        previous_close = round(yesterday_data["Close"], 2)

        market_cap = stock.fast_info.get("marketCap", 0)
        if isinstance(market_cap, np.int64):
            market_cap = int(market_cap)

        price_change = round(price - previous_close, 2)
        percent_change = round((price_change / previous_close) * 100, 2) if previous_close != 0 else 0

        stock_data = {
            "symbol": symbol,
            "price": price,
            "open": open_price,
            "high": high,
            "low": low,
            "volume": format_volume(volume),
            "market_cap": format_market_cap(market_cap),
            "price_change": price_change,
            "percent_change": percent_change,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        stock_price_cache[symbol] = (stock_data, datetime.now())
        return stock_data

    except Exception as e:
        logger.error(f"Failed to fetch stock data for {symbol}: {e}")
        return get_dummy_stock_data(symbol)

def get_dummy_stock_data(symbol):
    return {
        "symbol": symbol,
        "price": 1000.0,
        "open": 995.0,
        "high": 1010.0,
        "low": 990.0,
        "volume": "00",
        "market_cap": "00",
        "price_change": 5.0,
        "percent_change": 0.5,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "error": "Real-time data unavailable. Dummy data returned."
    }

def calculate_ratios(stock):
    try:
        info = stock.info
        def safe(val):
            return round(val, 2) if isinstance(val, (int, float)) and not math.isnan(val) else "00"

        return {
            "PE Ratio": safe(info.get("trailingPE")),
            "PB Ratio": safe(info.get("priceToBook")),
            "EPS": safe(info.get("trailingEps")),
            "Dividend Yield": safe(info.get("dividendYield")),
            "ROE": safe(info.get("returnOnEquity")),
            "ROA": safe(info.get("returnOnAssets")),
            "Debt to Equity": safe(info.get("debtToEquity")),
            "Current Ratio": safe(info.get("currentRatio")),
        }
    except Exception as e:
        logger.warning(f"Failed to calculate ratios for stock: {e}")
        return {
            "PE Ratio": "00",
            "PB Ratio": "00",
            "EPS": "00",
            "Dividend Yield": "00",
            "ROE": "00",
            "ROA": "00",
            "Debt to Equity": "00",
            "Current Ratio": "00",
        }

def fetch_historical_chart(stock, period="max"):
    try:
        df = stock.history(period=period)
        if df.empty:
            return []
        return [
            {
                "date": date.strftime("%Y-%m-%d"),
                "open": round(row["Open"], 2) if not math.isnan(row["Open"]) else "00",
                "high": round(row["High"], 2) if not math.isnan(row["High"]) else "00",
                "low": round(row["Low"], 2) if not math.isnan(row["Low"]) else "00",
                "close": round(row["Close"], 2) if not math.isnan(row["Close"]) else "00",
                "volume": int(row["Volume"]) if not math.isnan(row["Volume"]) else "00",
            }
            for date, row in df.iterrows()
        ]
    except Exception as e:
        logger.error(f"Failed to fetch historical chart: {e}")
        return []

def scrape_screener_data(symbol, section_id):
    """Generic table scraper for Screener.in"""
    url = f"https://www.screener.in/company/{quote(symbol.upper())}/consolidated/"
    try:
        resp = safe_request(url)
        if not resp:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        section = soup.find("section", id=section_id)
        if not section:
            return []

        table = section.find("table")
        if not table:
            return []

        headers = [th.get_text(strip=True) for th in table.find_all("th")[1:]]
        rows = []

        for tr in table.find_all("tr")[1:]:
            cols = [td.get_text(strip=True).replace(",", "") for td in tr.find_all("td")]
            if not cols:
                continue
            item = cols[0]
            values = [(float(c) if c.replace(".", "", 1).isdigit() else c) for c in cols[1:]]
            rows.append({"item": item, "years": headers, "values": values})

        return rows
    except Exception as e:
        logger.error(f"Failed to scrape section '{section_id}' for {symbol}: {e}")
        return []

def scrape_analysis(symbol):
    """Scrape analysis pros and cons from Screener.in"""
    url = f"https://www.screener.in/company/{quote(symbol.upper())}/consolidated/"
    try:
        resp = safe_request(url)
        if not resp:
            return {"pros": [], "cons": []}

        soup = BeautifulSoup(resp.text, "html.parser")
        analysis_section = soup.find("section", id="analysis")
        if not analysis_section:
            return {"pros": [], "cons": []}

        pros = []
        cons = []
        
        pros_section = analysis_section.find("div", class_="pros")
        if pros_section:
            pros = [li.get_text(strip=True) for li in pros_section.find_all("li")]
        
        cons_section = analysis_section.find("div", class_="cons")
        if cons_section:
            cons = [li.get_text(strip=True) for li in cons_section.find_all("li")]

        return {"pros": pros, "cons": cons}
    except Exception as e:
        logger.error(f"Failed to scrape analysis for {symbol}: {e}")
        return {"pros": [], "cons": []}

if __name__ == "__main__":
    print(get_stock_price("TATAMOTORS.NS", refresh=True))