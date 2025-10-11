import json
import logging
import threading
import time

# Import the updated MotilalOswalAPI from the correct path
from app.moapi.mo_api import MotilalOswalAPI

# --- Configuration ---
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MO_WebSocket_Manager:
    """
    Manages a persistent WebSocket connection to the Motilal Oswal API.
    Implemented as a singleton to ensure one connection for the entire application.
    This version is updated to handle both index and individual stock subscriptions.
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
        # Allow late binding: if already initialized, still attach SocketIO if provided
        if hasattr(self, 'initialized'):
            if socketio_server is not None and getattr(self, 'socketio', None) is None:
                self.socketio = socketio_server
                logger.info("SocketIO server attached to MO WebSocket Manager (late bind).")
            return
            
        self.mo_api = MotilalOswalAPI(use_test_url=False)
        self.socketio = socketio_server
        self.is_connected = False
        self.ws_thread = None
        self.force_connect = force_connect
        self.stop_event = threading.Event()
        self.poll_thread = None
        # Track last live tick per scrip (epoch ms)
        self.last_tick_ts = {}
        # Track WS auth handshake completion per connection
        self.ws_authed = False
        
        # Caches and Mappings
        self.latest_indices_data = {}
        self.index_codes_map = {}
        self.scrip_to_symbol_map = {} # New: Maps scripcode to full symbol (e.g., '3456' -> 'RELIANCE.NSE')
        self.scrip_prev_close = {}    # New: Cache previous close per scripcode for change calculations (in rupees)
        
        # State Tracking for Subscriptions
        self.registered_scrips = set() # New: Tracks registered scrips as 'EXCHANGE:SCRIPCODE'
        
        self.initialized = True
        logger.info("MO WebSocket Manager initialized.")
        self._load_initial_index_data_efficiently()

    def start(self):
        """Starts the WebSocket connection manager in a background thread."""
        if self.ws_thread and self.ws_thread.is_alive():
            logger.warning("WebSocket manager thread is already running.")
            return
        logger.info("Starting MO WebSocket manager thread.")
        self.ws_thread = threading.Thread(target=self._run, daemon=True)
        self.ws_thread.start()
        # Start a lightweight polling fallback so UI stays fresh if WS is quiet
        if not self.poll_thread or not self.poll_thread.is_alive():
            self.poll_thread = threading.Thread(target=self._poll_fallback_loop, daemon=True)
            self.poll_thread.start()

    def register_scrip(self, symbol, exchange, scripcode):
        """Subscribes to the broadcast for a specific scrip code."""
        scrip_key = f"{exchange}:{scripcode}"
        # Store the mapping from scripcode back to the full symbol
        key = str(scripcode)
        if key not in self.scrip_to_symbol_map:
            self.scrip_to_symbol_map[key] = symbol
            logger.info(f"Added symbol mapping: {scripcode} -> {symbol}")
        else:
            # Avoid spamming logs for repeated inserts
            self.scrip_to_symbol_map[key] = symbol
        
        if scrip_key not in self.registered_scrips:
            self.registered_scrips.add(scrip_key)
            # The API docs suggest a format like: Mofsl.Register("BSE", "CASH", 532540)
            # This translates to the following websocket message:
            logger.info(f"Registering scrip: {symbol} ({scrip_key})")
            # Only attempt to send if socket is connected; it will be re-sent on next on_open as well
            # Only send subscribe if WS is connected AND authed; else it will be sent after auth
            if (
                getattr(self.mo_api, 'ws', None)
                and getattr(getattr(self.mo_api, 'ws', None), 'sock', None)
                and getattr(self.mo_api.ws.sock, 'connected', False)
                and self.ws_authed
            ):
                self.mo_api._send_ws_message("Register", {"exchange": exchange, "exchangeType": "CASH", "scripcode": scripcode})
            else:
                logger.debug("WS not connected; will subscribe on next reconnect.")

    def unregister_scrip(self, exchange, scripcode):
        """Unsubscribes from a specific scrip's broadcast."""
        scrip_key = f"{exchange}:{scripcode}"
        if scrip_key in self.registered_scrips:
            self.registered_scrips.remove(scrip_key)
            logger.info(f"Unregistering scrip: {scrip_key}")
            if getattr(self.mo_api, 'ws', None) and getattr(getattr(self.mo_api, 'ws', None), 'sock', None) and getattr(self.mo_api.ws.sock, 'connected', False):
                self.mo_api._send_ws_message("UnRegister", {"exchange": exchange, "exchangeType": "CASH", "scripcode": scripcode})
            else:
                logger.debug("WS not connected during unregister; skipping send.")
    
    def _run(self):
        """Main loop for maintaining the WebSocket connection."""
        consecutive_errors = 0
        max_consecutive_errors = 5
        
        while True:
            try:
                if not self.mo_api.auth_token and not self.mo_api.login():
                    time.sleep(60)
                    continue
                if not self.mo_api.market_hours.is_market_open() and not self.force_connect:
                    logger.info("Market is closed. WebSocket will connect during market hours.")
                    time.sleep(300)
                    continue
                
                # Start the websocket connection in background
                self.mo_api.connect_websocket(
                    on_message=self._on_message, on_open=self._on_open,
                    on_close=self._on_close, on_error=self._on_error
                )
                # Wait while the WS thread is alive to avoid spinning the loop
                while getattr(self.mo_api, 'ws_thread', None) and self.mo_api.ws_thread.is_alive():
                    time.sleep(1)
                
                # Reset error counter on successful connection
                consecutive_errors = 0
                
            except Exception as e:
                consecutive_errors += 1
                wait_time = min(60 * consecutive_errors, 300)  # Exponential backoff, max 5 minutes
                logger.error(f"WebSocket connection failed (attempt {consecutive_errors}/{max_consecutive_errors}): {e}. Retrying in {wait_time} seconds.")
                
                if consecutive_errors >= max_consecutive_errors:
                    logger.warning("Too many consecutive WebSocket failures. Taking a longer break.")
                    time.sleep(600)  # 10 minute break after 5 failures
                    consecutive_errors = 0
                else:
                    time.sleep(wait_time)
            finally:
                self.is_connected = False
                if self.mo_api.ws:
                    self.mo_api.disconnect_websocket()

    def _on_open(self, ws):
        """Callback for when the WebSocket connection is successfully opened."""
        logger.info("✅ MO WebSocket Connection Opened")
        self.is_connected = True
        self.ws_authed = False
        
        # Send authentication message first
        auth_message = {
            "clientid": self.mo_api.user_id,
            "authtoken": self.mo_api.auth_token,
            "apikey": self.mo_api.api_key
        }
        self.mo_api._send_ws_auth_message(auth_message)
        
        # Notify frontend clients that market stream is live (during market hours)
        try:
            if self.socketio:
                self.socketio.emit('market_status', {"isOpen": True, "source": "mo_ws"})
            else:
                logger.warning("Skipped market_status emit on open: SocketIO server not attached.")
        except Exception:
            pass
        # Do not subscribe here; wait for explicit Auth success in on_message

    def _on_message(self, ws, message):
        """Processes incoming messages and emits formatted data via Socket.IO."""
        try:
            parsed = json.loads(message)
            # MO WS may send a single dict or a list of dicts; normalize to list
            data_list = parsed if isinstance(parsed, list) else [parsed]

            for data in data_list:
                # Debug: Log all incoming messages to understand data format
                logger.info(f"WS Message received: {json.dumps(data, indent=2)}")

                # Auth handshake handling
                if isinstance(data, dict) and data.get('status') == 'SUCCESS' and str(data.get('message', '')).lower().startswith('auth'):
                    # Mark authed and subscribe everything once
                    if not self.ws_authed:
                        self.ws_authed = True
                        try:
                            # short grace period to ensure server is ready for subs
                            time.sleep(0.3)
                            self._subscribe_all()
                        except Exception as sub_e:
                            logger.error(f"Error subscribing after auth: {sub_e}")
                    continue

                # --- 0. Capture Day OHLC packets for stocks to cache PrevDayClose ---
                if 'PrevDayClose' in data and 'Scrip Code' in data:
                    try:
                        scripcode_key = str(data.get('Scrip Code'))
                        prev_close_val = float(data.get('PrevDayClose', 0) or 0)
                        if prev_close_val > 0:
                            self.scrip_prev_close[scripcode_key] = prev_close_val
                    except Exception:
                        pass

                # --- A. Handle INDEX packets (detected by known index codes first) ---
                scripcode_str = str(data.get('Scrip Code') or data.get('Scripcode') or data.get('scripcode') or '')
                if scripcode_str and scripcode_str in self.index_codes_map:
                    # MO WS uses 'Scrip Code' (with space) for indices
                    matched_index = self.index_codes_map.get(scripcode_str)
                    
                    if matched_index:
                        # Index values are points, not paisa — do not divide by 100
                        current_price = float(data.get("LTP", data.get("Rate", 0)) or 0)
                        previous_close = float(data.get("Close", 0) or 0)
                        open_price = float(data.get("Open", 0) or 0)

                        # --- Standardized Calculations ---
                        change_daily = current_price - previous_close
                        percent_change_daily = (change_daily / previous_close * 100) if previous_close else 0
                        change_intraday = current_price - open_price if open_price > 0 else 0
                        percent_change_intraday = (change_intraday / open_price * 100) if open_price else 0
                        
                        formatted_data = {
                            "symbol": f"{matched_index['exchange']}:{scripcode_str}", "name": matched_index["name"],
                            "exchange": matched_index["exchange"], "price": current_price, "ltp": current_price,
                            "open": open_price, "high": float(data.get("High", 0) or 0),
                            "low": float(data.get("Low", 0) or 0), "close": previous_close,
                            "change_daily": round(change_daily, 2),
                            "percent_change_daily": round(percent_change_daily, 2),
                            "change_intraday": round(change_intraday, 2),
                            "percent_change_intraday": round(percent_change_intraday, 2),
                            "last_updated": int(time.time() * 1000), "data_type": "LIVE"
                        }
                        
                        self.latest_indices_data[formatted_data["symbol"]] = formatted_data
                        
                        if self.socketio:
                            self.socketio.emit('index_update', formatted_data)
                        else:
                            logger.warning("Skipped index_update emit: SocketIO server not attached.")
                        continue

                # --- B. Handle STOCK LTP packets ---
                if 'Scrip Code' in data or 'scripcode' in data or 'Scripcode' in data:
                    logger.debug(f"Processing potential stock message: {data}")
                    has_price = ('LTP_Rate' in data) or ('LTP' in data) or ('Rate' in data)
                    if has_price:
                        scripcode = str(data.get('Scrip Code') or data.get('Scripcode') or data.get('scripcode') or '')
                        if scripcode in self.index_codes_map:
                            continue
                        exchange = data.get('Exchange') or ''
                        symbol = self.scrip_to_symbol_map.get(scripcode)

                        logger.debug(f"Stock update - scripcode: {scripcode}, symbol: {symbol}, exchange: {exchange}")

                        if not symbol:
                            logger.debug(f"No symbol mapping found for scripcode {scripcode}. Available mappings: {list(self.scrip_to_symbol_map.keys())}")
                            continue

                        ltp_value = float(data.get('LTP_Rate', data.get('LTP', data.get('Rate', 0))) or 0)
                        
                        if ltp_value <= 0:
                            continue

                        stock_update_data = {
                            "symbol": symbol,
                            "scripcode": scripcode,
                            "ltp": ltp_value,
                            "volume": int(data.get("LTP_Cumulative Qty", data.get('LTP_CumulativeQty', data.get('Volume', 0)) or 0)),
                            "last_updated": int(time.time() * 1000),
                            "data_type": "LIVE_STOCK"
                        }

                        # Compute change and percent_change using previous close (daily change)
                        try:
                            prev_close = self.scrip_prev_close.get(scripcode)
                            if prev_close is None and exchange in ("NSE", "BSE") and self.mo_api and self.mo_api.auth_token:
                                rest_resp = self.mo_api.get_ltp_data(exchange, int(scripcode))
                                if rest_resp and rest_resp.get('status') == 'SUCCESS':
                                    rest_data = rest_resp.get('data') or {}
                                    close_paisa = rest_data.get('close')
                                    if close_paisa is not None:
                                        prev_close = float(close_paisa) / 100.0
                                        if prev_close > 0:
                                            self.scrip_prev_close[scripcode] = prev_close

                            if prev_close and prev_close > 0:
                                ltp_val = stock_update_data['ltp']
                                change_val = ltp_val - prev_close
                                pct_val = (change_val / prev_close * 100.0) if prev_close else 0.0
                                stock_update_data.update({
                                    'change': round(change_val, 2),
                                    'percent_change': round(pct_val, 2)
                                })
                        except Exception:
                            pass

                        if self.socketio:
                            self.socketio.emit('stock_update', stock_update_data)
                            logger.info(f"Emitted LIVE_STOCK update for {symbol}: ₹{ltp_value}")
                        else:
                            logger.warning("Skipped stock_update emit: SocketIO server not attached.")
                        
                        self.last_tick_ts[scripcode] = int(time.time() * 1000)
                            
        except json.JSONDecodeError:
            logger.info(f"Non-JSON message received: {message}")
        except Exception as e:
            logger.error(f"Error processing WebSocket message: {message} | Exception: {e}", exc_info=True)

    def _subscribe_all(self):
        """Send index and scrip subscriptions after WS auth success."""
        # --- 1) Indices ---
        # The API requires using 'IndexRegister' to subscribe to all indices for an exchange.
        # Subscribing to indices individually with the 'Register' action is not supported and causes an error.
        try:
            logger.info("Subscribing to all NSE and BSE index streams using IndexRegister...")
            # Use the documented method for subscribing to all indices per exchange
            self.mo_api.register_index("NSE")
            self.mo_api.register_index("BSE")
            logger.info("Successfully sent NSE and BSE index subscription requests.")
            
        except Exception as e:
            logger.error(f"Failed to subscribe to index streams: {e}")

        # --- 2) Individual scrips (from watchlists) ---
        # This part remains the same and should work correctly for stocks.
        try:
            if self.registered_scrips:
                logger.info(f"Re-subscribing to {len(self.registered_scrips)} individual scrips...")
                for scrip_key in list(self.registered_scrips):
                    exchange, scripcode_str = scrip_key.split(':')
                    self.mo_api._send_ws_message("Register", {"exchange": exchange, "exchangeType": "CASH", "scripcode": int(scripcode_str)})
                    time.sleep(0.08) # Keep a small delay to avoid flooding the server
                logger.info("Finished re-subscribing to scrips.")
        except Exception as e:
            logger.error(f"Failed to re-subscribe to scrips: {e}")


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
                        # Indices are points; treat values as already scaled
                        current_price = float(price_data.get("ltp", price_data.get("close", 0)) or 0)
                        previous_close = float(price_data.get("close", 0) or 0)
                        open_price = float(price_data.get("open", 0) or 0)

                        # --- Standardized Calculations ---
                        change_daily = current_price - previous_close
                        percent_change_daily = (change_daily / previous_close * 100) if previous_close else 0
                        change_intraday = current_price - open_price if open_price > 0 else 0
                        percent_change_intraday = (change_intraday / open_price * 100) if open_price else 0
                        
                        formatted_data = {
                            "symbol": f"{exchange}:{index_code}", "name": index_name, "exchange": exchange,
                            "price": current_price, "ltp": current_price,
                            "open": open_price, "high": float(price_data.get("high", 0) or 0),
                            "low": float(price_data.get("low", 0) or 0), "close": previous_close,
                            "change_daily": round(change_daily, 2),
                            "percent_change_daily": round(percent_change_daily, 2),
                            "change_intraday": round(change_intraday, 2),
                            "percent_change_intraday": round(percent_change_intraday, 2),
                            "last_updated": int(time.time() * 1000), "data_type": "EOD_SNAPSHOT"
                        }
                        self.latest_indices_data[f"{exchange}:{index_code}"] = formatted_data
                    else:
                        logger.debug(f"Price data not found for {exchange} index {index_name} ({index_code}) in bulk response.")

            logger.info(f"Loaded initial data for {len(self.latest_indices_data)} indices efficiently.")
            
        except Exception as e:
            logger.error(f"An error occurred during the efficient initial data load: {e}", exc_info=True)

    def _on_close(self, ws, close_status_code, close_msg):
        """Callback for when the WebSocket connection is closed."""
        self.is_connected = False
        self.ws_authed = False
        logger.warning(f"MO WebSocket connection closed: {close_status_code} - {close_msg}")
        # Notify clients stream is closed
        try:
            if self.socketio:
                self.socketio.emit('market_status', {"isOpen": False, "source": "mo_ws"})
            else:
                logger.warning("Skipped market_status emit on close: SocketIO server not attached.")
        except Exception:
            pass

    def _on_error(self, ws, error):
        """Callback for handling WebSocket errors."""
        self.is_connected = False
        self.mo_api.ws = None  # Reset the WebSocket instance
        logger.error(f"MO WebSocket error: {error}")

    def get_latest_data(self):
        """Returns the current state of all tracked indices from the cache."""
        return list(self.latest_indices_data.values())

    # ------------------------------------------------------------------
    # Polling fallback: fetch LTP occasionally when WS ticks are missing
    # ------------------------------------------------------------------
    def _poll_fallback_loop(self):
        """Periodically polls REST LTP for registered scrips with stale ticks.
        Keeps watchlist prices fresh when WebSocket is quiet or filtered.
        """
        POLL_INTERVAL_SEC = 5  # base loop cadence
        STALE_AFTER_MS = 15_000  # if no tick for 15s, poll it
        PER_REQUEST_DELAY = 0.15  # throttle REST requests slightly

        while not self.stop_event.is_set():
            try:
                now_ms = int(time.time() * 1000)
                if not self.registered_scrips:
                    time.sleep(POLL_INTERVAL_SEC)
                    continue

                # Ensure auth token is available
                if not self.mo_api.auth_token:
                    self.mo_api.login()

                # Iterate registered scrips and poll only those with stale ticks
                for scrip_key in list(self.registered_scrips):
                    try:
                        exchange, scripcode_str = scrip_key.split(':')
                        last_ts = self.last_tick_ts.get(scripcode_str, 0)
                        if now_ms - last_ts < STALE_AFTER_MS:
                            continue  # recent tick exists, skip polling

                        # Fetch LTP via REST (values in paisa -> rupees)
                        resp = self.mo_api.get_ltp_data(exchange, int(scripcode_str))
                        if resp and resp.get('status') == 'SUCCESS':
                            data = resp.get('data') or {}
                            ltp = float(data.get('ltp', 0)) / 100.0
                            close = float(data.get('close', 0)) / 100.0
                            if ltp <= 0:
                                continue

                            symbol = self.scrip_to_symbol_map.get(scripcode_str)
                            if not symbol:
                                continue

                            change_val = (ltp - close) if close > 0 else 0.0
                            pct_val = (change_val / close * 100.0) if close > 0 else 0.0
                            payload = {
                                'symbol': symbol,
                                'scripcode': scripcode_str,
                                'ltp': round(ltp, 2),
                                'change': round(change_val, 2),
                                'percent_change': round(pct_val, 2),
                                'last_updated': now_ms,
                                'data_type': 'POLL_STOCK'
                            }
                            if self.socketio:
                                self.socketio.emit('stock_update', payload)
                            # advance last tick ts to avoid immediate re-poll
                            self.last_tick_ts[scripcode_str] = now_ms
                        time.sleep(PER_REQUEST_DELAY)
                    except Exception:
                        # Continue polling others even if one fails
                        time.sleep(PER_REQUEST_DELAY)
                        continue
            except Exception:
                # Avoid tight loop on unexpected errors
                time.sleep(POLL_INTERVAL_SEC)
                continue
            # Base cadence sleep
            time.sleep(POLL_INTERVAL_SEC)