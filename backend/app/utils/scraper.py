import yfinance as yf
from datetime import datetime, timedelta
import logging
import math
import numpy as np
import time
import random
from app.config import AppConfig
import requests
import json

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Anti-ban configuration
MIN_DELAY = 2  # Minimum delay between requests in seconds
MAX_DELAY = 5  # Maximum delay between requests in seconds
MAX_RETRIES = 3  # Maximum number of retries for failed requests

# Stock data cache
stock_price_cache = {}
MAX_CACHE_AGE = timedelta(minutes=15)  # Increase cache time to reduce API calls

# -----------------------------------------------------------------------------
# Additional anti-ban helpers & constants                                       
# -----------------------------------------------------------------------------
USER_AGENTS = [
    # A small rotating list of modern desktop browsers (avoid fake_useragent dep)
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
]

# NSE endpoints (require valid cookies from the main page first)
NSE_HOME_URL = "https://www.nseindia.com"
NSE_QUOTE_API = "https://www.nseindia.com/api/quote-equity?symbol={symbol}"

# Yahoo lightweight quote endpoint (JSON)
YAHOO_QUOTE_API = "https://query1.finance.yahoo.com/v7/finance/quote?symbols={symbol}"

def random_delay():
    """Add random delay between requests to avoid rate limiting"""
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

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
    """Get ticker data with retries and fallback mechanisms"""
    symbol = symbol.upper()
    
    for attempt in range(MAX_RETRIES):
        try:
            stock = yf.Ticker(symbol)
            # Test if the ticker is valid by attempting to get info
            _ = stock.fast_info
            return stock
        except Exception as e:
            logger.warning(f"Attempt {attempt+1} failed to get ticker data for {symbol}: {str(e)}")
            if attempt < MAX_RETRIES - 1:
                time.sleep((attempt + 1) * 2)
            else:
                logger.error(f"All attempts failed for {symbol}")
                raise

def _get_random_headers():
    """Return random desktop browser headers (keep it minimal)."""
    ua = random.choice(USER_AGENTS)
    return {
        "User-Agent": ua,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.nseindia.com",
        "Referer": "https://www.nseindia.com/",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "X-Requested-With": "XMLHttpRequest",
        "DNT": "1",
        "Connection": "keep-alive",
    }

