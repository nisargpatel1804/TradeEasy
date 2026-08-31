"""
Historical Charting Data Route
Fetches OHLCV (Open, High, Low, Close, Volume) data for rendering 
frontend interactive candlestick charts. Uses Yahoo Finance (yfinance) 
as the Motilal Oswal API does not provide historical candle data.
"""

import logging
import time
import math
import yfinance as yf
import pandas as pd
from flask import Blueprint, jsonify, request
from flask_login import login_required

from app.services.cache import cache as app_cache

logger = logging.getLogger(__name__)
charts_bp = Blueprint('charts', __name__)

# Allowed yfinance intervals and periods
VALID_INTERVALS = {'1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'}
VALID_PERIODS = {'1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'}


def _to_yf_symbol(symbol: str) -> str:
    """
    Translates internal symbols (e.g., RELIANCE, RELIANCE.NSE) 
    to Yahoo Finance NSE formats (RELIANCE.NS).
    """
    clean_symbol = str(symbol).strip().upper()
    if '.' in clean_symbol:
        clean_symbol = clean_symbol.split('.')[0]
    
    # Defaulting to NSE (National Stock Exchange of India)
    return f"{clean_symbol}.NS"


def _get_dynamic_ttl(interval: str) -> int:
    """
    Determines how long to cache the chart data based on the resolution.
    Intraday data caches briefly. Daily/Weekly data caches for hours.
    """
    if interval == '1m':
        return 60         # 1 minute
    elif interval in ('2m', '5m'):
        return 300        # 5 minutes
    elif interval in ('15m', '30m'):
        return 900        # 15 minutes
    elif interval in ('60m', '90m', '1h'):
        return 3600       # 1 hour
    else:
        return 3600 * 6   # 6 hours for 1d, 1wk, 1mo


@charts_bp.route('/charts/sparklines/batch', methods=['GET', 'OPTIONS'], strict_slashes=False)
@charts_bp.route('/sparklines/batch', methods=['GET', 'OPTIONS'], strict_slashes=False)
@login_required
def get_batch_sparklines():
    """
    Fetches lightweight sparkline data (intraday trend) for multiple symbols.
    """
    if request.method == 'OPTIONS':
        return jsonify({"success": True}), 200

    symbols_str = request.args.get('symbols', '')
    if not symbols_str:
        return jsonify({"success": False, "message": "No symbols provided"}), 400
        
    symbols = [s.strip() for s in symbols_str.split(',') if s.strip()]
    if len(symbols) > 50:
        return jsonify({"success": False, "message": "Maximum 50 symbols allowed per batch"}), 400
        
    results = {}
    for symbol in symbols:
        yf_symbol = _to_yf_symbol(symbol)
        
        # 1. Check Cache first (critical for batch processing)
        cache_key = f"sparkline:v1:{yf_symbol}"
        cached_data = app_cache.get(cache_key)
        
        if cached_data is not None:
            results[symbol] = cached_data
            continue
            
        # 2. Fetch from yfinance if not cached
        try:
            ticker = yf.Ticker(yf_symbol)
            # Fetch today's intraday data (15m intervals)
            hist = ticker.history(period='1d', interval='15m')
            
            if hist.empty:
                # Fallback to 5d daily if market is closed or weekend
                hist = ticker.history(period='5d', interval='1d')
                
            if not hist.empty:
                hist.dropna(subset=['Close'], inplace=True)
                closes = hist['Close'].tolist()
                
                # Subsample to a maximum of 20 points to keep SVG render overhead minimal
                if len(closes) > 20:
                    step = len(closes) / 20.0
                    closes = [round(closes[int(i * step)], 2) for i in range(20)]
                else:
                    closes = [round(c, 2) for c in closes]
                    
                results[symbol] = closes
                app_cache.set(cache_key, closes, ttl=300)
            else:
                results[symbol] = []
                app_cache.set(cache_key, [], ttl=300)
                
        except Exception as e:
            logger.error(f"Failed to fetch sparkline for {symbol}: {e}")
            results[symbol] = []
            
    return jsonify({
        "success": True,
        "sparklines": results
    }), 200


@charts_bp.route('/charts/<string:symbol>', methods=['GET'], strict_slashes=False)
@login_required
def get_historical_chart_data(symbol):
    """
    Fetches historical OHLCV data for a specific stock.
    
    Query Parameters:
    - interval: The timeframe of each candle (default '1d'). e.g., '5m', '1h', '1d'
    - range: The total lookback period (default '1mo'). e.g., '1d', '1mo', '1y'
    """
    try:
        interval = str(request.args.get('interval', '1d')).strip().lower()
        period = str(request.args.get('range', '1mo')).strip().lower()

        if interval not in VALID_INTERVALS:
            return jsonify({
                "success": False, 
                "message": f"Invalid interval. Allowed: {', '.join(VALID_INTERVALS)}"
            }), 400

        if period not in VALID_PERIODS:
            return jsonify({
                "success": False, 
                "message": f"Invalid range. Allowed: {', '.join(VALID_PERIODS)}"
            }), 400

        # yfinance restriction: 1m data is only retrievable for the last 7 days.
        if interval == '1m' and period not in ('1d', '5d'):
            return jsonify({
                "success": False, 
                "message": "1-minute (1m) interval data is only available for '1d' or '5d' ranges."
            }), 400

        yf_symbol = _to_yf_symbol(symbol)
        
        # Check Cache to protect against Yahoo Finance IP Rate Limits
        cache_key = f"chart:v1:{yf_symbol}:{interval}:{period}"
        cached_data = app_cache.get(cache_key)
        if cached_data:
            logger.debug(f"Chart Cache HIT for {cache_key}")
            return jsonify({
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "range": period,
                "candles": cached_data,
                "cached": True
            }), 200

        logger.info(f"Fetching yfinance data for {yf_symbol} (Interval: {interval}, Range: {period})")
        
        ticker = yf.Ticker(yf_symbol)
        hist = ticker.history(period=period, interval=interval)

        if hist.empty:
            return jsonify({
                "success": False,
                "message": f"No historical data found for {symbol} over the requested period."
            }), 404

        # Clean Data: Drop rows where 'Close' is NaN
        hist.dropna(subset=['Close'], inplace=True)

        candles = []
        for index, row in hist.iterrows():
            epoch = int(index.timestamp())
            
            open_val = float(row['Open'])
            high_val = float(row['High'])
            low_val = float(row['Low'])
            close_val = float(row['Close'])
            volume_val = int(row['Volume'])
            
            if math.isnan(open_val) or math.isnan(close_val):
                continue
                
            candles.append({
                "time": epoch,
                "open": round(open_val, 2),
                "high": round(high_val, 2),
                "low": round(low_val, 2),
                "close": round(close_val, 2),
                "volume": volume_val
            })

        cache_ttl = _get_dynamic_ttl(interval)
        app_cache.set(cache_key, candles, ttl=cache_ttl)

        return jsonify({
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "range": period,
            "candles": candles,
            "cached": False
        }), 200

    except Exception as e:
        logger.error(f"Failed to fetch historical chart data for {symbol}: {e}", exc_info=True)
        return jsonify({
            "success": False,
            "message": "An internal error occurred while fetching chart data. Please try again."
        }), 500