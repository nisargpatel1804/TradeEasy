import yfinance as yf
from flask import Blueprint, jsonify, request
from functools import lru_cache
import logging
import requests
from bs4 import BeautifulSoup
import time
import random
from urllib.parse import quote
import re
from fake_useragent import UserAgent
from app.utils.scraper import get_stock_price, fetch_historical_chart

stock_bp = Blueprint('stock', __name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Anti-ban configuration
MIN_DELAY = 2  # Minimum delay between requests in seconds
MAX_DELAY = 5  # Maximum delay between requests in seconds
MAX_RETRIES = 3  # Maximum number of retries for failed requests
ua = UserAgent()

def random_delay():
    """Add random delay between requests to avoid rate limiting"""
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

def format_symbol(symbol):
    symbol = symbol.strip().upper()
    if symbol.endswith('.NSE') or symbol.endswith('.BSE'):
        symbol = symbol.rsplit('.', 1)[0]
    return symbol



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

def fetch_stock_data(symbol):
    for suffix in [".NS", ".BO"]:
        stock = yf.Ticker(f"{symbol}{suffix}")
        try:
            if stock.info.get("regularMarketPrice") is not None:
                return stock
        except Exception as e:
            logger.warning(f"Failed to fetch {symbol}{suffix}: {str(e)}")
            continue
    logger.error(f"No data found for {symbol} (tried .NS and .BO)")
    return None

@lru_cache(maxsize=128)
def get_stock_data(symbol):
    formatted = format_symbol(symbol)
    stock = fetch_stock_data(formatted)
    if stock is None:
        raise ValueError(f"No data found for {formatted}")
    return stock

def safe_get(data, key, fallback="00"):
    value = data.get(key)
    return value if value not in [None, ""] else fallback

def calculate_ratios(stock):
    try:
        financials = stock.financials
        bs = stock.balance_sheet

        net_income = financials.loc["Net Income"] if "Net Income" in financials.index else None
        revenue = financials.loc["Total Revenue"] if "Total Revenue" in financials.index else None
        equity = bs.loc["Total Stockholder Equity"] if "Total Stockholder Equity" in bs.index else None
        assets = bs.loc["Total Assets"] if "Total Assets" in bs.index else None
        liabilities = bs.loc["Total Liabilities"] if "Total Liabilities" in bs.index else None
        ebit = financials.loc["EBIT"] if "EBIT" in financials.index else None
        interest = financials.loc["Interest Expense"] if "Interest Expense" in financials.index else None

        roe = ((net_income.iloc[0] / equity.iloc[0]) * 100) if all([net_income is not None, equity is not None, equity.iloc[0] != 0]) else 0
        roce = ((net_income.iloc[0] / (assets.iloc[0] - liabilities.iloc[0])) * 100) if all([net_income, assets, liabilities, (assets.iloc[0] - liabilities.iloc[0]) != 0]) else 0
        sales_growth = ((revenue.iloc[0] - revenue.iloc[1]) / abs(revenue.iloc[1]) * 100) if revenue is not None and len(revenue) >= 2 else 0
        profit_growth = ((net_income.iloc[0] - net_income.iloc[1]) / abs(net_income.iloc[1]) * 100) if net_income is not None and len(net_income) >= 2 else 0
        debt_equity = (liabilities.iloc[0] / equity.iloc[0]) if liabilities is not None and equity is not None and equity.iloc[0] != 0 else 0
        interest_coverage = (ebit.iloc[0] / interest.iloc[0]) if ebit is not None and interest is not None and interest.iloc[0] != 0 else 0

        return {
            "roe": round(roe, 2),
            "roce": round(roce, 2),
            "sales_growth_1y": round(sales_growth, 2),
            "profit_growth_1y": round(profit_growth, 2),
            "debt_to_equity": round(debt_equity, 2),
            "interest_coverage": round(interest_coverage, 2),
        }
    except Exception as e:
        logger.error(f"Failed to calculate ratios: {e}")
        return {
            "roe": 0,
            "roce": 0,
            "sales_growth_1y": 0,
            "profit_growth_1y": 0,
            "debt_to_equity": 0,
            "interest_coverage": 0,
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

def scrape_table(symbol, section_id):
    url = f"https://www.screener.in/company/{quote(symbol.upper())}/consolidated/"
    try:
        resp = safe_request(url)
        if not resp:
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        section = soup.find("section", id=section_id)
        if not section:
            return []

        # ✅ Fix: Only grab the *visible* data-result-table
        table_container = section.find("div", {"data-result-table": True})
        if not table_container:
            return []

        table = table_container.find("table")
        if not table:
            return []

        headers = [th.get_text(strip=True) for th in table.find("thead").find_all("th")[1:]]

        rows = []
        for tr in table.find("tbody").find_all("tr"):
            cols = tr.find_all("td")
            if not cols:
                continue

            label = tr.find("td", class_="text").get_text(strip=True)
            values = []
            for td in cols[1:]:
                raw = td.get_text(strip=True).replace(",", "").replace("%", "")
                try:
                    val = float(raw)
                except:
                    val = raw or None
                values.append(val)

            rows.append({"item": label, "years": headers, "values": values})

        return rows

    except Exception as e:
        logger.error(f"Failed to scrape '{section_id}' for {symbol}: {e}")
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

def scrape_peers(symbol):
    """Scrape peer comparison data from Screener.in"""
    url = f"https://www.screener.in/company/{quote(symbol.upper())}/consolidated/"
    try:
        resp = safe_request(url)
        if not resp:
            return {"peers": [], "sectors": [], "indices": []}

        soup = BeautifulSoup(resp.text, "html.parser")
        peers_section = soup.find("section", id="peers")
        if not peers_section:
            return {"peers": [], "sectors": [], "indices": []}

        # Extract sectors and indices
        sectors = []
        indices = []
        
        sectors_div = peers_section.find("div", string=re.compile("Peer comparison"))
        if sectors_div:
            sectors = [a.get_text(strip=True) for a in sectors_div.find_all("a")]
        
        indices_div = peers_section.find("div", string=re.compile("Part of"))
        if indices_div:
            indices = [a.get_text(strip=True) for a in indices_div.find_all("a")]

        # Extract peer table data
        table = peers_section.find("table")
        if not table:
            return {"peers": [], "sectors": sectors, "indices": indices}

        headers = [th.get_text(strip=True) for th in table.find_all("th")]
        peers = []
        
        for tr in table.find_all("tr")[1:]:
            cols = [td.get_text(strip=True).replace(",", "") for td in tr.find_all("td")]
            if not cols:
                continue
            peer_data = {}
            for i, header in enumerate(headers):
                if i < len(cols):
                    peer_data[header.lower().replace(" ", "_").replace(".", "").replace("%", "percent")] = cols[i]
            peers.append(peer_data)

        return {
            "peers": peers,
            "sectors": sectors,
            "indices": indices
        }
    except Exception as e:
        logger.error(f"Failed to scrape peers for {symbol}: {e}")
        return {"peers": [], "sectors": [], "indices": []}

def scrape_shareholding(symbol):
    """Scrape shareholding pattern from Screener.in"""
    url = f"https://www.screener.in/company/{quote(symbol.upper())}/consolidated/"
    try:
        resp = safe_request(url)
        if not resp:
            return {"quarters": [], "holders": []}

        soup = BeautifulSoup(resp.text, "html.parser")
        shareholding_section = soup.find("section", id="shareholding")
        if not shareholding_section:
            return {"quarters": [], "holders": []}

        # Extract quarters/years
        quarters = []
        time_span_div = shareholding_section.find("div", class_="show")
        if time_span_div:
            quarters = [a.get_text(strip=True) for a in time_span_div.find_all("a")]

        # Extract shareholding data
        table = shareholding_section.find("table")
        if not table:
            return {"quarters": quarters, "holders": []}

        headers = [th.get_text(strip=True) for th in table.find_all("th")[1:]]
        holders = []
        
        for tr in table.find_all("tr")[1:]:
            cols = [td.get_text(strip=True).replace("%", "") for td in tr.find_all("td")]
            if not cols:
                continue
            holder = {
                "name": cols[0],
                "holdings": [{"quarter": headers[i], "percentage": float(val) if val.replace(".", "").isdigit() else 0} 
                            for i, val in enumerate(cols[1:])]
            }
            holders.append(holder)

        return {
            "quarters": quarters,
            "holders": holders
        }
    except Exception as e:
        logger.error(f"Failed to scrape shareholding for {symbol}: {e}")
        return {"quarters": [], "holders": []}

def scrape_balance_sheet(symbol):
    return scrape_table(symbol, "balance-sheet")

def scrape_profit_loss(symbol):
    return scrape_table(symbol, "profit-loss")

def scrape_quarters(symbol):
    return scrape_table(symbol, "quarters")

def scrape_cash_flow(symbol):
    return scrape_table(symbol, "cash-flow")

def scrape_ratios(symbol):
    return scrape_table(symbol, "ratios")

@stock_bp.route("/stock/overview/<symbol>", methods=["GET"])
def get_stock_overview(symbol):
    """
    Get stock overview and key metrics for a given symbol.
    """
    try:
        # Basic price data
        stock_price = get_stock_price(symbol)
        
        # Detailed data
        stock = get_stock_data(symbol)
        ratios = calculate_ratios(stock)
        
        # Chart data for the past year
        chart_data = fetch_historical_chart(stock, period="1y")
        
        # Combine all data
        result = {
            "price_data": stock_price,
            "ratios": ratios,
            "chart_data": chart_data
        }
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error fetching stock overview for {symbol}: {str(e)}")
        return jsonify({"error": f"Failed to fetch stock data: {str(e)}"}), 500

@stock_bp.route("/stocks/batch", methods=["GET"])
def batch_stock_data():
    """
    Batch API disabled – previously fetched 80+ index constituents.
    Now returns an empty dataset to avoid unnecessary load.
    """
    logger.info("/stocks/batch endpoint disabled – returning empty response")
    return jsonify({"data": {}, "message": "Batch stock fetching disabled"})