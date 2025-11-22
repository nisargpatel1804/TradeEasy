"""
Market Hours Validation Utility for Indian Stock Markets
Handles market timing, holidays, circuit breakers, and session types.
"""

import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# Indian Standard Time timezone
IST = ZoneInfo("Asia/Kolkata")

# Market Sessions (times in IST)
PRE_MARKET_START = time(9, 0, 0)
PRE_MARKET_END = time(9, 15, 0)
REGULAR_MARKET_START = time(9, 15, 0)
REGULAR_MARKET_END = time(15, 30, 0)
POST_MARKET_START = time(15, 40, 0)  # After-market orders (AMO)
POST_MARKET_END = time(23, 59, 59)

# Auto square-off time for MIS orders (5 minutes before market close)
MIS_AUTO_SQUAREOFF_TIME = time(15, 25, 0)

# Market holidays for 2025 (India - NSE/BSE)
# Source: NSE official holiday calendar
MARKET_HOLIDAYS_2025 = [
    "2025-01-26",  # Republic Day
    "2025-03-14",  # Maha Shivratri
    "2025-03-31",  # Eid ul-Fitr
    "2025-04-10",  # Mahavir Jayanti
    "2025-04-14",  # Dr. Baba Saheb Ambedkar Jayanti
    "2025-04-18",  # Good Friday
    "2025-05-01",  # Maharashtra Day
    "2025-06-07",  # Eid ul-Adha (Bakri-Id)
    "2025-07-06",  # Muharram
    "2025-08-15",  # Independence Day
    "2025-08-27",  # Ganesh Chaturthi
    "2025-10-02",  # Mahatma Gandhi Jayanti
    "2025-10-21",  # Dussehra
    "2025-11-01",  # Diwali - Laxmi Pujan
    "2025-11-04",  # Diwali - Balipratipada
    "2025-11-05",  # Guru Nanak Jayanti
    "2025-12-25",  # Christmas
]

# Circuit breaker limits for indices
CIRCUIT_BREAKER_LIMITS = {
    "level_1": 10,   # 10% movement triggers 15-min halt
    "level_2": 15,   # 15% movement triggers 45-min halt
    "level_3": 20,   # 20% movement triggers market closure
}


class MarketSession:
    """Enum-like class for market session types."""
    PRE_MARKET = "PRE_MARKET"
    REGULAR = "REGULAR"
    POST_MARKET = "POST_MARKET"
    CLOSED = "CLOSED"


def get_current_ist_time():
    """Get current time in IST timezone."""
    return datetime.now(IST)


def is_market_holiday(date=None):
    """
    Check if given date is a market holiday.
    
    Args:
        date: datetime object or None (defaults to today)
    
    Returns:
        bool: True if market is closed for holiday
    """
    if date is None:
        date = get_current_ist_time()
    
    # Check if weekend (Saturday=5, Sunday=6)
    if date.weekday() in (5, 6):
        return True
    
    # Check against holiday calendar
    date_str = date.strftime("%Y-%m-%d")
    return date_str in MARKET_HOLIDAYS_2025


def get_market_session(dt=None):
    """
    Determine current market session.
    
    Args:
        dt: datetime object or None (defaults to now)
    
    Returns:
        str: MarketSession constant indicating current session
    """
    if dt is None:
        dt = get_current_ist_time()
    
    # Check if holiday
    if is_market_holiday(dt):
        return MarketSession.CLOSED
    
    current_time = dt.time()
    
    # Pre-market session (9:00 AM - 9:15 AM)
    if PRE_MARKET_START <= current_time < PRE_MARKET_END:
        return MarketSession.PRE_MARKET
    
    # Regular market session (9:15 AM - 3:30 PM)
    elif REGULAR_MARKET_START <= current_time < REGULAR_MARKET_END:
        return MarketSession.REGULAR
    
    # Post-market session (3:40 PM - 11:59 PM for AMO)
    elif POST_MARKET_START <= current_time <= POST_MARKET_END:
        return MarketSession.POST_MARKET
    
    else:
        return MarketSession.CLOSED


def is_market_open_for_trading(product_type='CNC', dt=None):
    """
    Check if market is open for the given product type.
    
    Args:
        product_type: 'CNC' (delivery) or 'MIS' (intraday)
        dt: datetime object or None (defaults to now)
    
    Returns:
        tuple: (is_open: bool, reason: str)
    """
    session = get_market_session(dt)
    
    if session == MarketSession.CLOSED:
        if dt is None:
            dt = get_current_ist_time()
        if is_market_holiday(dt):
            return False, "Market is closed for holiday or weekend"
        return False, "Market is closed"
    
    if session == MarketSession.REGULAR:
        return True, "Market is open"
    
    if session == MarketSession.PRE_MARKET:
        return False, "Pre-market session (orders accepted but not executed)"
    
    if session == MarketSession.POST_MARKET:
        # Only allow AMO (After Market Orders) for CNC
        if product_type == 'CNC':
            return True, "Post-market session (AMO - orders will execute next trading day)"
        else:
            return False, "Intraday (MIS) orders not allowed in post-market session"
    
    return False, "Unknown session"


def should_auto_squareoff_mis(dt=None):
    """
    Check if MIS positions should be auto squared-off.
    
    Args:
        dt: datetime object or None (defaults to now)
    
    Returns:
        bool: True if current time >= MIS auto square-off time
    """
    if dt is None:
        dt = get_current_ist_time()
    
    # Only during regular market hours
    if get_market_session(dt) != MarketSession.REGULAR:
        return False
    
    return dt.time() >= MIS_AUTO_SQUAREOFF_TIME


