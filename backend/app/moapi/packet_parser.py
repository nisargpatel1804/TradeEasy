"""
Binary Packet Parser for Motilal Oswal WebSocket Feed
Updated to be fully compliant with the official MO Python SDK packet structures.
"""
import logging
from struct import unpack
from datetime import datetime

logger = logging.getLogger(__name__)

class MOPacketParser:
    """
    A robust parser for binary packets from the MO WebSocket broadcast feed.
    This class correctly interprets various packet types like LTP, DayOHLC, and Index.
    """

    @staticmethod
    def parse_packet(message):
        """
        Main entry point to parse incoming binary packets. It identifies the packet
        type and routes it to the appropriate specialized parsing method.

        Returns:
            dict: Parsed data as a dictionary, or None if parsing fails.
        """
        if not isinstance(message, bytes) or len(message) < 1:
            return None
        
        try:
            msg_type = chr(message[0])
            parsers = {
                'L': MOPacketParser._parse_ltp,
                'O': MOPacketParser._parse_day_ohlc,
                'M': MOPacketParser._parse_market_depth,
                'I': MOPacketParser._parse_index,
                'D': MOPacketParser._parse_dpr,
                'P': MOPacketParser._parse_open_interest,
                'H': lambda m: {'packet_type': 'Heartbeat'}, # Simple heartbeat ack
            }
            parser = parsers.get(msg_type)
            if parser:
                return parser(message)
            else:
                logger.debug(f"Unknown packet type received: {msg_type}")
                return None
        except Exception as e:
            logger.error(f"Fatal error parsing packet: {e}", exc_info=True)
            return None

    @staticmethod
    def _parse_ltp(message):
        """
        Parses an LTP (Last Traded Price) packet.
        - Unpacks binary data for price, quantity, and volume.
        - Converts financial values from paisa to rupees.
        """
        try:
            # Struct format: 1 char, 1 short, 1 char, 5 ints
            # c(type), H(len), c(exch), I(scrip), I(ltp), I(qty), I(cum_qty), I(avg_price)
            if len(message) < 24:
                return None

            s = unpack("=cHBcIIII", message[:24])
            exchange_map = {b'N': 'NSE', b'B': 'BSE', b'M': 'MCX', b'C': 'NSECD', b'D': 'NCDEX'}

            ltp_data = {
                'packet_type': 'LTP',
                'Exchange': exchange_map.get(s[2], 'UNKNOWN'),
                'Scrip Code': s[3],
                'LTP_Rate': s[4] / 100.0,
                'LTP_Qty': s[5],
                'LTP_Cumulative Qty': s[6],
                'LTP_AvgTradePrice': s[7] / 100.0,
                'timestamp': datetime.now().isoformat()
            }
            # Derivatives packets include Open Interest
            if len(message) >= 28:
                ltp_data['OpenInterest'] = unpack("=I", message[24:28])[0]

            logger.debug(f"Parsed LTP: {ltp_data}")
            return ltp_data
        except Exception as e:
            logger.error(f"Error parsing LTP packet: {e}", exc_info=True)
            return None

    @staticmethod
    def _parse_day_ohlc(message):
        """
        Parses a DayOHLC packet.
        - Unpacks binary data for Open, High, Low, Close, and Previous Close.
        - Converts financial values from paisa to rupees.
        """
        try:
            # c(type), H(len), c(exch), I(scrip), I(open), I(high), I(low), I(close), I(prev_close)
            if len(message) < 28:
                return None

            s = unpack("=cHBcIIIII", message[:28])
            exchange_map = {b'N': 'NSE', b'B': 'BSE', b'M': 'MCX', b'C': 'NSECD', b'D': 'NCDEX'}
            
            ohlc_data = {
                'packet_type': 'DayOHLC',
                'Exchange': exchange_map.get(s[2], 'UNKNOWN'),
                'Scrip Code': s[3],
                'Open': s[4] / 100.0,
                'High': s[5] / 100.0,
                'Low': s[6] / 100.0,
                'Close': s[7] / 100.0,
                'PrevDayClose': s[8] / 100.0,
                'timestamp': datetime.now().isoformat()
            }
            logger.debug(f"Parsed DayOHLC: {ohlc_data}")
            return ohlc_data
        except Exception as e:
            logger.error(f"Error parsing DayOHLC packet: {e}", exc_info=True)
            return None

    @staticmethod
    def _parse_index(message):
        """
        Parses an Index broadcast packet.
        - Unpacks index scrip code and value.
        - Correctly scales the index value (typically sent as value * 100).
        """
        try:
            # c(type), H(len), c(exch), I(scrip_code), I(index_value)
            if len(message) < 12:
                return None

            s = unpack("=cHBcI", message[:8])
            index_val = unpack("=i", message[8:12])[0] # Index can be signed
            exchange_map = {b'N': 'NSE', b'B': 'BSE'}

            index_data = {
                'packet_type': 'Index',
                'Exchange': exchange_map.get(s[2], 'UNKNOWN'),
                'Scrip Code': s[3],
                'Rate': index_val / 100.0,
                'timestamp': datetime.now().isoformat()
            }
            logger.debug(f"Parsed Index: {index_data}")
            return index_data
        except Exception as e:
            logger.error(f"Error parsing Index packet: {e}", exc_info=True)
            return None

    @staticmethod
    def _parse_market_depth(message):
        """Placeholder for parsing Market Depth packets."""
        logger.debug(f"MarketDepth packet received (parsing not implemented): {message.hex()}")
        # Implementation would involve iterating through bid/ask levels
        return {'packet_type': 'MarketDepth', 'data': 'not_implemented'}

    @staticmethod
    def _parse_dpr(message):
        """Placeholder for parsing DPR (Daily Price Range) packets."""
        logger.debug(f"DPR packet received (parsing not implemented): {message.hex()}")
        return {'packet_type': 'DPR', 'data': 'not_implemented'}

    @staticmethod
    def _parse_open_interest(message):
        """Placeholder for parsing standalone Open Interest packets."""
        logger.debug(f"OpenInterest packet received (parsing not implemented): {message.hex()}")
        return {'packet_type': 'OpenInterest', 'data': 'not_implemented'}
