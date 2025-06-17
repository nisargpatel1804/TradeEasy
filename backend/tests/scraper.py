import yfinance as yf
from datetime import datetime, timedelta
import logging
import math
import numpy as np
import time
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine
from app import create_app, db  # Ensure Flask app is initialized properly

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Cache for stock prices (valid for 5 minutes)
stock_price_cache = {}

# Initialize app context
app = create_app()

def get_db_session():
    """Create a new SQLAlchemy session within the app context."""
    with app.app_context():
        Session = sessionmaker(bind=db.engine)
        return Session()

def format_market_cap(market_cap):
    if isinstance(market_cap, (int, float)):
        if market_cap >= 1_00_00_00_000:
            return f"{market_cap / 1_00_00_00:,.2f} Cr"
        elif market_cap >= 10_00_000:
            return f"{market_cap / 10_000:,.2f} Lac"
        else:
            return f"{market_cap:,.0f}"
    return None

def format_volume(volume):
    if isinstance(volume, (int, float)):
        if volume >= 1_00_000:
            return f"{volume / 1_00_000:,.0f} L"
        else:
            return f"{volume:,.0f}"
    return None

def upsert_stock_index_data(symbol, name, data_type, open_price, high_price, low_price, close_price, volume, market_cap, pe_ratio, change, percent_change):
    """Inserts or updates the stock_index_data_cache table."""
    session = get_db_session()
    try:
        existing = session.execute(
            "SELECT id FROM stock_index_data_cache WHERE symbol = :symbol",
            {"symbol": symbol}
        ).fetchone()

        if existing:
            session.execute(
                """
                UPDATE stock_index_data_cache
                SET name = :name, type = :data_type, open_price = :open_price, high_price = :high_price, 
                    low_price = :low_price, close_price = :close_price, volume = :volume, 
                    market_cap = :market_cap, pe_ratio = :pe_ratio, change = :change, 
                    percent_change = :percent_change, last_updated = GETDATE()
                WHERE symbol = :symbol
                """,
                {
                    "name": name, "data_type": data_type, "open_price": open_price,
                    "high_price": high_price, "low_price": low_price, "close_price": close_price,
                    "volume": volume, "market_cap": market_cap, "pe_ratio": pe_ratio,
                    "change": change, "percent_change": percent_change, "symbol": symbol
                }
            )
            logger.info(f"Updated existing record for {symbol}.")
        else:
            session.execute(
                """
                INSERT INTO stock_index_data_cache 
                (symbol, name, type, open_price, high_price, low_price, close_price, volume, 
                 market_cap, pe_ratio, change, percent_change, last_updated)
                VALUES 
                (:symbol, :name, :data_type, :open_price, :high_price, :low_price, :close_price, :volume, 
                 :market_cap, :pe_ratio, :change, :percent_change, GETDATE())
                """,
                {
                    "symbol": symbol, "name": name, "data_type": data_type, "open_price": open_price,
                    "high_price": high_price, "low_price": low_price, "close_price": close_price,
                    "volume": volume, "market_cap": market_cap, "pe_ratio": pe_ratio,
                    "change": change, "percent_change": percent_change
                }
            )
            logger.info(f"Inserted new record for {symbol}.")
        session.commit()

    except Exception as e:
        session.rollback()
        logger.error(f"Failed to upsert data for {symbol}: {e}")
    finally:
        session.close()

def get_stock_price(symbol="RELIANCE.NS", name="Reliance Industries", data_type="stock", retries=3, retry_delay=5):
    """Fetches and stores real-time stock or index data."""
    try:
        symbol = symbol.upper()

        # Check cache (valid for 5 minutes)
        if symbol in stock_price_cache:
            cached_data, timestamp = stock_price_cache[symbol]
            if datetime.now() - timestamp < timedelta(minutes=5):
                logger.info(f"Using cached data for {symbol}")
                return cached_data

        # Retry mechanism
        for attempt in range(retries):
            try:
                stock = yf.Ticker(symbol)
                history = stock.history(period="2d")

                if history.empty:
                    raise ValueError(f"No valid historical data found for {symbol}")

                today_data = history.iloc[-1]
                yesterday_data = history.iloc[-2]

                open_price = round(today_data["Open"], 2)
                high = round(today_data["High"], 2)
                low = round(today_data["Low"], 2)
                close_price = round(today_data["Close"], 2)
                volume = int(today_data["Volume"]) if not math.isnan(today_data["Volume"]) else None
                previous_close = round(yesterday_data["Close"], 2)

                market_cap = stock.fast_info.get("marketCap", None)
                pe_ratio = stock.info.get("forwardPE", None)

                price_change = round(close_price - previous_close, 2)
                percent_change = round((price_change / previous_close) * 100, 2)

                # Store in database
                upsert_stock_index_data(
                    symbol, name, data_type, open_price, high, low, close_price, volume,
                    market_cap, pe_ratio, price_change, percent_change
                )

                stock_data = {
                    "symbol": symbol,
                    "name": name,
                    "type": data_type,
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close_price,
                    "volume": format_volume(volume),
                    "market_cap": format_market_cap(market_cap),
                    "pe_ratio": pe_ratio,
                    "price_change": price_change,
                    "percent_change": percent_change,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }

                stock_price_cache[symbol] = (stock_data, datetime.now())
                return stock_data

            except Exception as e:
                if "Too Many Requests" in str(e) and attempt < retries - 1:
                    wait_time = retry_delay * (2 ** attempt)
                    logger.warning(f"Rate limit hit for {symbol}. Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                else:
                    logger.error(f"Failed to fetch stock data for {symbol}: {e}")
                    return {"error": f"Failed to fetch data for {symbol}. Please try later."}

    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return {"error": "An unexpected error occurred"}

if __name__ == "__main__":
    with app.app_context():
        print(get_stock_price("TATAMOTORS.NS", "Tata Motors", "stock"))
        print(get_stock_price("^NSEI", "Nifty 50", "index"))
        print(get_stock_price("^BSESN", "Sensex", "index"))
