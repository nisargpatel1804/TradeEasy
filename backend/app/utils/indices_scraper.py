import yfinance as yf
from datetime import datetime
from flask import current_app
import requests
from bs4 import BeautifulSoup
import re
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import logging
import random
import json
import math

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define market indices
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

# Alternative index data sources
INVESTING_URL = "https://in.investing.com/indices/"
MONEY_CONTROL_INDEX_URL = "https://www.moneycontrol.com/indian-indices/"
NSE_INDEX_URL = "https://www.nseindia.com/api/allIndices"

# Anti-ban configuration
MAX_RETRIES = 3

def get_random_headers():
    """Generate random headers for requests to avoid being blocked"""
    user_agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 11.5; rv:90.0) Gecko/20100101 Firefox/90.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
    ]
    
    return {
        'User-Agent': random.choice(user_agents),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://www.google.com/',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }

def safe_request(url, max_retries=MAX_RETRIES):
    """Make HTTP request with retries and random delays"""
    for attempt in range(max_retries):
        try:
            # Add random delay between requests
            time.sleep(random.uniform(1, 3))
            headers = get_random_headers()
            resp = requests.get(url, headers=headers, timeout=15)
            
            if resp.status_code == 429:
                wait_time = (attempt + 1) * 5
                logger.warning(f"Rate limited. Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                continue
                
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            logger.warning(f"Request attempt {attempt + 1} failed: {str(e)}")
            if attempt == max_retries - 1:
                raise
            time.sleep((attempt + 1) * 2)
    return None

def fetch_nse_index_data():
    """Fetch index data directly from NSE API"""
    try:
        logger.info("Attempting to fetch index data from NSE API")
        
        # NSE URLs
        home_url = "https://www.nseindia.com"
        api_url = NSE_INDEX_URL
        
        # Create a session to maintain cookies
        with requests.Session() as session:
            # First get cookies by visiting home page with realistic headers
            headers = get_random_headers()
            headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            
            try:
                home_response = session.get(home_url, headers=headers, timeout=15)
                if home_response.status_code != 200:
                    logger.warning(f"Failed to access NSE homepage: Status {home_response.status_code}")
                    return None
            except requests.exceptions.RequestException as e:
                logger.warning(f"Error accessing NSE homepage: {e}")
                return None
            
            # Add a delay to simulate human behavior
            time.sleep(random.uniform(2, 4))
            
            # Set up API request headers
            api_headers = get_random_headers()
            api_headers['Referer'] = home_url
            api_headers['Accept'] = 'application/json'
            api_headers['X-Requested-With'] = 'XMLHttpRequest'
            
            # Try multiple attempts with different headers
            for attempt in range(MAX_RETRIES):
                try:
                    if attempt > 0:
                        logger.info(f"Retrying NSE API fetch, attempt {attempt+1}")
                        time.sleep(random.uniform(3, 5))  # Longer delay between retries
                        
                    response = session.get(api_url, headers=api_headers, timeout=20)
                    
                    if response.status_code == 401:
                        logger.warning(f"NSE API authentication failed (401): Attempt {attempt+1}")
                        # Try refreshing the session cookies
                        session.get(home_url, headers=headers, timeout=15)
                        time.sleep(random.uniform(2, 3))
                        continue
                        
                    if response.status_code != 200:
                        logger.warning(f"NSE API returned status code {response.status_code}: Attempt {attempt+1}")
                        continue
                    
                    try:
                        data = response.json()
                    except ValueError:
                        logger.warning(f"NSE API returned invalid JSON: Attempt {attempt+1}")
                        continue
                    
                    # Process the data
                    result = {}
                    if 'data' not in data:
                        logger.warning("NSE API response missing 'data' field")
                        continue
                    
                    for index in data.get("data", []):
                        name = index.get("indexName", "")
                        if name in ["NIFTY 50", "NIFTY BANK", "NIFTY IT"]:
                            try:
                                symbol = next((k for k, v in INDICES.items() if v.endswith(index.get('indexSymbol', ''))), name)
                                price = float(index.get("last", 0))
                                prev_close = float(index.get("previousClose", 0))
                                change = price - prev_close
                                percent_change = (change / prev_close) * 100 if prev_close > 0 else 0
                                
                                result[symbol] = {
                                    "name": symbol,
                                    "symbol": INDICES.get(symbol, ""),
                                    "price": round(price, 2),
                                    "change": round(change, 2),
                                    "percent_change": round(percent_change, 2),
                                    "source": "NSE API"
                                }
                            except (KeyError, TypeError, ValueError) as e:
                                logger.warning(f"Error processing index {name}: {e}")
                                continue
                    
                    if result:
                        logger.info(f"Successfully fetched data for {len(result)} indices from NSE API")
                        return result
                    else:
                        logger.warning("NSE API returned no usable index data")
                        
                except requests.exceptions.RequestException as e:
                    logger.warning(f"NSE API request failed: {e}")
                    if attempt == MAX_RETRIES - 1:
                        break
            
            logger.warning("All attempts to fetch NSE index data failed")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching from NSE API: {str(e)}")
        return None

def fetch_money_control_index_data():
    """Fetch index data from Money Control as a fallback"""
    try:
        logger.info("Attempting to fetch index data from Money Control")
        response = safe_request(MONEY_CONTROL_INDEX_URL)
        if not response:
            return None
            
        soup = BeautifulSoup(response.text, 'html.parser')
        indices_table = soup.find('div', {'class': 'indices_table'})
        
        if not indices_table:
            return None
            
        index_rows = indices_table.find_all('tr')
        result = {}
        
        for row in index_rows[1:]:  # Skip header row
            cells = row.find_all('td')
            if len(cells) >= 4:
                name = cells[0].text.strip()
                
                # Map Money Control names to our index names
                name_map = {
                    "NIFTY 50": "Nifty 50",
                    "S&P BSE SENSEX": "Sensex",
                    "NIFTY BANK": "Nifty Bank",
                    "NIFTY IT": "Nifty IT"
                }
                
                if name in name_map:
                    price_text = cells[1].text.strip().replace(',', '')
                    change_text = cells[2].text.strip().replace(',', '')
                    percent_text = cells[3].text.strip().replace('%', '').replace(',', '')
                    
                    try:
                        price = float(price_text)
                        change = float(change_text)
                        percent_change = float(percent_text)
                        
                        result[name_map[name]] = {
                            "name": name_map[name],
                            "symbol": INDICES.get(name_map[name], ""),
                            "price": round(price, 2),
                            "change": round(change, 2),
                            "percent_change": round(percent_change, 2),
                            "source": "Money Control"
                        }
                    except (ValueError, TypeError) as e:
                        logger.warning(f"Error parsing numbers for {name}: {e}")
                        continue
        
        return result
    except Exception as e:
        logger.error(f"Error fetching from Money Control: {str(e)}")
        return None

def fetch_investing_com_data():
    """Fetch index data from Investing.com as another fallback"""
    try:
        logger.info("Attempting to fetch index data from Investing.com")
        
        # Map our indices to Investing.com URLs
        index_urls = {
            "Nifty 50": "india-nifty-50",
            "Sensex": "sensex",
            "Nifty Bank": "bank-nifty",
            "S&P 500": "us-spx-500",
            "Dow Jones": "us-30",
            "Nasdaq": "nasdaq-composite",
        }
        
        result = {}
        
        for name, url_suffix in index_urls.items():
            try:
                full_url = f"{INVESTING_URL}{url_suffix}"
                response = safe_request(full_url)
                
                if not response:
                    continue
                    
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Find the main price element
                price_elem = soup.find('span', {'class': 'text-2xl'})
                if not price_elem:
                    continue
                    
                price = float(price_elem.text.strip().replace(',', ''))
                
                # Find change elements
                change_elem = soup.find('span', {'data-test': 'instrument-price-change'})
                percent_elem = soup.find('span', {'data-test': 'instrument-price-change-percent'})
                
                if not change_elem or not percent_elem:
                    continue
                    
                change_text = change_elem.text.strip().replace(',', '')
                percent_text = percent_elem.text.strip().replace('%', '').replace('(', '').replace(')', '').replace(',', '')
                
                change = float(change_text)
                percent_change = float(percent_text)
                
                result[name] = {
                    "name": name,
                    "symbol": INDICES.get(name, ""),
                    "price": round(price, 2),
                    "change": round(change, 2),
                    "percent_change": round(percent_change, 2),
                    "source": "Investing.com"
                }
                
                # Add delay between requests to avoid rate limiting
                time.sleep(random.uniform(1, 2))
                
            except Exception as e:
                logger.warning(f"Error fetching {name} from Investing.com: {e}")
                continue
        
        return result
    except Exception as e:
        logger.error(f"Error fetching from Investing.com: {str(e)}")
        return None

def fetch_market_indices():
    """Fetch market indices data with multiple fallback sources"""
    from app import db
    from app.models import MarketIndex
    
    # Try to get data from different sources
    results = {}
    
    # Define priority indices
    critical_indices = ["Nifty 50", "Sensex", "Nifty Bank"]
    
    # Try each source in sequence with better error handling
    
    # 1. First attempt: yfinance (most comprehensive but sometimes unreliable)
    try:
        logger.info("Attempting to fetch indices using yfinance")
        fetch_using_yfinance(results, db)
        logger.info(f"yfinance fetch completed, got data for {len(results)} indices")
    except Exception as e:
        logger.error(f"Error with yfinance method: {e}")
    
    # Check if we need to try other sources for critical indices
    missing_critical = [idx for idx in critical_indices if idx not in results]
    if missing_critical:
        logger.info(f"Still missing data for critical indices: {missing_critical}")
        
        # 2. Second attempt: NSE API (reliable for Indian indices but needs proper auth)
        try:
            logger.info(f"Attempting to fetch {len(missing_critical)} missing indices using NSE API")
            nse_data = fetch_nse_index_data()
            if nse_data:
                updated_count = 0
                for name, data in nse_data.items():
                    if name in missing_critical:
                        update_results_and_db(results, {name: data}, db)
                        updated_count += 1
                logger.info(f"Successfully fetched {updated_count} indices from NSE API")
                
                # Update missing critical list
                missing_critical = [idx for idx in critical_indices if idx not in results]
        except Exception as e:
            logger.error(f"Error with NSE API method: {e}")
    
    # 3. Third attempt: Money Control (good fallback for Indian indices)
    if missing_critical:
        try:
            logger.info(f"Attempting to fetch {len(missing_critical)} missing indices using Money Control")
            mc_data = fetch_money_control_index_data()
            if mc_data:
                updated_count = 0
                for name, data in mc_data.items():
                    if name in missing_critical:
                        update_results_and_db(results, {name: data}, db)
                        updated_count += 1
                logger.info(f"Successfully fetched {updated_count} indices from Money Control")
                
                # Update missing critical list
                missing_critical = [idx for idx in critical_indices if idx not in results]
        except Exception as e:
            logger.error(f"Error with Money Control method: {e}")
    
    # 4. Fourth attempt: Investing.com (reliable international source)
    if missing_critical:
        try:
            logger.info(f"Attempting to fetch {len(missing_critical)} missing indices using Investing.com")
            inv_data = fetch_investing_com_data()
            if inv_data:
                updated_count = 0
                for name, data in inv_data.items():
                    if name in missing_critical:
                        update_results_and_db(results, {name: data}, db)
                        updated_count += 1
                logger.info(f"Successfully fetched {updated_count} indices from Investing.com")
                
                # Update missing critical list
                missing_critical = [idx for idx in critical_indices if idx not in results]
        except Exception as e:
            logger.error(f"Error with Investing.com method: {e}")
    
    # Final check - create dummy data for any remaining critical indices
    for index_name in missing_critical:
        logger.warning(f"Creating dummy data for {index_name} as all sources failed")
        create_dummy_index(index_name, db)
    
    # Log completion and summary
    logger.info(f"Completed fetching market indices: Got data for {len(results)} indices, including {len(set(critical_indices) & set(results))} critical indices")
    return results

def update_results_and_db(results, new_data, db):
    """Update results dictionary and database with new data"""
    from app.models import MarketIndex
    
    if not new_data:
        return
        
    for name, data in new_data.items():
        # Skip if we already have this index from a better source
        if name in results:
            continue
            
        results[name] = data
        symbol = data.get("symbol", INDICES.get(name, ""))
        
        market_index = MarketIndex.query.filter_by(name=name).first()
        
        if market_index:
            market_index.price = data["price"]
            market_index.change = data["change"]
            market_index.percent_change = data["percent_change"]
            market_index.last_updated = datetime.utcnow()
        else:
            market_index = MarketIndex(
                name=name,
                symbol=symbol,
                price=data["price"],
                change=data["change"],
                percent_change=data["percent_change"],
            )
            db.session.add(market_index)
        
        db.session.commit()

def create_dummy_index(name, db):
    """Create dummy index data when all sources fail"""
    from app.models import MarketIndex
    
    symbol = INDICES.get(name, "")
    
    # Get existing record if available
    market_index = MarketIndex.query.filter_by(name=name).first()
    
    if market_index:
        # If record exists, make minimal changes to avoid disruption
        # Just update the timestamp to show we tried
        market_index.last_updated = datetime.utcnow()
    else:
        # Create new dummy record with placeholder values
        market_index = MarketIndex(
            name=name,
            symbol=symbol,
            price=18000.0 if name == "Nifty 50" else 60000.0,  # Reasonable values
            change=0.0,
            percent_change=0.0,
        )
        db.session.add(market_index)
    
    db.session.commit()
    logger.info(f"Created/updated dummy data for {name}")

def fetch_using_yfinance(results, db):
    """Original yfinance method with better error handling"""
    from app.models import MarketIndex
    
    for name, symbol in INDICES.items():
        try:
            # Add priority to focus on key indices first
            priority = 1 if name in ["Nifty 50", "Sensex"] else 2
            logger.info(f"Fetching data for {name} (Priority: {priority})")
            
            for attempt in range(MAX_RETRIES):
                try:
                    index = yf.Ticker(symbol)
                    data = index.history(period="1d", auto_adjust=True)
                    
                    if data.empty:
                        if attempt < MAX_RETRIES - 1:
                            logger.warning(f"Attempt {attempt+1}: No data found for {name}, retrying...")
                            time.sleep(2)
                            continue
                        else:
                            logger.warning(f"All attempts failed: No data found for {name}")
                            raise ValueError(f"No data for {name}")
                    
                    # Break out of retry loop if successful
                    break
                    
                except Exception as e:
                    if attempt < MAX_RETRIES - 1:
                        logger.warning(f"Attempt {attempt+1} for {name} failed: {e}, retrying...")
                        time.sleep(2)
                    else:
                        logger.error(f"All {MAX_RETRIES} attempts for {name} failed")
                        raise

            # Make sure we have the required columns
            required_columns = ["Open", "Close"]
            if not all(col in data.columns for col in required_columns):
                logger.warning(f"Missing required columns for {name}")
                continue

            price = round(data["Close"].iloc[-1], 2)
            open_price = round(data["Open"].iloc[-1], 2)
            
            # Validate values to ensure they're reasonable
            if price <= 0 or open_price <= 0:
                logger.warning(f"Invalid price data for {name}: price={price}, open={open_price}")
                continue
                
            change = round(price - open_price, 2)
            percent_change = round((change / open_price) * 100, 2)
            
            # Add to results dictionary
            results[name] = {
                "name": name,
                "symbol": symbol,
                "price": price,
                "change": change,
                "percent_change": percent_change,
                "source": "yfinance"
            }

            market_index = MarketIndex.query.filter_by(symbol=symbol).first()

            if market_index:
                market_index.price = price
                market_index.change = change
                market_index.percent_change = percent_change
                market_index.last_updated = datetime.utcnow()
            else:
                market_index = MarketIndex(
                    name=name,
                    symbol=symbol,
                    price=price,
                    change=change,
                    percent_change=percent_change,
                )
                db.session.add(market_index)

            db.session.commit()
            logger.info(f"Updated {name}: {price} ({percent_change}%)")

        except Exception as e:
            logger.error(f"Error fetching {name}: {e}")
            continue

# Only when run as standalone script
if __name__ == "__main__":
    from app import create_app

    app = create_app()
    with app.app_context():
        fetch_market_indices()  # You can run this if needed