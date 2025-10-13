import os
import requests
import hashlib
import logging
import websocket
import threading
import pyotp
from struct import pack
from datetime import datetime, time as dt_time
from dotenv import load_dotenv
from zoneinfo import ZoneInfo

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MarketHoursManager:
    """Manages Indian market hours detection and holiday checking."""

    def __init__(self):
        self.ist_tz = ZoneInfo('Asia/Kolkata')
        self.market_open = dt_time(9, 15)
        self.market_close = dt_time(15, 30)
        # Market holidays for 2025 (expand as needed)
        self.holidays = {
            '2025-01-26', '2025-03-14', '2025-04-14', '2025-05-01',
            '2025-08-15', '2025-10-02', '2025-11-01', '2025-11-15', '2025-12-25',
        }

    def is_market_open(self):
        """Checks if the Indian stock market is currently open."""
        now_ist = datetime.now(self.ist_tz)
        current_date_str = now_ist.date().isoformat()
        if current_date_str in self.holidays or now_ist.weekday() >= 5:
            return False
        return self.market_open <= now_ist.time() <= self.market_close

class MotilalOswalAPI:
    """
    A Python wrapper for the Motilal Oswal OpenAPI, updated with correct WebSocket
    binary packet structures based on the official SDK.
    """
    def __init__(self, use_test_url=False):
        load_dotenv()
        self.user_id = os.getenv("USER_ID")
        self.password = os.getenv("PASSWORD")
        self.api_key = os.getenv("API_KEY")
        self.two_fa = os.getenv("TWO_FA")
        self.totp_secret = os.getenv("TOTP_SECRET")

        if not all([self.user_id, self.password, self.api_key, self.two_fa, self.totp_secret]):
            raise ValueError("Ensure USER_ID, PASSWORD, API_KEY, TWO_FA, and TOTP_SECRET are set in .env file.")

        self.base_url = "https://openapi.motilaloswal.com/rest" if not use_test_url else "https://openapi.motilaloswaluat.com/rest"
        self.websocket_url = "wss://ws1feed.motilaloswal.com/jwebsocket/jwebsocket"
        
        self.auth_token = None
        self.session = requests.Session()
        self.ws = None
        self.ws_thread = None
        self.market_hours = MarketHoursManager()
        self.websocket_version = "3.0"
        self.registered_scrips = []
        self.endpoints = {
            "ltp": os.getenv("MO_API_LTP_ENDPOINT", "/market/v1/getltp"),
            "index_master": os.getenv("MO_API_INDEX_MASTER_ENDPOINT", "/market/v1/getindexdata"),
            "bulk_eod": os.getenv("MO_API_BULK_EOD_ENDPOINT", "/market/v1/getbulkeoddata"),
        }
        self._update_headers()

    def _update_headers(self, auth_token=None):
        """Constructs and updates session headers for REST API calls."""
        self.headers = {
            'Accept': 'application/json', 'User-Agent': 'MOSL/V.1.1.0',
            'ApiKey': self.api_key, 'ClientLocalIp': '192.168.1.1',
            'ClientPublicIp': '10.10.10.10', 'MacAddress': '00-00-00-00-00-00',
            'SourceId': 'WEB', 'vendorinfo': self.user_id,
            'osname': 'Windows 11', 'productname': 'TradeEasy', 'productversion': '1.0.0',
        }
        if auth_token:
            self.headers['Authorization'] = auth_token
        self.session.headers.update(self.headers)

    def _ensure_authenticated(self) -> bool:
        """Ensures the session has a valid auth token before making API calls."""
        if self.auth_token:
            return True
        if self.login():
            return True
        logger.error("MO API authentication failed. Ensure credentials are correct.")
        return False

    def _make_request(self, method, endpoint, payload=None):
        """Generic method to make REST API requests."""
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.request(method, url, json=payload or {})
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as req_err:
            logger.error(f"Request error for {url}: {req_err}")
            return None

    def login(self):
        """Authenticates the user and retrieves an authorization token."""
        endpoint = "/login/v3/authdirectapi"
        hashed_password = hashlib.sha256((self.password + self.api_key).encode('utf-8')).hexdigest()
        totp = pyotp.TOTP(self.totp_secret).now()
        payload = {"userid": self.user_id, "password": hashed_password, "2FA": self.two_fa, "totp": str(totp)}
        
        response = self._make_request("POST", endpoint, payload)
        if response and response.get("status") == "SUCCESS":
            self.auth_token = response.get("AuthToken")
            self._update_headers(self.auth_token)
            logger.info("✔️ MO API Login successful.")
            return True
        else:
            error_msg = response.get("message", "Unknown error") if response else "No response"
            logger.error(f"Login failed: {error_msg}")
            self.auth_token = None
            return False

    def get_scrips_by_exchange(self, exchangename: str):
        """Fetches the scrip/instrument master for a given exchange name."""
        if not self._ensure_authenticated():
            return None
        endpoint = "/report/v1/getscripsbyexchangename"
        return self._make_request("POST", endpoint, {"exchangename": exchangename})

    def get_ltp_data(self, exchange: str, scripcode: int):
        """Fetches live quote data (LTP) for a specific scrip."""
        if not self._ensure_authenticated():
            return None

        payload = {
            "exchange": str(exchange).upper(),
            "scripcode": int(scripcode)
        }
        response = self._make_request("POST", self.endpoints["ltp"], payload)
        if not response:
            logger.warning(f"LTP data request failed for {exchange}:{scripcode}")
        return response

    def get_index_data(self, exchange: str):
        """Retrieves index master information for the given exchange."""
        if not self._ensure_authenticated():
            return None

        payload = {"exchangename": str(exchange).upper()}
        response = self._make_request("POST", self.endpoints["index_master"], payload)
        if not response:
            logger.warning(f"Index data request failed for exchange {exchange}")
        return response

    def get_bulk_eod_data(self, exchange: str):
        """Fetches bulk end-of-day price data for the given exchange."""
        if not self._ensure_authenticated():
            return None

        payload = {"exchangename": str(exchange).upper()}
        response = self._make_request("POST", self.endpoints["bulk_eod"], payload)
        if not response:
            logger.warning(f"Bulk EOD data request failed for exchange {exchange}")
        return response

    # --- WebSocket Methods ---
    def connect_websocket(self, on_message, on_open, on_close, on_error):
        """Establishes a WebSocket connection in a background thread."""
        if not self.auth_token:
            logger.error("Cannot connect to WebSocket without authentication.")
            return
            
        self.ws = websocket.WebSocketApp(
            self.websocket_url,
            on_open=on_open, on_message=on_message,
            on_error=on_error, on_close=on_close
        )
        self.ws_thread = threading.Thread(target=lambda: self.ws.run_forever(ping_interval=30, ping_timeout=10))
        self.ws_thread.daemon = True
        self.ws_thread.start()
        logger.info(f"WebSocket connection thread started to {self.websocket_url}")

    def disconnect_websocket(self):
        """Closes the WebSocket connection."""
        if self.ws:
            self.ws.close()
            logger.info("WebSocket connection closed.")
        self.ws = None
        if self.ws_thread: self.ws_thread.join()

    def send_binary_login(self):
        """Sends a correctly structured binary login packet."""
        try:
            if not self.ws or not self.ws.sock or not self.ws.sock.connected:
                logger.warning("WS not connected. Skipping login packet.")
                return False

            clientcode = self.user_id
            version = self.websocket_version
            
            # Pad strings with null bytes to exact lengths
            clientcode_b1 = clientcode.ljust(15, "\x00").encode('utf-8')
            clientcode_b2 = clientcode.ljust(30, "\x00").encode('utf-8')
            version_b = version.ljust(10, "\x00").encode('utf-8')
            padding = ("\x00" * 45).encode('utf-8')
            
            login_packet = pack(
                "=cHB15sB30sBBBB10sBBBBB45s",
                b"Q", 111, len(clientcode), clientcode_b1,
                len(clientcode), clientcode_b2,
                1, 1, 1, len(version), version_b,
                0, 0, 0, 0, 1, padding
            )
            self.ws.send(login_packet, opcode=websocket.ABNF.OPCODE_BINARY)
            logger.info("✔️ Binary login packet sent to MO WebSocket")
            return True
        except Exception as e:
            logger.error(f"Failed to send binary login packet: {e}")
            return False

    def _send_subscription_packet(self, exchange: str, scripcode: int, subscribe: bool):
        """Helper to send scrip subscription/unsubscription packets."""
        scrip_key = f"{exchange}:{scripcode}"
        if subscribe and scrip_key in self.registered_scrips:
            logger.debug(f"Scrip {scrip_key} already registered.")
            return True
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            logger.warning(f"WS not connected. Cannot modify subscription for {scrip_key}")
            return False

        exchange_map = {"NSE": "N", "BSE": "B", "NSEFO": "N", "MCX": "M", "NSECD": "C", "NCDEX": "D"}
        exchange_char = exchange_map.get(exchange.upper(), "N")
        
        # Payload is always 7 bytes: 1(char) + 1(char) + 4(int) + 1(byte)
        packet = pack("=cHcciB", b"D", 7, exchange_char.encode(), b"C", int(scripcode), 1 if subscribe else 0)
        self.ws.send(packet, opcode=websocket.ABNF.OPCODE_BINARY)
        
        if subscribe:
            self.registered_scrips.append(scrip_key)
            logger.info(f"✔️ Registered scrip {scrip_key}")
        else:
            if scrip_key in self.registered_scrips: self.registered_scrips.remove(scrip_key)
            logger.info(f"✔️ Unregistered scrip {scrip_key}")
        return True

    def register_scrip(self, exchange: str, scripcode: int):
        """Subscribes to a scrip using a correctly formatted binary packet."""
        return self._send_subscription_packet(exchange, scripcode, subscribe=True)

    def unregister_scrip(self, exchange: str, scripcode: int):
        """Unsubscribes from a scrip using a correctly formatted binary packet."""
        return self._send_subscription_packet(exchange, scripcode, subscribe=False)

    def _send_index_packet(self, exchange: str, subscribe: bool):
        """Helper to send index subscription/unsubscription packets."""
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            logger.warning(f"WS not connected. Cannot modify index subscription for {exchange}")
            return False
        
        exchange_map = {"NSE": "N", "BSE": "B"}
        exchange_char = exchange_map.get(exchange.upper(), "N")
        
        # Payload is 2 bytes: 1(char) + 1(byte)
        packet = pack("=cHcB", b"I", 2, exchange_char.encode(), 1 if subscribe else 0)
        self.ws.send(packet, opcode=websocket.ABNF.OPCODE_BINARY)
        
        action = "Registered" if subscribe else "Unregistered"
        logger.info(f"✔️ {action} ALL indices for {exchange}")
        return True

    def register_index(self, exchange: str):
        """Subscribes to all index feeds for an exchange."""
        return self._send_index_packet(exchange, subscribe=True)

    def unregister_index(self, exchange: str):
        """Unsubscribes from all index feeds for an exchange."""
        return self._send_index_packet(exchange, subscribe=False)

    def send_heartbeat(self):
        """Sends a correctly structured heartbeat packet to keep the connection alive."""
        try:
            if not self.ws or not self.ws.sock or not self.ws.sock.connected:
                logger.debug("WS not connected, skipping heartbeat.")
                return False
            
            # Heartbeat packet has a payload length of 0
            heartbeat_packet = pack("=cH", b"H", 0)
            self.ws.send(heartbeat_packet, opcode=websocket.ABNF.OPCODE_BINARY)
            logger.debug("✔️ Sent heartbeat packet")
            return True
        except Exception as e:
            logger.error(f"Failed to send heartbeat: {e}")
            return False