def _fetch_nse_quote(symbol: str):
    """Light-weight quote fetcher that scrapes NSE public JSON.

    This *only* runs when yfinance fails. It uses a fresh session with
    a cookie-priming request to bypass NSE's Cloudflare.
    """
    base_symbol = symbol.split(".")[0].upper()

    session = requests.Session()
    session.headers.update(_get_random_headers())

    try:
        # 1. Prime cookies – required by NSE (ignore result)
        session.get(NSE_HOME_URL, timeout=8)

        # 2. Actual quote request
        url = NSE_QUOTE_API.format(symbol=base_symbol)
        quote_headers = _get_random_headers()
        quote_headers["Referer"] = f"https://www.nseindia.com/get-quotes/equity?symbol={base_symbol}"
        resp = session.get(url, headers=quote_headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        # Bubble up – caller will decide next fallback
        raise RuntimeError(f"NSE fetch failed: {e}") from e

    # ------------------ Parse JSON ------------------
    price_info = data.get("priceInfo", {})
    if not price_info:
        raise RuntimeError("priceInfo missing in NSE response")

    # Convert common numeric strings like "2,345.60" ➜ 2345.6
    def _to_float(val, default=0.0):
        if val is None or val == "-":
            return default
        if isinstance(val, (int, float)):
            return float(val)
        return float(str(val).replace(",", ""))

    price = _to_float(price_info.get("lastPrice"))
    open_price = _to_float(price_info.get("open"), price)
    high = _to_float(price_info.get("intraDayHighLow", {}).get("max"), price)
    low = _to_float(price_info.get("intraDayHighLow", {}).get("min"), price)
    prev_close = _to_float(price_info.get("previousClose"), price)
    volume = int(_to_float(price_info.get("totalTradedVolume"), 0))

    price_change = round(price - prev_close, 2)
    pct_change = round((price_change / prev_close) * 100, 2) if prev_close else 0

    # Market-cap lives under metadata.marketCap
    mcap_raw = data.get("metadata", {}).get("marketCap")
    mcap = _to_float(mcap_raw, 0)

    parsed = {
        "symbol": symbol.upper(),
        "price": round(price, 2),
        "open": round(open_price, 2),
        "high": round(high, 2),
        "low": round(low, 2),
        "volume": format_volume(volume),
        "market_cap": format_market_cap(mcap),
        "price_change": price_change,
        "percent_change": pct_change,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "nseindia",
    }
    return parsed

# -----------------------------------------------------------------------------
# Patch yfinance headers – improves success rate when Yahoo tightens bot rules
# -----------------------------------------------------------------------------
try:
    import yfinance.shared as _yfs
    _yfs._YF_HEADERS.update({"User-Agent": random.choice(USER_AGENTS)})
except Exception:
    # Silently ignore if yfinance internals change
    pass

def get_stock_price(symbol="RELIANCE.NS", refresh=False):
    """
    Get current stock price and related information using yfinance.
    Falls back to dummy data if all attempts fail.
    """
    symbol = symbol.upper()
    # --------------------------------------------------
    # Normalise Indian suffixes to Yahoo Finance format
    # .NSE -> .NS, .BSE -> .BO
    # --------------------------------------------------
    if symbol.endswith(".NSE"):
        symbol = symbol.replace(".NSE", ".NS")
    elif symbol.endswith(".BSE"):
        symbol = symbol.replace(".BSE", ".BO")

    # Dummy shortcut if API access blocked
    if AppConfig.API_BLOCKED:
        return get_dummy_stock_data(symbol)

    # 🗄️ Cache check
    if not refresh and symbol in stock_price_cache:
        cached, ts = stock_price_cache[symbol]
        if datetime.now() - ts < MAX_CACHE_AGE:
            logger.info(f"Using cached data for {symbol}")
            return cached

    # --------------------------------------------------------------
    # Build a **minimal** list of Yahoo variants (<=2) to limit requests
    # --------------------------------------------------------------
    # Determine minimal variant set (max 2) respecting Yahoo conventions
    symbol_variants = []
    if symbol.endswith(".NS"):
        base = symbol.split(".")[0]
        symbol_variants = [symbol, f"{base}.BO"]  # NSE first, then BSE peer
    elif symbol.endswith(".BO"):
        base = symbol.split(".")[0]
        symbol_variants = [symbol, f"{base}.NS"]  # BSE first, then NSE peer
    else:
        # No suffix provided; try NSE then BSE
        symbol_variants = [f"{symbol}.NS", f"{symbol}.BO"]

    for variant in symbol_variants:
        for attempt in range(1):  # Single attempt per variant to avoid noisy loops
            try:
                random_delay()  # Add delay to avoid rate limiting
                
                stock = yf.Ticker(variant)
                
                # History fallbacks limited by user request: only 2d ➜ 5d
                fallback_periods = ["2d", "5d"]
                history = None
                for p in fallback_periods:
                    h = stock.history(period=p)
                    if not h.empty and len(h) >= 2:
                        history = h
                        break
                if history is None:
                    # Last chance: rely on fast_info if Yahoo blocks history
                    fi = stock.fast_info
                    last_price = fi.get("lastPrice") or fi.get("last_price") or fi.get("regularMarketPrice")
                    prev_close = fi.get("previousClose") or fi.get("previous_close")
                    if last_price and prev_close:
                        price = round(float(last_price), 2)
                        prev_close = round(float(prev_close), 2)
                        price_change = round(price - prev_close, 2)
                        pct_change = round((price_change / prev_close) * 100, 2) if prev_close else 0
                        open_price = fi.get("open") or price
                        high = fi.get("dayHigh") or price
                        low = fi.get("dayLow") or price
                        volume = fi.get("volume") or 0

                        data = {
                            "symbol": symbol,
                            "price": price,
                            "open": round(float(open_price), 2) if open_price else price,
                            "high": round(float(high), 2) if high else price,
                            "low": round(float(low), 2) if low else price,
                            "volume": format_volume(int(volume)),
                            "market_cap": format_market_cap(fi.get("marketCap", 0)),
                            "price_change": price_change,
                            "percent_change": pct_change,
                            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "source": "yfinance-fastinfo",
                        }
                        stock_price_cache[symbol] = (data, datetime.now())
                        return data
                    # otherwise move to next variant
                    raise ValueError("No history and fast_info incomplete")
                
                # Get current and previous day data
                today, yesterday = history.iloc[-1], history.iloc[-2]
                
                # Check for NaN values
                if today.isna().all() or yesterday.isna().all():
                    raise ValueError("Invalid row data (NaN) from yfinance")
                
                # Calculate price and changes
                price = round(today["Close"], 2)
                open_price = round(today["Open"], 2)
                high, low = round(today["High"], 2), round(today["Low"], 2)
                volume = int(today["Volume"]) if not math.isnan(today["Volume"]) else 0
                prev_close = round(yesterday["Close"], 2)
                price_change = round(price - prev_close, 2)
                pct_change = round((price_change / prev_close) * 100, 2) if prev_close else 0
                
                # Get market cap
                mcap = stock.fast_info.get("marketCap", 0)
                if isinstance(mcap, np.int64):
                    mcap = int(mcap)
                
                # Prepare result data
                data = {
                    "symbol": symbol,  # Return the original requested symbol
                    "price": price,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "volume": format_volume(volume),
                    "market_cap": format_market_cap(mcap),
                    "price_change": price_change,
                    "percent_change": pct_change,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "source": "yfinance",
                }
                
                # Cache the result
                stock_price_cache[symbol] = (data, datetime.now())
                return data
                
            except Exception as e:
                logger.warning(f"yfinance attempt {attempt+1} failed for {variant}: {e}")
                continue  # Try next attempt or variant
    
    # --- Secondary fallback: Yahoo lightweight quote API -------------------
    try:
        yahoo_quote = _fetch_yahoo_quote(symbol_variants[0])  # use first variant attempted
        stock_price_cache[symbol] = (yahoo_quote, datetime.now())
        logger.info(f"Fetched {symbol} using Yahoo quote fallback")
        return yahoo_quote
    except Exception as e:
        logger.warning(f"Yahoo quote fallback failed for {symbol}: {e}")
    
    # --- Tertiary fallback: scrape NSE public quote API -----------------
    try:
        nse_quote = _fetch_nse_quote(symbol)
        stock_price_cache[symbol] = (nse_quote, datetime.now())
        logger.info(f"Fetched {symbol} using NSE fallback")
        return nse_quote
    except Exception as e:
        logger.warning(f"NSE fallback failed for {symbol}: {e}")
    
    # All attempts failed, return dummy data (last resort)
    logger.warning(f"All attempts failed for {symbol}, returning dummy data")
    return get_dummy_stock_data(symbol)

def get_dummy_stock_data(symbol):
    """Return dummy stock data when real data cannot be fetched"""
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
        "error": "Real-time data unavailable. Dummy data returned.",
        "source": "dummy"
    }