def get_next_trading_day(date=None):
    """
    Get the next trading day (skips weekends and holidays).
    
    Args:
        date: datetime object or None (defaults to today)
    
    Returns:
        datetime: Next trading day
    """
    if date is None:
        date = get_current_ist_time()
    
    next_day = date + timedelta(days=1)
    
    # Keep incrementing until we find a trading day
    while is_market_holiday(next_day):
        next_day += timedelta(days=1)
        # Safety check to prevent infinite loop
        if (next_day - date).days > 30:
            logger.error("Could not find next trading day within 30 days")
            break
    
    return next_day


def calculate_circuit_breaker_limits(index_value, index_name="NIFTY"):
    """
    Calculate circuit breaker trigger prices for an index.
    
    Args:
        index_value: Current index value
        index_name: Index identifier (for logging)
    
    Returns:
        dict: Dictionary with level_1, level_2, level_3 upper and lower limits
    """
    limits = {}
    for level, pct in CIRCUIT_BREAKER_LIMITS.items():
        upper_limit = index_value * (1 + pct / 100)
        lower_limit = index_value * (1 - pct / 100)
        limits[level] = {
            "upper": round(upper_limit, 2),
            "lower": round(lower_limit, 2),
            "percentage": pct
        }
    
    return limits


def check_circuit_breaker_hit(current_value, previous_close, index_name="NIFTY"):
    """
    Check if circuit breaker should be triggered.
    
    Args:
        current_value: Current index value
        previous_close: Previous day's closing value
        index_name: Index identifier
    
    Returns:
        tuple: (is_hit: bool, level: str or None, action: str)
    """
    if previous_close <= 0:
        return False, None, "No action"
    
    change_pct = abs((current_value - previous_close) / previous_close * 100)
    
    if change_pct >= CIRCUIT_BREAKER_LIMITS["level_3"]:
        return True, "level_3", f"Market closure triggered for {index_name}"
    
    elif change_pct >= CIRCUIT_BREAKER_LIMITS["level_2"]:
        return True, "level_2", f"Trading halted for 45 minutes for {index_name}"
    
    elif change_pct >= CIRCUIT_BREAKER_LIMITS["level_1"]:
        return True, "level_1", f"Trading halted for 15 minutes for {index_name}"
    
    return False, None, "No action"


def validate_order_timing(order_type, product_type='CNC', dt=None):
    """
    Validate if an order can be placed at the current time.
    
    Args:
        order_type: Order type (MARKET, LIMIT, STOP_LOSS, etc.)
        product_type: 'CNC' or 'MIS'
        dt: datetime object or None (defaults to now)
    
    Returns:
        tuple: (is_valid: bool, message: str)
    """
    if dt is None:
        dt = get_current_ist_time()
    
    session = get_market_session(dt)
    
    # Market closed
    if session == MarketSession.CLOSED:
        if is_market_holiday(dt):
            return False, "Trading not allowed on holidays or weekends"
        return False, "Market is closed. Trading hours: 9:15 AM - 3:30 PM IST"
    
    # Pre-market session
    if session == MarketSession.PRE_MARKET:
        # Only limit orders allowed in pre-market
        if order_type in ('MARKET', 'STOP_LOSS', 'STOP_LIMIT', 'TRAILING_STOP'):
            return False, "Only LIMIT orders allowed during pre-market session (9:00-9:15 AM)"
        return True, "Order accepted (will execute when market opens)"
    
    # Regular market hours
    if session == MarketSession.REGULAR:
        # Check if close to MIS square-off time
        if product_type == 'MIS' and should_auto_squareoff_mis(dt):
            return False, "MIS orders not accepted - auto square-off in progress"
        return True, "Order accepted"
    
    # Post-market session
    if session == MarketSession.POST_MARKET:
        if product_type == 'MIS':
            return False, "Intraday (MIS) orders not allowed in post-market session"
        
        # Only limit orders for AMO
        if order_type != 'LIMIT':
            return False, "Only LIMIT orders allowed for After Market Orders (AMO)"
        
        return True, f"AMO accepted (will execute on next trading day: {get_next_trading_day(dt).strftime('%Y-%m-%d')})"
    
    return False, "Unknown session"


# Convenience functions
def is_market_open(dt=None):
    """Quick check if market is in regular trading session."""
    return get_market_session(dt) == MarketSession.REGULAR


def get_market_status_message(dt=None):
    """Get human-readable market status message."""
    if dt is None:
        dt = get_current_ist_time()
    
    session = get_market_session(dt)
    
    if session == MarketSession.REGULAR:
        return f"✅ Market Open - Regular trading (closes at 3:30 PM IST)"
    
    elif session == MarketSession.PRE_MARKET:
        return f"🟡 Pre-Market Session (9:00-9:15 AM) - LIMIT orders only"
    
    elif session == MarketSession.POST_MARKET:
        next_day = get_next_trading_day(dt)
        return f"🌙 Post-Market Session - AMO orders for {next_day.strftime('%Y-%m-%d')}"
    
    else:
        if is_market_holiday(dt):
            next_day = get_next_trading_day(dt)
            return f"🔴 Market Closed - Holiday/Weekend (Next trading day: {next_day.strftime('%Y-%m-%d')})"
        else:
            return f"🔴 Market Closed - Trading hours: 9:15 AM - 3:30 PM IST"
