"""Shared configuration and helpers for major market index tracking."""

from typing import Any, Dict, List, Optional

MAJOR_INDEX_TARGETS: Dict[str, List[Dict[str, Any]]] = {
    "NSE": [
        {
            "id": "nifty50",
            "display": "Nifty 50",
            "codes": ["26000"],
            "terms": ["NIFTY 50", "NIFTY50"],
        },
        {
            "id": "india_vix",
            "display": "India VIX",
            "codes": [],
            "terms": ["INDIA VIX", "VIX"],
            "min_value": 5.0,
            "max_value": 100.0,
        },
    ],
    "BSE": [
        {
            "id": "sensex",
            "display": "S&P BSE Sensex",
            "codes": ["999901"],
            "terms": ["SENSEX", "BSE SENSEX"],
        },
    ],
}


def resolve_index_entry(master_list: List[Dict[str, Any]], target_config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Finds the index entry whose code or name matches the requested target."""
    if not target_config:
        return None

    preferred_codes = {str(code) for code in target_config.get("codes", []) if code}
    lowered_terms = [term.lower() for term in target_config.get("terms", []) if term]

    for entry in master_list:
        code = str(entry.get("indexcode"))
        if code and code in preferred_codes:
            return entry

    for entry in master_list:
        name = (entry.get("indexname") or "").lower()
        if any(term in name for term in lowered_terms):
            return entry

    return None
