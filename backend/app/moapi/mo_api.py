import os
import requests
import hashlib
import json
import logging
import websocket
import threading
import time
from datetime import datetime, time as dt_time, timedelta
from dotenv import load_dotenv
import pyotp
import pytz

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MarketHoursManager:
    """Manages Indian market hours detection and holiday checking."""
    
    def __init__(self):
        self.ist_tz = pytz.timezone('Asia/Kolkata')
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
    A Python wrapper for the Motilal Oswal OpenAPI, optimized for performance.
    Handles authentication, REST API calls, and WebSocket connections.
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
        self.websocket_url = "wss://openapi.motilaloswal.com/ws" if not use_test_url else "wss://openapi.motilaloswaluat.com/websocket"
        
        self.auth_token = None
        self.session = requests.Session()
        self.ws = None
        self.ws_thread = None
        self.market_hours = MarketHoursManager()
        self._update_headers()

    def _update_headers(self, auth_token=None):
        """Constructs and updates session headers."""
        self.headers = {
            'Accept': 'application/json', 'User-Agent': 'MOSL/V.1.1.0', 'ApiKey': self.api_key,
            'ClientLocalIp': '1.2.3.4', 'ClientPublicIp': '1.2.3.4', 'MacAddress': '00:00:00:00:00:00',
            'SourceId': 'WEB', 'vendorinfo': self.user_id, 'osname': 'Windows 11', 'osversion': '10.0.22000',
            'devicemodel': 'Desktop', 'manufacturer': 'Generic', 'productname': 'TradeEasy', 'productversion': '1.0.0',
            'installedappid': 'TradeEasyApp', 'browsername': 'Chrome', 'browserversion': '119.0.0.0'
        }
        if auth_token:
            self.headers['Authorization'] = auth_token
        self.session.headers.update(self.headers)

    def _make_request(self, method, endpoint, payload=None):
        """Generic method to make REST API requests."""
        url = f"{self.base_url}{endpoint}"
        try:
            response = self.session.request(method, url, json=payload or {})
            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as http_err:
            logger.error(f"HTTP error for {url}: {http_err} - {response.text}")
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
            logger.info("Login successful.")
            return True
        else:
            error_msg = response.get("message", "Unknown error") if response else "No response"
            logger.error(f"Login failed: {error_msg}")
            self.auth_token = None
            return False

    def get_index_data(self, exchangename):
        """Fetches the master list of all indices for a given exchange."""
        if not self.auth_token:
            logger.error("Authentication required.")
            return None
        endpoint = "/report/v1/getindexdatabyexchangename"
        return self._make_request("POST", endpoint, {"exchangename": exchangename})

    def get_bulk_eod_data(self, exchangename):
        """
        EFFICIENTLY fetches bulk EOD/LTP data for all instruments on an exchange.
        This is the preferred method for getting a full market snapshot.
        """
        if not self.auth_token:
            logger.error("Authentication required.")
            return None
        
        endpoint = "/report/v1/geteoddatabyexchangename"
        response = self._make_request("POST", endpoint, {"exchangename": exchangename})
        
        if response and response.get("status") == "SUCCESS":
            # Convert the list of data into a dictionary mapped by 'scripcode'
            # for instant O(1) time complexity lookups. This is highly performant.
            data_map = {str(item.get('scripcode')): item for item in response.get("data", [])}
            response['data'] = data_map
            return response
        
        return response

    # --- WebSocket Methods ---
    def connect_websocket(self, on_message, on_open, on_close, on_error):
        """Establishes a WebSocket connection in a background thread."""
        if not self.auth_token:
            logger.error("Cannot connect to WebSocket without authentication.")
            return
        
        ws_url = f"{self.websocket_url}?Authorization={self.auth_token}"
        ws_headers = {'Authorization': self.auth_token, 'ApiKey': self.api_key, 'User-Agent': 'MOSL/V.1.1.0'}
        
        self.ws = websocket.WebSocketApp(ws_url, on_open=on_open, on_message=on_message, 
                                         on_error=on_error, on_close=on_close, header=ws_headers)
        
        self.ws_thread = threading.Thread(target=lambda: self.ws.run_forever(ping_interval=30, ping_timeout=10))
        self.ws_thread.daemon = True
        self.ws_thread.start()
        logger.info("WebSocket connection thread started.")

    def disconnect_websocket(self):
        """Closes the WebSocket connection."""
        if self.ws:
            self.ws.close()
            logger.info("WebSocket connection closed.")
        if self.ws_thread:
            self.ws_thread.join()

    def _send_ws_message(self, action, params):
        """Helper to send a JSON message to the WebSocket."""
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            logger.error("WebSocket is not connected.")
            return
        message = json.dumps({"action": action, "params": params})
        self.ws.send(message)
        logger.info(f"Sent WebSocket Message: {message}")

    def register_index(self, exchange):
        """Subscribes to the broadcast for all indices on a given exchange."""
        self._send_ws_message("indexRegister", {"exchange": exchange})
        
    def unregister_index(self, exchange):
        """Unsubscribes from the index broadcast for a given exchange."""
        self._send_ws_message("indexUnregister", {"exchange": exchange})