def calculate_ratios(stock):
    """Calculate financial ratios from stock info"""
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
    """Fetch historical price data for charting"""
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

def _fetch_yahoo_quote(symbol: str):
    """Fetch quote using Yahoo query1 API (less likely to break than yfinance)."""
    session = requests.Session()
    session.headers.update({"User-Agent": random.choice(USER_AGENTS)})
    try:
        resp = session.get(YAHOO_QUOTE_API.format(symbol=symbol), timeout=8)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("quoteResponse", {}).get("result")
        if not result:
            raise ValueError("Empty result")
        q = result[0]
    except Exception as e:
        raise RuntimeError(f"Yahoo quote API failed: {e}") from e

    price = q.get("regularMarketPrice") or q.get("postMarketPrice")
    prev_close = q.get("regularMarketPreviousClose") or price
    if price is None:
        raise RuntimeError("Price missing in Yahoo quote data")

    price = float(price)
    prev_close = float(prev_close) if prev_close else price

    price_change = round(price - prev_close, 2)
    pct_change = round((price_change / prev_close) * 100, 2) if prev_close else 0

    return {
        "symbol": symbol.upper(),
        "price": round(price, 2),
        "open": round(float(q.get("regularMarketOpen", price)), 2),
        "high": round(float(q.get("regularMarketDayHigh", price)), 2),
        "low": round(float(q.get("regularMarketDayLow", price)), 2),
        "volume": format_volume(int(q.get("regularMarketVolume") or 0)),
        "market_cap": format_market_cap(int(q.get("marketCap") or 0)),
        "price_change": price_change,
        "percent_change": pct_change,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "yahoo-quote-api",
    }

if __name__ == "__main__":
    print(get_stock_price("TATAMOTORS.NS", refresh=True))