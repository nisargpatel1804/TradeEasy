import yfinance as yf
from datetime import datetime
from app import create_app, db  # Import create_app to get app context
from app.models import MarketIndex

# List of market indices to track
INDICES = {
    "Nifty 50": "^NSEI",
    "Sensex": "^BSESN",
    "Nifty Bank": "^NSEBANK",
    "Nifty IT": "^CNXIT",
    "S&P 500": "^GSPC",
    "Dow Jones": "^DJI",
    "Nasdaq": "^IXIC",
    "FTSE 100": "^FTSE",
    "DAX": "^GDAXI",
    "Hang Seng": "^HSI",
    "Nikkei 225": "^N225",
}

def fetch_market_indices():
    """
    Fetches the latest market index data from yfinance and updates the database.
    """
    app = create_app()  # Create Flask app instance
    with app.app_context():  # Use application context to access database
        for name, symbol in INDICES.items():
            try:
                index = yf.Ticker(symbol)
                data = index.history(period="1d")

                if data.empty:
                    print(f"⚠️ No data found for {name} ({symbol})")
                    continue

                price = round(data["Close"].iloc[-1], 2)
                open_price = round(data["Open"].iloc[-1], 2)
                change = round(price - open_price, 2)
                percent_change = round((change / open_price) * 100, 2)

                # Check if the index exists in the database
                market_index = MarketIndex.query.filter_by(symbol=symbol).first()

                if market_index:
                    # Update existing index
                    market_index.price = price
                    market_index.change = change
                    market_index.percent_change = percent_change
                    market_index.last_updated = datetime.utcnow()
                else:
                    # Insert new index data
                    market_index = MarketIndex(
                        name=name,
                        symbol=symbol,
                        price=price,
                        change=change,
                        percent_change=percent_change,
                    )
                    db.session.add(market_index)

                db.session.commit()
                print(f"✅ Updated {name}: {price} ({percent_change}%)")

            except Exception as e:
                print(f"❌ Error fetching {name}: {e}")

if __name__ == "__main__":
    fetch_market_indices()
