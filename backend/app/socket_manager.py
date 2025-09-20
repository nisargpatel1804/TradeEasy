import json
import logging
import threading
import time

# Import the updated MotilalOswalAPI from the correct path
from app.moapi.mo_api import MotilalOswalAPI

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MO_WebSocket_Manager:
    """
    Manages a persistent WebSocket connection to the Motilal Oswal API.
    Implemented as a singleton to ensure one connection for the entire application.
    This version is optimized for high-performance initial data loading.
    """
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(MO_WebSocket_Manager, cls).__new__(cls)
        return cls._instance

    def __init__(self, socketio_server=None, force_connect=False):
        if not hasattr(self, 'initialized'):
            self.mo_api = MotilalOswalAPI(use_test_url=False)
            self.socketio = socketio_server
            self.latest_indices_data = {}
            self.is_connected = False
            self.ws_thread = None
            self.force_connect = force_connect
            self.index_codes_map = {}
            self.initialized = True
            logger.info("MO WebSocket Manager initialized.")
            
            # Use the new, highly efficient method for the initial data load.
            self._load_initial_index_data_efficiently()

    def _load_initial_index_data_efficiently(self):
        """
        EFFICIENTLY loads initial index data using bulk API calls.
        This avoids the N+1 problem by making only two data calls (one per exchange)
        instead of one call for every single index.
        """
        try:
            if not self.mo_api.auth_token:
                if not self.mo_api.login():
                    logger.error("Failed to login to MO API for initial data load.")
                    return
            
            exchanges = ["NSE", "BSE"]
            
            for exchange in exchanges:
                index_list_response = self.mo_api.get_index_data(exchange)
                if not (index_list_response and index_list_response.get("status") == "SUCCESS"):
                    logger.warning(f"Could not fetch index list for {exchange}.")
                    continue
                indices_master_list = index_list_response.get("data", [])
                
                bulk_data_response = self.mo_api.get_bulk_eod_data(exchange)
                if not (bulk_data_response and bulk_data_response.get("status") == "SUCCESS"):
                    logger.warning(f"Could not fetch bulk EOD/LTP data for {exchange}.")
                    continue
                bulk_price_map = bulk_data_response.get("data", {})

                for index_info in indices_master_list:
                    index_code = str(index_info.get("indexcode"))
                    index_name = index_info.get("indexname")
                    self.index_codes_map[index_code] = {"name": index_name, "exchange": exchange}
                    price_data = bulk_price_map.get(index_code)

                    if price_data:
                        current_price = float(price_data.get("ltp", 0) or price_data.get("close", 0))
                        previous_close = float(price_data.get("close", 0))
                        open_price = float(price_data.get("open", 0))

                        # --- Standardized Calculations ---
                        change_daily = current_price - previous_close
                        percent_change_daily = (change_daily / previous_close * 100) if previous_close else 0
                        change_intraday = current_price - open_price if open_price > 0 else 0
                        percent_change_intraday = (change_intraday / open_price * 100) if open_price else 0
                        
                        formatted_data = {
                            "symbol": f"{exchange}:{index_code}", "name": index_name, "exchange": exchange,
                            "price": current_price, "ltp": current_price,
                            "open": open_price, "high": float(price_data.get("high", 0)),
                            "low": float(price_data.get("low", 0)), "close": previous_close,
                            "change_daily": round(change_daily, 2),
                            "percent_change_daily": round(percent_change_daily, 2),
                            "change_intraday": round(change_intraday, 2),
                            "percent_change_intraday": round(percent_change_intraday, 2),
                            "last_updated": int(time.time() * 1000), "data_type": "EOD_SNAPSHOT"
                        }
                        self.latest_indices_data[f"{exchange}:{index_code}"] = formatted_data
                        logger.info(f"✅ Loaded {exchange} {index_name}: {current_price}")
                    else:
                        logger.warning(f"❌ Price data not found for {exchange} index {index_name} ({index_code}) in bulk response.")

            logger.info(f"Loaded initial data for {len(self.latest_indices_data)} indices efficiently.")
            
        except Exception as e:
            logger.error(f"An error occurred during the efficient initial data load: {e}", exc_info=True)

    def start(self):
        """Starts the WebSocket connection manager in a background thread."""
        if self.ws_thread and self.ws_thread.is_alive():
            logger.warning("WebSocket manager thread is already running.")
            return
        logger.info("Starting MO WebSocket manager thread.")
        self.ws_thread = threading.Thread(target=self._run, daemon=True)
        self.ws_thread.start()

    def _run(self):
        """Main loop for maintaining the WebSocket connection."""
        while True:
            try:
                if not self.mo_api.auth_token and not self.mo_api.login():
                    time.sleep(60)
                    continue
                if not self.mo_api.market_hours.is_market_open() and not self.force_connect:
                    time.sleep(300)
                    continue
                self.mo_api.connect_websocket(
                    on_message=self._on_message, on_open=self._on_open,
                    on_close=self._on_close, on_error=self._on_error
                )
                self.ws_thread.join() 
            except Exception as e:
                logger.error(f"Error in WebSocket run loop: {e}. Retrying connection in 15 seconds.")
            finally:
                self.is_connected = False
                if self.mo_api.ws:
                    self.mo_api.disconnect_websocket()
                time.sleep(15)

    def _on_open(self, ws):
        """Callback for when the WebSocket connection is successfully opened."""
        logger.info("✅ MO WebSocket Connection Opened")
        self.is_connected = True
        time.sleep(1)
        try:
            self.mo_api.register_index(exchange="NSE")
            time.sleep(0.5)
            self.mo_api.register_index(exchange="BSE")
            logger.info("Subscribed to NSE and BSE index data streams.")
        except Exception as e:
            logger.error(f"Error during WebSocket subscription: {e}")

    def _on_close(self, ws, close_status_code, close_msg):
        """Callback for when the WebSocket connection is closed."""
        self.is_connected = False

    def _on_error(self, ws, error):
        """Callback for handling WebSocket errors."""
        self.is_connected = False

    def _on_message(self, ws, message):
        """Processes incoming messages and emits formatted data via Socket.IO."""
        try:
            data_list = json.loads(message)
            if not isinstance(data_list, list): return

            for data in data_list:
                if data.get('Touchline') == 'INDEX' or 'index' in str(data).lower():
                    scripcode = str(data.get('Scripcode', ''))
                    matched_index = self.index_codes_map.get(scripcode)
                    
                    if matched_index:
                        current_price = float(data.get("LTP", 0))
                        previous_close = float(data.get("Close", 0))
                        open_price = float(data.get("Open", 0))

                        # --- Standardized Calculations ---
                        change_daily = current_price - previous_close
                        percent_change_daily = (change_daily / previous_close * 100) if previous_close else 0
                        change_intraday = current_price - open_price if open_price > 0 else 0
                        percent_change_intraday = (change_intraday / open_price * 100) if open_price else 0
                        
                        formatted_data = {
                            "symbol": f"{matched_index['exchange']}:{scripcode}", "name": matched_index["name"],
                            "exchange": matched_index["exchange"], "price": current_price, "ltp": current_price,
                            "open": open_price, "high": float(data.get("High", 0)),
                            "low": float(data.get("Low", 0)), "close": previous_close,
                            "change_daily": round(change_daily, 2),
                            "percent_change_daily": round(percent_change_daily, 2),
                            "change_intraday": round(change_intraday, 2),
                            "percent_change_intraday": round(percent_change_intraday, 2),
                            "last_updated": int(time.time() * 1000), "data_type": "LIVE"
                        }
                        
                        self.latest_indices_data[formatted_data["symbol"]] = formatted_data
                        
                        if self.socketio:
                            self.socketio.emit('index_update', formatted_data)
                            
        except json.JSONDecodeError:
            logger.info(f"Non-JSON message received: {message}")
        except Exception as e:
            logger.error(f"Error processing WebSocket message: {message} | Exception: {e}")

    def get_latest_data(self):
        """Returns the current state of all tracked indices from the cache."""
        return list(self.latest_indices_data.values())