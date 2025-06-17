#!/usr/bin/env python3
"""
scraper.py

Fetches fundamental data for Indian stocks (NSE/BSE) from Yahoo Finance using yfinance.
Handles ticker validation, API rate limiting, and saves data in JSON format.

Usage:
    python scraper.py --ticker TCS.NS
    python scraper.py --ticker RELIANCE.BO --rate_limit 5

For Indian stocks on Yahoo Finance:
    - NSE tickers end with ".NS" (e.g., TCS.NS, INFY.NS)
    - BSE tickers end with ".BO" (e.g., TCS.BO, INFY.BO)
"""

import argparse
import time
import json
import yfinance as yf
import pandas as pd
from datetime import date
import os

def validate_indian_ticker(ticker: str) -> None:
    """Ensure the ticker is valid for NSE (.NS) or BSE (.BO)."""
    if not ticker.endswith((".NS", ".BO")):
        raise argparse.ArgumentTypeError(
            f"Invalid Indian ticker: {ticker}. "
            "NSE tickers must end with .NS (e.g., TCS.NS), "
            "BSE tickers with .BO (e.g., TCS.BO)"
        )

def convert_timestamps(obj):
    """Recursively convert Timestamp objects to strings, including dictionary keys."""
    if isinstance(obj, (pd.Timestamp, date)):
        return obj.strftime('%Y-%m-%d')
    elif isinstance(obj, dict):
        return {str(k): convert_timestamps(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_timestamps(item) for item in obj]
    return obj

def df_to_dict(df):
    """Convert DataFrame to dictionary ensuring all keys are strings."""
    if df is None or df.empty:
        return {}
    df.index = df.index.astype(str)
    return df.to_dict()

def fetch_historical_prices(stock):
    """Fetch all historical price data from max available to current date."""
    try:
        # Fetch all historical data
        history = stock.history(period="max")
        if history.empty:
            return {"error": "No historical data available"}
        
        # Convert to dictionary with date-wise data
        historical_data = {}
        for date, row in history.iterrows():
            historical_data[date.strftime('%Y-%m-%d')] = {
                "Open": row["Open"],
                "High": row["High"],
                "Low": row["Low"],
                "Close": row["Close"],
                "Volume": row["Volume"]
            }
        return historical_data
    except Exception as e:
        return {"error": str(e)}

def fetch_dividends(stock):
    """Fetch dividend data."""
    try:
        return df_to_dict(stock.dividends)
    except Exception as e:
        return {"error": str(e)}

def fetch_splits(stock):
    """Fetch stock split data."""
    try:
        return df_to_dict(stock.splits)
    except Exception as e:
        return {"error": str(e)}

def fetch_news(stock):
    """Fetch latest news articles related to the stock."""
    try:
        return stock.news if stock.news else []
    except Exception as e:
        return {"error": str(e)}

def fetch_fundamentals_data(ticker: str, rate_limit: int = 5) -> dict:
    """Fetch stock data from Yahoo Finance with rate limiting."""
    stock = yf.Ticker(ticker)
    data = {}

    def fetch_data(label, func):
        """Helper function to fetch and store data with error handling."""
        try:
            result = func()
            return df_to_dict(result) if isinstance(result, pd.DataFrame) else result
        except Exception as e:
            return {"error": str(e)}

    data['info'] = fetch_data("info", lambda: stock.info)
    time.sleep(rate_limit)

    data['quarterly_results'] = fetch_data("quarterly_results", lambda: stock.quarterly_financials)
    time.sleep(rate_limit)

    data['profit_loss'] = fetch_data("profit_loss", lambda: stock.financials)
    time.sleep(rate_limit)

    data['balance_sheet'] = fetch_data("balance_sheet", lambda: stock.balance_sheet)
    time.sleep(rate_limit)

    data['cash_flow'] = fetch_data("cash_flow", lambda: stock.cashflow)
    time.sleep(rate_limit)

    data['major_holders'] = fetch_data("major_holders", lambda: stock.major_holders)
    time.sleep(rate_limit)

    data['institutional_holders'] = fetch_data("institutional_holders", lambda: stock.institutional_holders)
    time.sleep(rate_limit)

    data['ratings'] = fetch_data("ratings", lambda: stock.recommendations)
    time.sleep(rate_limit)

    data['historical_prices'] = fetch_historical_prices(stock)
    time.sleep(rate_limit)

    data['dividends'] = fetch_dividends(stock)
    time.sleep(rate_limit)

    data['splits'] = fetch_splits(stock)
    time.sleep(rate_limit)

    data['news'] = fetch_news(stock)

    return convert_timestamps(data)

def main():
    parser = argparse.ArgumentParser(description="Fetch Indian stock data from Yahoo Finance.")
    parser.add_argument("--ticker", type=str, required=True, help="Stock ticker (e.g., 'TCS.NS' or 'TCS.BO')")
    parser.add_argument("--rate_limit", type=int, default=5, help="Rate limit in seconds (default: 5)")
    args = parser.parse_args()

    try:
        validate_indian_ticker(args.ticker)
    except argparse.ArgumentTypeError as e:
        parser.error(str(e))

    data = fetch_fundamentals_data(args.ticker, args.rate_limit)

    stock_name = args.ticker.split(".")[0]
    output_dir = r"D:\TEMP-PROJECT\TradeEasy\backend\tests\data"
    os.makedirs(output_dir, exist_ok=True)
    file_path = os.path.join(output_dir, f"{stock_name}.json")

    with open(file_path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4)

    print(f"✅ Data saved to {file_path}")

if __name__ == "__main__":
    main()