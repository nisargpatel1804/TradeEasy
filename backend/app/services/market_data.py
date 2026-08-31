"""Shared configuration and lookup utilities for market index tracking."""

from typing import Dict, List, Optional

MO_INDEX_CATALOG: Dict[str, List[Dict[str, str]]] = {
    "NSE": [
        {"code": "26009", "name": "Nifty Bank"},
        {"code": "26012", "name": "Nifty 100"},
        {"code": "26065", "name": "Nifty 200"},
        {"code": "26003", "name": "Nifty 500"},
        {"code": "26061", "name": "Nifty Auto"},
        {"code": "26066", "name": "Nifty Commodities"},
        {"code": "26067", "name": "Nifty Consumption"},
        {"code": "26054", "name": "Nifty Energy"},
        {"code": "26037", "name": "NIFTY FIN SERVICE"},
        {"code": "26055", "name": "Nifty FMCG"},
        {"code": "26019", "name": "Nifty Infra"},
        {"code": "26008", "name": "Nifty IT"},
        {"code": "26063", "name": "Nifty Media"},
        {"code": "26062", "name": "Nifty Metal"},
        {"code": "26010", "name": "Nifty MIDCAP 100"},
        {"code": "26000", "name": "Nifty 50"},
        {"code": "26013", "name": "Nifty Next 50"},
        {"code": "26057", "name": "Nifty Pharma"},
        {"code": "26024", "name": "Nifty PSE"},
        {"code": "26059", "name": "Nifty PSU Bank"},
        {"code": "26052", "name": "Nifty Realty"},
        {"code": "26064", "name": "Nifty SMLCAP 100"},
        {"code": "26051", "name": "India VIX"},
        {"code": "26014", "name": "Nifty Midcap 50"},
        {"code": "26074", "name": "Nifty MID SELECT"},
    ],
    "BSE": [
        {"code": "999901", "name": "SENSEX"},
        {"code": "999907", "name": "BSE CAPGOOD"},
        {"code": "999908", "name": "BSE CONSDUR"},
        {"code": "999923", "name": "BSE IPO"},
        {"code": "999936", "name": "ALLCAP"},
        {"code": "999915", "name": "BSE OIL&GAS"},
        {"code": "999922", "name": "BSE POWER"},
        {"code": "999911", "name": "BSE TECK"},
        {"code": "999941", "name": "INDSTR"},
        {"code": "999945", "name": "TELCOM"},
        {"code": "999946", "name": "UTILS"},
        {"code": "999974", "name": "BSE Capital Markets & Insurance"},
        {"code": "999990", "name": "BSE INDIA 150"},
        {"code": "999996", "name": "BSE INDIA DEFENCE"},
    ],
}

def get_index_by_code(exchange: str, code: str) -> Optional[Dict[str, str]]:
    """
    Retrieve index details (code and name) by its exchange and numerical code.
    """
    if not exchange or not code:
        return None
    
    indices = MO_INDEX_CATALOG.get(exchange.upper(), [])
    code_str = str(code).strip()
    
    for index in indices:
        if index.get("code") == code_str:
            return index
            
    return None

def get_all_index_codes(exchange: str) -> List[str]:
    """
    Retrieve a list of all index codes for a given exchange.
    """
    if not exchange:
        return []
        
    indices = MO_INDEX_CATALOG.get(exchange.upper(), [])
    return [index["code"] for index in indices if "code" in index]

def is_valid_index_code(exchange: str, code: str) -> bool:
    """
    Check if a given code is a valid index code for the specified exchange.
    """
    return get_index_by_code(exchange, code) is not None