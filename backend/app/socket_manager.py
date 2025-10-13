import logging
import threading
import time
from app.moapi.mo_api import MotilalOswalAPI
from app.moapi.packet_parser import MOPacketParser

# --- Configuration ---
# Use a more detailed logging format for better debugging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(threadName)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class MO_WebSocket_Manager:
    """
    Manages a persistent WebSocket connection to the Motilal Oswal API as a singleton.
    This version is updated for robust connection handling, correct subscription logic,
    and efficient real-time data processing.
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
        if hasattr(self, 'initialized'):
            if socketio_server and not self.socketio:
                self.socketio = socketio_server
                logger.info("SocketIO server attached to existing MO_WebSocket_Manager instance.")
            return

        self.mo_api = MotilalOswalAPI()
        self.socketio = socketio_server
        self.force_connect = force_connect

        # State management
        self.is_connected = False
        self.ws_authed = False # Tracks if the binary login handshake is complete
        self.stop_event = threading.Event()
        self.data_lock = threading.Lock()
        
        # Background threads
        self.manager_thread = None
        self.heartbeat_thread = None
        
        # Data caches and mappings
        self.latest_indices_data = {}
        self.latest_stock_data = {}
        self.index_codes_map = {}
        self.scrip_to_symbol_map = {} # Maps 'EXCHANGE:SCRIPCODE' to a user-friendly symbol string
        self.scrip_prev_close = {}    # Caches previous day's close for change calculations

        # Subscription tracking
        self.registered_scrips = set() # Tracks scrip subscriptions, format: 'EXCHANGE:EXCHANGETYPE:SCRIPCODE'
        
        self.initialized = True
        logger.info("MO WebSocket Manager initialized.")
        self._load_initial_index_data()
        # Note: Watchlist scrips are loaded on-demand when users connect, not at startup

    def start(self):
        """Starts the WebSocket connection manager in a background thread."""
        if self.manager_thread and self.manager_thread.is_alive():
            logger.warning("WebSocket manager thread is already running.")
            return

        logger.info("Starting MO WebSocket manager...")
        self.stop_event.clear()
        
        self.manager_thread = threading.Thread(target=self._run, name="WSManagerThread", daemon=True)
        self.manager_thread.start()
        
        if not self.heartbeat_thread or not self.heartbeat_thread.is_alive():
            self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, name="WSHeartbeatThread", daemon=True)
            self.heartbeat_thread.start()

    def shutdown(self):
        """Gracefully shuts down the WebSocket manager and all background threads."""
        logger.info("🛑 Shutting down MO WebSocket Manager...")
        self.stop_event.set()
        
        try:
            if self.is_connected and self.ws_authed:
                logger.info("Unsubscribing from all live feeds...")
                self.mo_api.unregister_index("NSE")
                time.sleep(0.1)
                self.mo_api.unregister_index("BSE")
                for scrip_key in list(self.registered_scrips):
                    try:
                        exchange, exchange_type, scripcode = scrip_key.split(':')
                        self.mo_api.unregister_scrip(exchange, int(scripcode), exchange_type)
                        time.sleep(0.05)
                    except Exception as e:
                        logger.warning(f"Error unsubscribing {scrip_key}: {e}")
            
            if self.mo_api.ws:
                self.mo_api.disconnect_websocket()

            if self.manager_thread and self.manager_thread.is_alive():
                self.manager_thread.join(timeout=5)
            if self.heartbeat_thread and self.heartbeat_thread.is_alive():
                self.heartbeat_thread.join(timeout=5)
            
            logger.info("✅ MO WebSocket Manager shutdown complete.")
        except Exception as e:
            logger.error(f"Error during shutdown: {e}", exc_info=True)
        finally:
            self.is_connected = False
            self.ws_authed = False

    def register_scrip(self, symbol, exchange, scripcode, exchange_type="CASH"):
        """
        Adds a scrip to the subscription list. If already connected, it subscribes
        immediately. Otherwise, it will be subscribed upon the next connection.
        """
        composite_key = f"{exchange.upper()}:{exchange_type.upper()}:{int(scripcode)}"
        self.scrip_to_symbol_map[f"{exchange.upper()}:{int(scripcode)}"] = symbol
        
        if composite_key not in self.registered_scrips:
            self.registered_scrips.add(composite_key)
            logger.info(f"Queued subscription for {symbol} ({composite_key})")
            
            if self.is_connected and self.ws_authed:
                self.mo_api.register_scrip(exchange, int(scripcode), exchange_type)

    def unregister_scrip(self, exchange, scripcode, exchange_type="CASH"):
        """Removes a scrip from the subscription list and unsubscribes if connected."""
        composite_key = f"{exchange.upper()}:{exchange_type.upper()}:{int(scripcode)}"
        if composite_key in self.registered_scrips:
            self.registered_scrips.remove(composite_key)
            logger.info(f"Queued unsubscription for {composite_key}")
            if self.is_connected and self.ws_authed:
                self.mo_api.unregister_scrip(exchange, int(scripcode), exchange_type)
        self.scrip_to_symbol_map.pop(f"{exchange.upper()}:{int(scripcode)}", None)

    def _run(self):
        """Main loop that maintains the WebSocket connection with exponential backoff."""
        while not self.stop_event.is_set():
            try:
                if not self.mo_api.market_hours.is_market_open() and not self.force_connect:
                    logger.info("Market is closed. Will attempt connection during market hours.")
                    self.stop_event.wait(300) # Wait 5 minutes before re-checking
                    continue

                if not self.mo_api.auth_token and not self.mo_api.login():
                    logger.warning("API login failed. Retrying in 60 seconds.")
                    self.stop_event.wait(60)
                    continue
                
                logger.info("Attempting to establish WebSocket connection...")
                self.mo_api.connect_websocket(
                    on_message=self._on_message, on_open=self._on_open,
                    on_close=self._on_close, on_error=self._on_error
                )
                
                # Block here until the connection thread terminates (i.e., disconnects)
                if self.mo_api.ws_thread:
                    self.mo_api.ws_thread.join()
                
                logger.warning("WebSocket connection lost. Will attempt to reconnect...")

            except Exception as e:
                logger.error(f"Error in manager run loop: {e}", exc_info=True)
            
            # Exponential backoff on failure before retrying the loop
            self.stop_event.wait(15)

    def _on_open(self, ws):
        """Callback for when the WebSocket connection is established."""
        logger.info("✅ MO WebSocket Connection Opened. Authenticating...")
        self.is_connected = True
        self.ws_authed = False # Reset auth state
        
        # Step 1: Send the mandatory binary login packet.
        if self.mo_api.send_binary_login():
            # Step 2: Wait briefly for server to process login, then subscribe.
            time.sleep(1) 
            self.ws_authed = True
            logger.info("WebSocket authentication successful. Subscribing to feeds...")
            self._subscribe_all()
            if self.socketio:
                self.socketio.emit('market_status', {"status": "connected"})
        else:
            logger.error("Failed to send binary login packet. Closing connection.")
            ws.close()

    def _on_message(self, ws, message):
        """Processes incoming binary messages and emits formatted data via Socket.IO."""
        try:
            packets = MOPacketParser.parse_packet(message)
            if not packets:
                return

            for data in packets:
                packet_type = data.get('packet_type')
                exchange = str(data.get('Exchange', '')).upper()
                scrip_code_str = str(data.get('Scrip Code', ''))
                composite_scrip_key = f"{exchange}:{scrip_code_str}" if exchange and scrip_code_str else scrip_code_str

                if packet_type == 'DayOHLC':
                    self.scrip_prev_close[composite_scrip_key] = data.get('PrevDayClose', 0.0)
                    continue

                if packet_type == 'Index' and scrip_code_str in self.index_codes_map:
                    self._process_index_update(data)
                elif packet_type == 'LTP' and composite_scrip_key in self.scrip_to_symbol_map:
                    self._process_stock_update(data)

        except Exception as e:
            logger.error(f"Error processing WebSocket message: {e}", exc_info=True)

    def _process_stock_update(self, data):
        """Formats and emits a stock LTP update."""
        exchange = str(data.get('Exchange', '')).upper()
        scrip_code_str = str(data.get('Scrip Code'))
        composite_key = f"{exchange}:{scrip_code_str}" if exchange else scrip_code_str
        symbol = self.scrip_to_symbol_map.get(composite_key)
        ltp = data.get('LTP_Rate', 0.0)

        if not symbol or ltp <= 0: return
        
        prev_close = self.scrip_prev_close.get(composite_key, 0.0)
        volume = data.get('LTP_Cumulative Qty', 0)
        payload = self._compose_stock_payload(
            symbol=symbol,
            ltp=ltp,
            prev_close=prev_close,
            volume=volume
        )

        with self.data_lock:
            self.latest_stock_data[symbol] = payload
        if self.socketio:
            self.socketio.emit('stock_update', payload)
        logger.debug(f"Emitted STOCK update for {symbol}: {payload}")

    def _process_index_update(self, data):
        """Formats and emits an index data update."""
        scrip_code_str = str(data.get('Scrip Code'))
        index_info = self.index_codes_map.get(scrip_code_str, {})
        ltp = data.get('Rate', 0.0)

        if not index_info or ltp <= 0: return

        exchange_key = index_info.get('exchange', '').upper()
        prev_close = self.scrip_prev_close.get(f"{exchange_key}:{scrip_code_str}", 0.0)
        change = ltp - prev_close if prev_close > 0 else 0.0
        percent_change = (change / prev_close * 100) if prev_close > 0 else 0.0

        payload = {
            'name': index_info.get('name'),
            'symbol': f"{index_info.get('exchange')}:{scrip_code_str}",
            'price': round(ltp, 2),
            'change': round(change, 2),
            'percent_change': round(percent_change, 2),
            'last_updated': int(time.time() * 1000)
        }
        self.latest_indices_data[payload['symbol']] = payload
        if self.socketio:
            self.socketio.emit('index_update', payload)
        logger.debug(f"Emitted INDEX update for {payload['name']}: {payload}")

    def _compose_stock_payload(self, symbol, ltp, prev_close, volume=0, timestamp=None):
        """Creates a normalized payload dictionary for stock updates."""
        timestamp = timestamp or int(time.time() * 1000)
        change = ltp - prev_close if prev_close and prev_close > 0 else 0.0
        percent_change = (change / prev_close * 100) if prev_close and prev_close > 0 else 0.0

        return {
            'symbol': symbol,
            'ltp': round(ltp, 2),
            'change': round(change, 2),
            'percent_change': round(percent_change, 2),
            'volume': volume,
            'last_updated': timestamp
        }

    def get_latest_stock_data(self, symbols=None):
        """Returns a snapshot of the latest cached stock data."""
        with self.data_lock:
            if symbols is None:
                return {symbol: payload.copy() for symbol, payload in self.latest_stock_data.items()}

            if isinstance(symbols, str):
                symbols = [symbols]

            snapshot = {}
            for symbol in symbols:
                payload = self.latest_stock_data.get(symbol)
                if payload:
                    snapshot[symbol] = payload.copy()
            return snapshot

    def _preload_watchlist_scrips(self):
        """Registers watchlist stocks and seeds cached prices on startup."""
        try:
            from app.models import User

            users = User.objects.only('watchlists__stocks')
            if not users:
                logger.info("No users found while preloading watchlist scrips.")
                return

            unique_stocks = {}
            for user in users:
                for watchlist in getattr(user, 'watchlists', []) or []:
                    for stock in getattr(watchlist, 'stocks', []) or []:
                        if stock and stock.symbol and stock.symbol not in unique_stocks:
                            unique_stocks[stock.symbol] = stock

            if not unique_stocks:
                logger.info("No existing watchlist scrips to preload.")
                return

            logger.info(f"Preloading {len(unique_stocks)} watchlist scrip(s) for live updates...")

            fetch_initial_quotes = True
            if not self.mo_api.auth_token:
                try:
                    fetch_initial_quotes = self.mo_api.login()
                except Exception as e:
                    fetch_initial_quotes = False
                    logger.warning(f"Unable to authenticate MO API during preload: {e}")

            cached_count = 0
            for stock in unique_stocks.values():
                try:
                    exchange = (getattr(stock, 'exchange', None) or 'NSE').upper()
                    raw_scripcode = getattr(stock, 'scripcode', None)
                    if raw_scripcode is None:
                        logger.warning(f"Skipping watchlist scrip {getattr(stock, 'symbol', '?')} due to missing scripcode.")
                        continue
                    scripcode = int(raw_scripcode)
                    self.register_scrip(stock.symbol, exchange, scripcode)
                    if fetch_initial_quotes:
                        payload = self._fetch_initial_stock_payload(stock, exchange, scripcode)
                        if payload:
                            with self.data_lock:
                                self.latest_stock_data[stock.symbol] = payload
                            cached_count += 1
                except Exception as e:
                    logger.warning(f"Failed to register watchlist scrip {getattr(stock, 'symbol', '?')}: {e}")

            if cached_count:
                logger.info(f"Cached initial price snapshots for {cached_count} watchlist scrip(s).")
        except Exception as e:
            logger.error(f"Failed to preload watchlist scrips: {e}", exc_info=True)

    def _fetch_initial_stock_payload(self, stock, exchange, scripcode):
        """Fetches the latest LTP for a stock to seed cached data."""
        try:
            response = self.mo_api.get_ltp_data(exchange, scripcode)
            if not response or response.get('status') != 'SUCCESS' or not response.get('data'):
                return None

            data = response['data']
            ltp = float(data.get('ltp', 0)) / 100.0
            prev_close = float(data.get('close', 0)) / 100.0
            if ltp <= 0:
                return None

            volume = int(data.get('volume', 0))
            payload = self._compose_stock_payload(
                symbol=stock.symbol,
                ltp=ltp,
                prev_close=prev_close,
                volume=volume,
                timestamp=int(time.time() * 1000)
            )

            composite_key = f"{exchange}:{scripcode}"
            self.scrip_prev_close[composite_key] = prev_close
            return payload
        except Exception as e:
            logger.warning(f"Unable to fetch initial price for {getattr(stock, 'symbol', '?')}: {e}")
            return None

    def _on_close(self, ws, close_status_code, close_msg):
        """Callback for when the WebSocket connection is closed."""
        self.is_connected = False
        self.ws_authed = False
        logger.warning(f"MO WebSocket connection closed: {close_status_code} - {close_msg}")
        if self.socketio:
            self.socketio.emit('market_status', {"status": "disconnected"})

    def _on_error(self, ws, error):
        """Callback for handling WebSocket errors."""
        logger.error(f"MO WebSocket error: {error}")
        self.is_connected = False # Ensure state is reset on error

    def _subscribe_all(self):
        """Subscribes to all queued scrips and default indices."""
        try:
            logger.info("Subscribing to NSE and BSE index streams...")
            self.mo_api.register_index("NSE")
            time.sleep(0.1)
            self.mo_api.register_index("BSE")
            
            if self.registered_scrips:
                logger.info(f"Subscribing to {len(self.registered_scrips)} individual scrips...")
                for scrip_key in list(self.registered_scrips):
                    exchange, exchange_type, scripcode_str = scrip_key.split(':')
                    self.mo_api.register_scrip(exchange, int(scripcode_str), exchange_type)
                    time.sleep(0.05) # Rate limit subscriptions
        except Exception as e:
            logger.error(f"Failed during subscription process: {e}")

    def _load_initial_index_data(self):
        """
        Loads the initial snapshot of major index data (e.g., NIFTY, SENSEX)
        using REST calls on startup. This populates the UI before live ticks arrive.
        """
        # This is a simplified placeholder. In a real app, you would fetch this
        # from your database or a dedicated MO API endpoint for index masters.
        # For now, we'll hardcode major indices to bootstrap the process.
        major_indices = {
            "26000": {"name": "NIFTY 50", "exchange": "NSE"},
            "26009": {"name": "NIFTY BANK", "exchange": "NSE"},
            "999901": {"name": "S&P BSE SENSEX", "exchange": "BSE"}
        }
        self.index_codes_map = major_indices
        logger.info(f"Loaded {len(self.index_codes_map)} major indices for tracking.")
    
    def _heartbeat_loop(self):
        """Periodically sends heartbeat packets to keep the WebSocket connection alive."""
        while not self.stop_event.is_set():
            try:
                if self.is_connected and self.ws_authed:
                    self.mo_api.send_heartbeat()
                
                # Wait for 30 seconds before sending the next heartbeat
                self.stop_event.wait(30)
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}", exc_info=True)
                self.stop_event.wait(30) # Still wait to avoid a tight error loop

    def get_latest_indices_data(self):
        """Returns the current cached state of all tracked indices."""
        return list(self.latest_indices_data.values())
    
    def register_user_watchlist_stocks(self, user_id):
        """
        Registers all stocks from a specific user's watchlists for real-time updates.
        This is called when a user connects via WebSocket.
        """
        try:
            from app.models import User
            
            user = User.objects(id=user_id).only('watchlists__stocks').first()
            if not user:
                logger.warning(f"User {user_id} not found while registering watchlist stocks.")
                return 0
            
            stocks_registered = 0
            for watchlist in getattr(user, 'watchlists', []) or []:
                for stock in getattr(watchlist, 'stocks', []) or []:
                    if stock and stock.symbol:
                        try:
                            exchange = (getattr(stock, 'exchange', None) or 'NSE').upper()
                            raw_scripcode = getattr(stock, 'scripcode', None)
                            if raw_scripcode is None:
                                continue
                            scripcode = int(raw_scripcode)
                            self.register_scrip(stock.symbol, exchange, scripcode)
                            stocks_registered += 1
                        except Exception as e:
                            logger.warning(f"Failed to register stock {getattr(stock, 'symbol', '?')}: {e}")
            
            if stocks_registered > 0:
                logger.info(f"Registered {stocks_registered} watchlist stock(s) for user {user_id}")
            return stocks_registered
            
        except Exception as e:
            logger.error(f"Failed to register watchlist stocks for user {user_id}: {e}", exc_info=True)
            return 0

