import logging
from flask import Blueprint, jsonify, request
from functools import lru_cache
from app.moapi.mo_api import MotilalOswalAPI
from app.models import AQScrip, Stock

# Configure logging
stock_bp = Blueprint('stock', __name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Global MO API Instance ---
_mo_api_instance = None

def get_mo_api():
    global _mo_api_instance
    if _mo_api_instance is None:
        _mo_api_instance = MotilalOswalAPI()
    return _mo_api_instance

def format_symbol(symbol):
    """Cleans and standardizes the stock symbol."""
    symbol = symbol.strip().upper()
    # Remove common exchange suffixes for API calls
    if symbol.endswith(('.NSE', '.BSE', '.NS', '.BO')):
        symbol = symbol.rsplit('.', 1)[0]
    return symbol

@lru_cache(maxsize=256)
def get_stock_data_from_api(symbol):
    """
    Cached function to fetch stock data using the Motilal Oswal API.
    This is the primary source for all single-stock data lookups.
    """
    clean_symbol = format_symbol(symbol)
    try:
        mo_api = get_mo_api()
        if not mo_api.auth_token and not mo_api.login():
            raise ConnectionError("MO API login failed")

        # Resolve symbol to exchange + scripcode
        # Priority: Stock collection (user-added metadata), then AQScrip master
        exchange = None
        scripcode = None

        # Try in Stock collection first
        try:
            stock_doc = Stock.objects(symbol=clean_symbol).first()
            if stock_doc and getattr(stock_doc, 'scripcode', None):
                exchange = getattr(stock_doc, 'exchange', 'NSE') or 'NSE'
                scripcode = int(stock_doc.scripcode)
        except Exception:
            pass

        if scripcode is None:
            # Try AQScrip master by scripshortname (symbol) on NSE
            try:
                aq = AQScrip.objects(exchangename='NSE', scripshortname=clean_symbol).first()
                if aq:
                    exchange = 'NSE'
                    scripcode = int(aq.scripcode)
            except Exception:
                pass

        if scripcode is None:
            # Last-resort fallback: query MO master scrips (NSE) and resolve once, then optionally cache in DB
            try:
                master_resp = mo_api.get_scrips_by_exchange('NSE')
                if master_resp and master_resp.get('status') == 'SUCCESS':
                    candidates = master_resp.get('data', [])
                    chosen = None
                    clean_up = clean_symbol.upper()
                    # Prefer exact shortname match
                    for s in candidates:
                        if str(s.get('scripshortname', '')).upper() == clean_up:
                            chosen = s
                            break
                    # Fallback: match by scripname prefix (common format: "<SYMBOL> EQ")
                    if not chosen:
                        for s in candidates:
                            if str(s.get('scripname', '')).upper().startswith(clean_up):
                                chosen = s
                                break
                    if chosen and chosen.get('scripcode'):
                        exchange = 'NSE'
                        scripcode = int(chosen.get('scripcode'))
                        # Opportunistically cache minimal record into AQScrip if missing
                        try:
                            if not AQScrip.objects(exchangename='NSE', scripcode=scripcode).first():
                                AQScrip(
                                    exchange=int(chosen.get('exchange', 0) or 0),
                                    exchangename='NSE',
                                    scripcode=scripcode,
                                    scripname=str(chosen.get('scripname') or clean_up),
                                    scripshortname=str(chosen.get('scripshortname') or clean_up),
                                    scripfullname=str(chosen.get('scripfullname') or ''),
                                ).save()
                        except Exception:
                            # Best-effort cache; ignore failures
                            pass
            except Exception:
                # Ignore master fetch failures; we'll return not found below if still unresolved
                pass

        if scripcode is None:
            logger.warning(f"Unable to resolve scripcode for symbol {clean_symbol}")
            return None

        mo_response = mo_api.get_ltp_data(exchange or 'NSE', scripcode)

        if mo_response and mo_response.get("status") == "SUCCESS":
            data = mo_response.get("data", {})
            # Normalize numeric fields and derive change/percent_change if possible
            try:
                open_p = float(data.get('open') or 0)
                high = float(data.get('high') or 0)
                low = float(data.get('low') or 0)
                close = float(data.get('close') or 0)
                ltp = float(data.get('ltp') or 0)
                volume = int(data.get('volume') or 0)
                change = ltp - close if close else 0.0
                p_change = (change / close * 100.0) if close else 0.0
                return {
                    'exchange': exchange or 'NSE',
                    'scripcode': scripcode,
                    'open': open_p,
                    'high': high,
                    'low': low,
                    'close': close,
                    'ltp': ltp,
                    'volume': volume,
                    'change': round(change, 2),
                    'p_change': round(p_change, 2)
                }
            except Exception:
                return mo_response.get('data', {})
        else:
            logger.warning(f"No data found for scripcode {scripcode} ({clean_symbol}) via API.")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching MO API data for {clean_symbol}: {e}")
        return None

def calculate_ratios(stock_data):
    """
    Calculates ratios from available stock data.
    Note: Returns placeholders as the MO API does not provide deep financial statements.
    """
    if not stock_data:
        return {"note": "Ratios not available due to missing data", "market_price": 0}
        
    price = stock_data.get('ltp', 0)
    return {
        "roe": "N/A",
        "roce": "N/A",
        "sales_growth_1y": "N/A",
        "profit_growth_1y": "N/A",
        "debt_to_equity": "N/A",
        "market_price": round(price, 2),
        "note": "Detailed financial ratios require a fundamental data provider."
    }

@stock_bp.route("/stock/overview/<symbol>", methods=["GET"])
def get_stock_overview(symbol):
    """
    Get a streamlined stock overview and key metrics for a given symbol.
    Makes ONE API call and reuses the data for efficiency.
    """
    try:
        # Fetch data using the optimized, cached function
        stock_api_data = get_stock_data_from_api(symbol)

        if not stock_api_data:
            return jsonify({"error": f"Could not retrieve data for symbol: {symbol}. It may be delisted or invalid."}), 404

        # --- Data fetched successfully, now format the response ---
        price_data = {
            "symbol": format_symbol(symbol),
            "price": stock_api_data.get("ltp", 0),
            "open": stock_api_data.get("open", 0),
            "high": stock_api_data.get("high", 0),
            "low": stock_api_data.get("low", 0),
            "close": stock_api_data.get("close", 0),
            "volume": stock_api_data.get("volume", 0),
            "price_change": stock_api_data.get("change", 0),
            "percent_change": stock_api_data.get("p_change", 0),
            "source": "motilal_oswal_api",
        }
        
        # Reuse the fetched data to calculate ratios
        ratios = calculate_ratios(stock_api_data)
        
        # Placeholder for chart data
        chart_data = {"message": "Historical chart data is not available via this API."}

        # Combine all parts into the final result
        result = {
            "price_data": price_data,
            "ratios": ratios,
            "chart_data": chart_data
        }
        return jsonify(result)

    except Exception as e:
        logger.error(f"Unhandled error in get_stock_overview for {symbol}: {str(e)}")
        return jsonify({"error": "An internal server error occurred."}), 500

@stock_bp.route("/stocks/batch", methods=["GET"])
def batch_stock_data():
    """
    Fetch stock data for multiple symbols.
    """
    symbols_param = request.args.get('symbols', '')
    if not symbols_param:
        return jsonify({"error": "Query parameter 'symbols' is required."}), 400
        
    symbols = list(set([s.strip() for s in symbols_param.split(',') if s.strip()]))
    if not symbols:
        return jsonify({"error": "No valid symbols provided."}), 400
        
    # Limit batch size to prevent abuse
    if len(symbols) > 50:
        return jsonify({"error": "Maximum of 50 symbols allowed per batch request."}), 413
            
    batch_data = {}
    for symbol in symbols:
        # Use the same cached function for efficiency
        stock_api_data = get_stock_data_from_api(symbol)
        clean_symbol = format_symbol(symbol)
        
        if stock_api_data:
            batch_data[clean_symbol] = {
                'symbol': clean_symbol,
                'ltp': stock_api_data.get('ltp', 0),
                'change': stock_api_data.get('change', 0),
                'p_change': stock_api_data.get('p_change', 0),
                'volume': stock_api_data.get('volume', 0),
                'source': 'motilal_oswal'
            }
        else:
            batch_data[clean_symbol] = {'error': f'No data found for {clean_symbol}'}
            
    return jsonify({
        "data": batch_data,
        "message": f"Processed {len(symbols)} symbols."
    })
