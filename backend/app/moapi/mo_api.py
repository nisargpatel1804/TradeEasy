import os
import requests
import hashlib
import json
import logging
import websocket
import threading
import time
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class MotilalOswalAPI:
    """
    A Python wrapper for the Motilal Oswal OpenAPI.
    Handles authentication, RESTful API calls, and WebSocket connections for market data.
    """
    def __init__(self, use_test_url=False):
        """
        Initializes the API client, loads credentials, and sets up base URLs.
        """
        load_dotenv()
        self.user_id = os.getenv("USER_ID")
        self.password = os.getenv("PASSWORD")
        self.api_key = os.getenv("API_KEY")
        self.two_fa = os.getenv("TWO_FA")

        if not all([self.user_id, self.password, self.api_key, self.two_fa]):
            raise ValueError("Please ensure USER_ID, PASSWORD, API_KEY, and TWO_FA are set in your .env file.")

        self.base_url_prod = "https://openapi.motilaloswal.com/rest"
        self.base_url_test = "https://openapi.motilaloswaluat.com/rest"
        # Always use production URL as requested
        self.base_url = self.base_url_prod
        
        # Always use production WebSocket URL
        self.websocket_url = "wss://openapi.motilaloswal.com/broadcast"

        self.auth_token = None
        self.session = requests.Session()
        self.ws = None
        self.ws_thread = None

        self._update_headers()

    def _update_headers(self, auth_token=None):
        """Helper method to construct and update session headers."""
        self.headers = {
            'Accept': 'application/json',
            'User-Agent': 'MOSL/V.1.1.0',
            'ApiKey': self.api_key,
            'ClientLocalIp': '1.2.3.4',
            'ClientPublicIp': '1.2.3.4',
            'MacAddress': '00:00:00:00:00:00',
            'SourceId': 'WEB',
            'vendorinfo': self.user_id,  # For client pass client code
            'osname': 'Windows 10',
            'osversion': '10.0.19041',
            'devicemodel': 'AHV',
            'manufacturer': 'DELL',
            'productname': 'Your Product Name',
            'productversion': 'Your Product Version',
            'browsername': 'Chrome',
            'browserversion': '105.0',
        }
        if auth_token:
            self.headers['Authorization'] = auth_token
        self.session.headers.update(self.headers)

    def _make_request(self, method, endpoint, payload=None):
        """Generic method to make API requests."""
        url = f"{self.base_url}{endpoint}"
        try:
            # For POST requests with no body, send an empty JSON object
            json_payload = payload if payload is not None else {}
            response = self.session.request(method, url, json=json_payload)
            
            # Check for non-2xx status codes
            response.raise_for_status()
            
            # Attempt to parse JSON, handle cases where response might be empty
            try:
                return response.json()
            except json.JSONDecodeError:
                logging.warning(f"Response from {url} was not valid JSON. Response text: {response.text}")
                return None

        except requests.exceptions.HTTPError as http_err:
            logging.error(f"HTTP error occurred: {http_err} - {response.text}")
        except requests.exceptions.RequestException as req_err:
            logging.error(f"Request error occurred: {req_err}")
        return None


    def login(self, totp=None):
        """
        Authenticates the user and retrieves an authorization token.
        
        Args:
            totp (str, optional): The 6-digit TOTP code if using an authenticator app.
                                  If None, OTP will be triggered.
        """
        endpoint = "/login/v3/authdirectapi"
        
        # SHA-256 hash of (password + api_key)
        hashed_password = hashlib.sha256((self.password + self.api_key).encode('utf-8')).hexdigest()

        payload = {
            "userid": self.user_id,
            "password": hashed_password,
            "2FA": self.two_fa,
        }

        if totp:
            payload["totp"] = totp

        response = self._make_request("POST", endpoint, payload)

        if response and response.get("status") == "SUCCESS":
            self.auth_token = response.get("AuthToken")
            self._update_headers(self.auth_token)
            logging.info("Login successful. AuthToken received.")
            return True
        else:
            error_msg = response.get("message", "Unknown login error") if response else "No response from server"
            logging.error(f"Login failed: {error_msg}")
            self.auth_token = None
            return False

    def get_ltp_data(self, exchange, scripcode, clientcode=None):
        """
        Fetches the Last Traded Price (LTP) and other market data for a scrip.
        """
        if not self.auth_token:
            logging.error("Not logged in. Please call login() first.")
            return None
        endpoint = "/report/v1/getltpdata"
        payload = {"exchange": exchange, "scripcode": scripcode}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._make_request("POST", endpoint, payload)

    def get_scrips_by_exchange(self, exchangename, clientcode=None):
        """
        Fetches the master list of all scrips/instruments for a given exchange.
        """
        if not self.auth_token:
            logging.error("Not logged in. Please call login() first.")
            return None
        endpoint = "/report/v1/getscripsbyexchangename"
        payload = {"exchangename": exchangename}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._make_request("POST", endpoint, payload)

    def get_index_data(self, exchangename, clientcode=None):
        """
        Fetches the master list of all indices for a given exchange.
        """
        if not self.auth_token:
            logging.error("Not logged in. Please call login() first.")
            return None
        endpoint = "/report/v1/getindexdatabyexchangename"
        payload = {"exchangename": exchangename}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._make_request("POST", endpoint, payload)

    def get_index_ltp_data(self, exchangename, scripcode, clientcode=None):
        """
        Fetches LTP data for a specific index.
        """
        if not self.auth_token:
            logging.error("Not logged in. Please call login() first.")
            return None
        endpoint = "/report/v1/getindexltpdata"
        # According to API docs, it should be 'exchangename' and scripcode as string
        payload = {"exchangename": exchangename, "scripcode": str(scripcode)}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._make_request("POST", endpoint, payload)

    # --- WebSocket Methods ---

    def _on_message(self, ws, message):
        """Default WebSocket message handler."""
        logging.info(f"WebSocket Message Received: {message}")

    def _on_error(self, ws, error):
        """Default WebSocket error handler."""
        logging.error(f"WebSocket Error: {error}")

    def _on_close(self, ws, close_status_code, close_msg):
        """Default WebSocket close handler."""
        logging.info("### WebSocket Closed ###")

    def _on_open(self, ws):
        """Default WebSocket open handler."""
        logging.info("### WebSocket Connection Opened ###")

    def connect_websocket(self, on_message=None, on_error=None, on_close=None, on_open=None):
        """Establishes a WebSocket connection in a separate thread."""
        if not self.auth_token:
            logging.error("Cannot connect to WebSocket without authentication.")
            return

        websocket.enableTrace(False)
        self.ws = websocket.WebSocketApp(
            self.websocket_url,
            on_open=on_open or self._on_open,
            on_message=on_message or self._on_message,
            on_error=on_error or self._on_error,
            on_close=on_close or self._on_close,
            header=self.headers # Pass auth headers
        )

        self.ws_thread = threading.Thread(target=self.ws.run_forever)
        self.ws_thread.daemon = True
        self.ws_thread.start()
        logging.info("WebSocket connection thread started.")
        time.sleep(2) # Give time for connection to establish

    def disconnect_websocket(self):
        """Closes the WebSocket connection."""
        if self.ws:
            self.ws.close()
            logging.info("WebSocket connection closed.")
        if self.ws_thread:
            self.ws_thread.join()

    def _send_ws_message(self, action, params):
        """Helper to send a JSON message to the WebSocket."""
        if not self.ws or not self.ws.sock or not self.ws.sock.connected:
            logging.error("WebSocket is not connected.")
            return
        
        message = {
            "action": action,
            "params": params
        }
        self.ws.send(json.dumps(message))
        logging.info(f"Sent WebSocket Message: {json.dumps(message)}")

    def register_scrip(self, exchange, exchange_type, scrip_code):
        """Registers a scrip for real-time data."""
        params = {"exchange": exchange, "exchangeType": exchange_type, "scripCode": scrip_code}
        self._send_ws_message("register", params)

    def unregister_scrip(self, exchange, exchange_type, scrip_code):
        """Unregisters a scrip from real-time data."""
        params = {"exchange": exchange, "exchangeType": exchange_type, "scripCode": scrip_code}
        self._send_ws_message("unregister", params)
        
    def register_index(self, exchange):
        """Registers an index for real-time data."""
        params = {"exchange": exchange}
        self._send_ws_message("indexRegister", params)
        
    def unregister_index(self, exchange):
        """Unregisters an index from real-time data."""
        params = {"exchange": exchange}
        self._send_ws_message("indexUnregister", params)