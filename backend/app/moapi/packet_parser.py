"""High-fidelity binary packet parser for the Motilal Oswal broadcast feed."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from struct import unpack
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


class MOPacketParser:
    """Converts 30-byte MO WebSocket packets into Python dictionaries."""

    RECORD_SIZE = 30
    BASE_EPOCH = datetime(1980, 1, 1)

    MARKET_DEPTH_LEVELS = {
        'B': 1,
        'C': 2,
        'D': 3,
        'E': 4,
        'F': 5,
    }

    EXCHANGE_LOOKUP = {
        'B': 'BSE',
        'G': 'BSEFO',
        'M': 'MCX',
        'D': 'NCDEX',
        'C': 'NSECD',
    }

    @classmethod
    def parse_packet(cls, message: bytes) -> List[Dict[str, object]]:
        if not isinstance(message, (bytes, bytearray)) or len(message) < cls.RECORD_SIZE:
            return []

        packets: List[Dict[str, object]] = []
        for offset in range(0, len(message), cls.RECORD_SIZE):
            chunk = message[offset:offset + cls.RECORD_SIZE]
            if len(chunk) != cls.RECORD_SIZE:
                # Ignore incomplete frames
                continue

            parsed = cls._parse_record(chunk)
            if parsed:
                packets.append(parsed)

        return packets

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    @classmethod
    def _parse_record(cls, chunk: bytes) -> Optional[Dict[str, object]]:
        exchange_code = chr(chunk[0])
        scripcode = int.from_bytes(chunk[1:5], byteorder="little", signed=True)
        raw_time = int.from_bytes(chunk[5:9], byteorder="little", signed=True)
        msg_type = chr(chunk[9])
        payload = chunk[10:]

        exchange = cls._resolve_exchange(exchange_code, scripcode)
        timestamp = cls._format_timestamp(raw_time)

        if msg_type == 'A':
            return cls._parse_ltp(exchange, scripcode, timestamp, payload)
        if msg_type in cls.MARKET_DEPTH_LEVELS:
            return cls._parse_market_depth(exchange, scripcode, timestamp, payload, msg_type)
        if msg_type == 'G':
            return cls._parse_day_ohlc(exchange, scripcode, timestamp, payload)
        if msg_type == 'H':
            return cls._parse_index(exchange, scripcode, timestamp, payload)
        if msg_type == 'W':
            return cls._parse_dpr(exchange, scripcode, timestamp, payload)
        if msg_type == 'm':
            return cls._parse_open_interest(exchange, scripcode, timestamp, payload)
        if msg_type == '1':
            return {
                'packet_type': 'Heartbeat',
                'Exchange': exchange,
                'Scrip Code': scripcode,
                'Time': timestamp,
            }

        logger.debug("Unhandled packet type '%s' for scrip %s", msg_type, scripcode)
        return None

    @classmethod
    def _parse_ltp(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes) -> Dict[str, object]:
        rate = round(unpack('<f', payload[0:4])[0], 2)
        quantity = int.from_bytes(payload[4:8], byteorder='little', signed=True)
        cumulative_qty = int.from_bytes(payload[8:12], byteorder='little', signed=True)
        avg_trade_price = round(unpack('<f', payload[12:16])[0], 2)
        open_interest = int.from_bytes(payload[16:20], byteorder='little', signed=True)

        return {
            'packet_type': 'LTP',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'LTP_Rate': rate,
            'LTP_Qty': quantity,
            'LTP_Cumulative Qty': cumulative_qty,
            'LTP_AvgTradePrice': avg_trade_price,
            'LTP_Open Interest': open_interest,
        }

    @classmethod
    def _parse_market_depth(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes, msg_type: str) -> Dict[str, object]:
        bid_rate = round(unpack('<f', payload[0:4])[0], 2)
        bid_qty = int.from_bytes(payload[4:8], byteorder='little', signed=True)
        bid_orders = int.from_bytes(payload[8:10], byteorder='little', signed=True)
        offer_rate = round(unpack('<f', payload[10:14])[0], 2)
        offer_qty = int.from_bytes(payload[14:18], byteorder='little', signed=True)
        offer_orders = int.from_bytes(payload[18:20], byteorder='little', signed=True)

        return {
            'packet_type': 'MarketDepth',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'BidRate': bid_rate,
            'BidQty': bid_qty,
            'BidOrder': bid_orders,
            'OfferRate': offer_rate,
            'OfferQty': offer_qty,
            'OfferOrder': offer_orders,
            'Level': cls.MARKET_DEPTH_LEVELS.get(msg_type, 0),
        }

    @classmethod
    def _parse_day_ohlc(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes) -> Dict[str, object]:
        open_price = round(unpack('<f', payload[0:4])[0], 2)
        high_price = round(unpack('<f', payload[4:8])[0], 2)
        low_price = round(unpack('<f', payload[8:12])[0], 2)
        prev_close = round(unpack('<f', payload[12:16])[0], 2)

        return {
            'packet_type': 'DayOHLC',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'Open': open_price,
            'High': high_price,
            'Low': low_price,
            'PrevDayClose': prev_close,
        }

    @classmethod
    def _parse_index(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes) -> Dict[str, object]:
        rate = round(unpack('<f', payload[0:4])[0], 2)

        return {
            'packet_type': 'Index',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'Rate': rate,
        }

    @classmethod
    def _parse_dpr(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes) -> Dict[str, object]:
        upper = round(unpack('<f', payload[0:4])[0], 2)
        lower = round(unpack('<f', payload[4:8])[0], 2)

        return {
            'packet_type': 'DPR',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'UpperCktLimit': upper,
            'LowerCktLimit': lower,
        }

    @classmethod
    def _parse_open_interest(cls, exchange: str, scripcode: int, timestamp: str, payload: bytes) -> Dict[str, object]:
        value = int.from_bytes(payload[0:4], byteorder='little', signed=True)
        high = int.from_bytes(payload[4:8], byteorder='little', signed=True)
        low = int.from_bytes(payload[8:12], byteorder='little', signed=True)

        return {
            'packet_type': 'OpenInterest',
            'Exchange': exchange,
            'Scrip Code': scripcode,
            'Time': timestamp,
            'Open Interest': value,
            'Open Interest High': high,
            'Open Interest Low': low,
        }

    @classmethod
    def _format_timestamp(cls, seconds_since_base: int) -> str:
        try:
            return (cls.BASE_EPOCH + timedelta(seconds=seconds_since_base)).isoformat(sep=' ')
        except Exception:
            return ''

    @classmethod
    def _resolve_exchange(cls, exchange_code: str, scripcode: int) -> str:
        if exchange_code == 'N':
            if scripcode <= 34999 or 888801 <= scripcode <= 888820:
                return 'NSE'
            return 'NSEFO'
        return cls.EXCHANGE_LOOKUP.get(exchange_code, exchange_code)
