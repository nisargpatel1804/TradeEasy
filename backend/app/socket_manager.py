import logging
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from datetime import time as dt_time

from app.moapi import get_mo_api_client
from app.moapi.packet_parser import MOPacketParser
from app.services.market_data import MO_INDEX_CATALOG
from app.services.market_time import get_current_ist_time

# --- Configuration ---
logger = logging.getLogger(__name__)

SOCKET_WINDOW_START = dt_time(8, 45)
SOCKET_WINDOW_END = dt_time(15, 45)
INDEX_BOOTSTRAP_MAX_WORKERS = 8
WARMUP_MAX_WORKERS = max(1, int(os.getenv("MO_WARMUP_MAX_WORKERS", "4")))
WARMUP_QUEUE_MAX_SIZE = max(1, int(os.getenv("MO_WARMUP_QUEUE_MAX", "300")))
STOCK_CACHE_MAX_SIZE = max(1, int(os.getenv("MO_STOCK_CACHE_MAX", "2000")))
INDEX_CACHE_MAX_SIZE = max(1, int(os.getenv("MO_INDEX_CACHE_MAX", "256")))
STOCK_CACHE_TTL_SECONDS = max(30, int(os.getenv("MO_STOCK_CACHE_TTL_SECONDS", "1800")))
INDEX_CACHE_TTL_SECONDS = max(30, int(os.getenv("MO_INDEX_CACHE_TTL_SECONDS", "1800")))

PRICE_KEYS = ("ltp", "indexvalue", "indexValue", "lastprice", "lastPrice", "close", "Close")
CHANGE_KEYS = ("change", "indexchange", "indexChange")
PERCENT_KEYS = ("percent_change", "percentChange", "pChange", "pchange", "indexpercentchange")
PREV_CLOSE_KEYS = ("prevclose", "prevClose", "previousclose", "previousClose", "close", "Close")


def _extract_number(entry, candidate_keys):
    if not isinstance(entry, dict):
        return None

    for key in candidate_keys:
        if key in entry:
            value = entry.get(key)
        else:
            matching_key = next((k for k in entry.keys() if isinstance(k, str) and k.lower() == key.lower()), None)
            value = entry.get(matching_key) if matching_key else None

        if value in (None, "", "NA", "NaN", "-", "null"):
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return None


def _normalize_index_payload(response):
    if not response:
        return {}

    data = response.get("data", response)
    if isinstance(data, list):
        return data[0] if data else {}
    if isinstance(data, dict):
        return data
    return {}

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

        self.mo_api = get_mo_api_client()
        self.socketio = socketio_server
        self.force_connect = force_connect

        # State management
        self.is_connected = False
        self.ws_authed = False # Tracks if the binary login handshake is complete
        self.stop_event = threading.Event()
        self.data_lock = threading.Lock()
        
        # Circuit breaker state
        self.circuit_state = 'closed'  # closed, open, half_open
        self.failure_count = 0
        self.circuit_open_time = None
        self.circuit_threshold = 5  # Open circuit after 5 failures
        self.circuit_timeout = 300  # Try to reconnect after 5 minutes
        
        # Heartbeat tracking (only for monitoring data receipt)
        self.last_heartbeat_received = None
        self.heartbeat_timeout = 90  # Disconnect if no data received in 90 seconds
        
        # Message batching
        self.pending_stock_updates = {}
        self.pending_index_updates = {}
        self.batch_interval = 0.5  # Batch updates every 500ms
        self.last_batch_time = time.time()
        self.batch_lock = threading.Lock()
        
        # Background threads
        self.manager_thread = None
        self.heartbeat_thread = None
        self.batch_thread = None
        
        # Data caches and mappings
        self.latest_indices_data = OrderedDict()
        self.latest_stock_data = OrderedDict()
        self.index_codes_map = {}
        self.scrip_to_symbol_map = {} # Maps 'EXCHANGE:SCRIPCODE' to a user-friendly symbol string
        self.scrip_prev_close = {}    # Caches previous day's close for change calculations

        # Subscription tracking
        self.registered_scrips = set() # Tracks scrip subscriptions, format: 'EXCHANGE:EXCHANGETYPE:SCRIPCODE'
        
        # track user subscriptions for reconnect
        self.user_subscriptions = {}  # Maps user_id -> set of scrip keys
        self.subscription_lock = threading.Lock()
        self._warmup_lock = threading.Lock()
        self._warmup_inflight = set()
        self._warmup_executor = ThreadPoolExecutor(max_workers=WARMUP_MAX_WORKERS, thread_name_prefix="WarmLTP")
        
        self.initialized = True
        logger.info("MO WebSocket Manager initialized.")
        self._load_initial_index_data()
        # Note: Watchlist scrips are loaded on-demand when users connect, not at startup

    def _prune_cache_locked(self, cache, ttl_seconds, max_size):
        """Prunes stale entries first, then evicts oldest entries to enforce a hard max size."""
        now_ms = int(time.time() * 1000)
        ttl_ms = ttl_seconds * 1000

        stale_keys = []
        for key, payload in list(cache.items()):
            last_updated = int(payload.get('last_updated', 0) or 0) if isinstance(payload, dict) else 0
            if last_updated <= 0 or (now_ms - last_updated) > ttl_ms:
                stale_keys.append(key)
        for key in stale_keys:
            cache.pop(key, None)

        while len(cache) > max_size:
            cache.popitem(last=False)

    def _upsert_stock_cache_locked(self, symbol, payload):
        if symbol in self.latest_stock_data:
            self.latest_stock_data.move_to_end(symbol)
        self.latest_stock_data[symbol] = payload
        self._prune_cache_locked(self.latest_stock_data, STOCK_CACHE_TTL_SECONDS, STOCK_CACHE_MAX_SIZE)

    def _upsert_index_cache_locked(self, symbol, payload):
        if symbol in self.latest_indices_data:
            self.latest_indices_data.move_to_end(symbol)
        self.latest_indices_data[symbol] = payload
        self._prune_cache_locked(self.latest_indices_data, INDEX_CACHE_TTL_SECONDS, INDEX_CACHE_MAX_SIZE)

    def _within_socket_window(self, current_dt=None):
        """Return True when within the websocket trading window (08:45-15:45 IST)."""
        current_dt = current_dt or get_current_ist_time()
        current_time = current_dt.time()

        if SOCKET_WINDOW_START <= SOCKET_WINDOW_END:
            return SOCKET_WINDOW_START <= current_time < SOCKET_WINDOW_END
        return current_time >= SOCKET_WINDOW_START or current_time < SOCKET_WINDOW_END

    def _is_live_market_window(self):
        """Returns True only during active market+socket window."""
        try:
            return bool(self._within_socket_window() and self.mo_api.market_hours.is_market_open())
        except Exception:
            return False

    def update_index_metadata(self, indexcode, name, exchange, prev_close=None, latest_payload=None):
        """Registers or refreshes index metadata used for live tick processing."""
        if not indexcode or not exchange:
            return

        indexcode_str = str(indexcode)
        exchange_key = exchange.upper()
        display_name = name or f"{exchange_key}:{indexcode_str}"

        with self.data_lock:
            self.index_codes_map[indexcode_str] = {
                "name": display_name,
                "exchange": exchange_key,
            }

            if isinstance(prev_close, (int, float)) and prev_close > 0:
                self.scrip_prev_close[f"{exchange_key}:{indexcode_str}"] = prev_close

            if isinstance(latest_payload, dict):
                payload_copy = {**latest_payload}
                payload_copy.setdefault('symbol', f"{exchange_key}:{indexcode_str}")
                self._upsert_index_cache_locked(payload_copy['symbol'], payload_copy)

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
        
        if not self.batch_thread or not self.batch_thread.is_alive():
            self.batch_thread = threading.Thread(target=self._batch_emitter_loop, name="BatchEmitterThread", daemon=True)
            self.batch_thread.start()

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

            if self._warmup_executor:
                self._warmup_executor.shutdown(wait=False, cancel_futures=True)
            
            logger.info("✅ MO WebSocket Manager shutdown complete.")
        except Exception as e:
            logger.error(f"Error during shutdown: {e}", exc_info=True)
        finally:
            self.is_connected = False
            self.ws_authed = False

    def _warm_scrip_initial_data(self, symbol, exchange, scripcode):
        """Background helper: fetches and caches the initial LTP for a newly registered scrip."""
        warmup_key = f"{exchange.upper()}:{int(scripcode)}"
        try:
            from app.models import Stock
            stock = Stock.objects(symbol=symbol).first()
            if stock and self.mo_api.login():
                payload = self._fetch_initial_stock_payload(stock, exchange.upper(), int(scripcode))
                if payload:
                    with self.data_lock:
                        self._upsert_stock_cache_locked(symbol, payload)

                    with self.batch_lock:
                        self.pending_stock_updates[symbol] = payload

                    logger.info(f"Background warm-up cached initial data for {symbol}: LTP={payload.get('ltp')}")
                else:
                    logger.debug("Initial warm-up returned no payload for %s", symbol)
        except Exception as e:
            logger.warning(f"Background warm-up failed for {symbol}: {e}")
        finally:
            with self._warmup_lock:
                self._warmup_inflight.discard(warmup_key)

    def _enqueue_warm_scrip_initial_data(self, symbol, exchange, scripcode):
        """Queues a bounded initial warm-up task for a stock if not already in flight."""
        warmup_key = f"{exchange.upper()}:{int(scripcode)}"
        with self._warmup_lock:
            if warmup_key in self._warmup_inflight:
                return False
            if len(self._warmup_inflight) >= WARMUP_QUEUE_MAX_SIZE:
                logger.warning(
                    "Warm-up queue limit reached (%s). Dropping warm-up for %s.",
                    WARMUP_QUEUE_MAX_SIZE,
                    warmup_key,
                )
                return False
            self._warmup_inflight.add(warmup_key)

        try:
            self._warmup_executor.submit(self._warm_scrip_initial_data, symbol, exchange, scripcode)
            return True
        except Exception as exc:
            with self._warmup_lock:
                self._warmup_inflight.discard(warmup_key)
            logger.warning("Failed to queue warm-up for %s (%s): %s", symbol, warmup_key, exc)
            return False

    def register_scrip(self, symbol, exchange, scripcode, exchange_type="CASH", skip_initial_fetch=False):
        """
        Adds a scrip to the subscription list. If already connected, it subscribes
        immediately. Otherwise, it will be subscribed upon the next connection.
        """
        composite_key = f"{exchange.upper()}:{exchange_type.upper()}:{int(scripcode)}"
        self.scrip_to_symbol_map[f"{exchange.upper()}:{int(scripcode)}"] = symbol
        
        if composite_key not in self.registered_scrips:
            self.registered_scrips.add(composite_key)
            logger.info(f"Queued subscription for {symbol} ({composite_key}); total_subscriptions={len(self.registered_scrips)}")

            if not skip_initial_fetch:
                self._enqueue_warm_scrip_initial_data(symbol, exchange, scripcode)

            subscription_status = {"success": True, "message": "Subscribed successfully"}

            if self.is_connected and self.ws_authed:
                attempts = 0
                max_attempts = 3
                last_exc = None
                while attempts < max_attempts:
                    try:
                        self.mo_api.register_scrip(exchange, int(scripcode), exchange_type)
                        logger.info(f"MO API register_scrip called for {symbol} ({composite_key})")
                        subscription_status = {"success": True, "message": "Subscribed successfully"}
                        break
                    except Exception as e:
                        attempts += 1
                        last_exc = e
                        wait_time = 0.5 * (2 ** (attempts - 1))
                        logger.warning(f"MO API register_scrip attempt {attempts} failed for {symbol}: {e}; retrying in {wait_time}s")
                        time.sleep(wait_time)
                else:
                    subscription_status = {"success": False, "message": f"Failed to subscribe after {max_attempts} attempts: {last_exc}"}
                    logger.warning(f"MO API register_scrip ultimately failed for {symbol}: {last_exc}")

            return subscription_status
        else:
            logger.debug(f"Subscription request for {symbol} ({composite_key}) received but already registered")
            return {"success": True, "message": "Already subscribed"}

    def unregister_scrip(self, exchange, scripcode, exchange_type="CASH"):
        """Removes a scrip from the subscription list and unsubscribes if connected."""
        composite_key = f"{exchange.upper()}:{exchange_type.upper()}:{int(scripcode)}"
        if composite_key in self.registered_scrips:
            self.registered_scrips.remove(composite_key)
            logger.info(f"Queued unsubscription for {composite_key}; total_subscriptions={len(self.registered_scrips)}")
            try:
                if self.is_connected and self.ws_authed:
                    self.mo_api.unregister_scrip(exchange, int(scripcode), exchange_type)
                    logger.info(f"MO API unregister_scrip called for {composite_key}")
            except Exception as e:
                logger.warning(f"MO API unregister_scrip failed for {composite_key}: {e}")

        self.scrip_to_symbol_map.pop(f"{exchange.upper()}:{int(scripcode)}", None)

    def _run(self):
        """Main loop that maintains the WebSocket connection with exponential backoff and circuit breaker."""
        retry_count = 0
        max_retry_delay = 300
        base_delay = 15
        
        while not self.stop_event.is_set():
            try:
                if self.circuit_state == 'open':
                    elapsed = time.time() - self.circuit_open_time
                    if elapsed < self.circuit_timeout:
                        logger.info(f"🔴 Circuit breaker OPEN. Waiting {int(self.circuit_timeout - elapsed)}s before retry...")
                        self.stop_event.wait(min(60, self.circuit_timeout - elapsed))
                        continue
                    else:
                        logger.info("🟡 Circuit breaker entering HALF-OPEN state. Attempting connection...")
                        self.circuit_state = 'half_open'

                within_socket_window = self._within_socket_window()
                if not within_socket_window and not self.force_connect:
                    if self.is_connected or self.ws_authed:
                        logger.info("⏹️ Trading window closed (08:45 AM - 03:45 PM IST). Disconnecting WebSocket feed.")
                        try:
                            self.mo_api.disconnect_websocket()
                        except Exception as disconnect_error:
                            logger.debug(f"Graceful disconnect outside trading window failed: {disconnect_error}")
                        self.is_connected = False
                        self.ws_authed = False

                    retry_count = 0
                    self.failure_count = 0
                    self.circuit_state = 'closed'
                    logger.info("🌙 Outside trading window. Rechecking in 300 seconds...")
                    self.stop_event.wait(300)
                    continue
                
                market_open = self.mo_api.market_hours.is_market_open()
                
                if not market_open and not self.force_connect:
                    logger.info("⏰ Market is closed. Waiting for market hours (9:15 AM - 3:30 PM IST)...")
                    retry_count = 0
                    self.failure_count = 0
                    self.circuit_state = 'closed'
                    self.stop_event.wait(300)
                    continue
                
                if not market_open and self.force_connect:
                    logger.info("🧪 Testing mode: Connecting despite market being closed (force_connect=True)")

                if not self.mo_api.login():
                    logger.warning("⚠️ API login failed. Will retry in 60 seconds.")
                    logger.info("💡 Hint: If TOTP errors persist, check system time sync: w32tm /resync")
                    self._handle_connection_failure()
                    self.stop_event.wait(60)
                    continue
                
                status_msg = f"Attempting to establish WebSocket connection... (attempt {retry_count + 1})"
                if not market_open:
                    status_msg += " [Market Closed - Testing Mode]"
                logger.info(status_msg)
                
                self.mo_api.connect_websocket(
                    on_message=self._on_message, on_open=self._on_open,
                    on_close=self._on_close, on_error=self._on_error
                )
                
                if self.mo_api.ws_thread:
                    self.mo_api.ws_thread.join()
                
                self._handle_connection_failure()
                retry_count += 1
                retry_delay = min(base_delay * (2 ** min(retry_count - 1, 4)), max_retry_delay)
                
                within_socket_window = self._within_socket_window()
                if within_socket_window:
                    market_status = "" if market_open else " (Expected - Market is closed)"
                else:
                    market_status = " (Outside trading window)"

                reconnect_msg = f"🔄 WebSocket connection lost{market_status}. Retry #{retry_count} in {retry_delay}s..."
                if market_open and within_socket_window:
                    logger.warning(reconnect_msg)
                else:
                    logger.info(reconnect_msg)
                
                if self.socketio:
                    self.socketio.emit('market_status', {
                        "status": "reconnecting",
                        "retry_count": retry_count,
                        "retry_in": retry_delay,
                        "market_open": market_open,
                        "within_socket_window": within_socket_window,
                        "circuit_state": self.circuit_state
                    })

                if not self.force_connect and (not within_socket_window or not market_open):
                    retry_count = 0
                    self.failure_count = 0
                    self.circuit_state = 'closed'
                    logger.info("🌙 Outside trading window after disconnect. Rechecking in 300 seconds...")
                    self.stop_event.wait(300)
                    continue

            except Exception as e:
                logger.error(f"Error in manager run loop: {e}", exc_info=True)
                self._handle_connection_failure()
                retry_count += 1
                retry_delay = min(base_delay * (2 ** min(retry_count - 1, 4)), max_retry_delay)
            
            self.stop_event.wait(retry_delay if 'retry_delay' in locals() else base_delay)
    
    def _handle_connection_failure(self):
        self.failure_count += 1
        if self.failure_count >= self.circuit_threshold:
            self.circuit_state = 'open'
            self.circuit_open_time = time.time()
            logger.warning(f"🔴 Circuit breaker OPEN after {self.failure_count} failures")
        elif self.circuit_state == 'half_open':
            self.circuit_state = 'open'
            self.circuit_open_time = time.time()
            logger.warning("🔴 Circuit breaker reopened after failed half-open attempt")
    
    def _handle_connection_success(self):
        if self.circuit_state != 'closed':
            logger.info("🟢 Circuit breaker CLOSED - connection restored")
        self.failure_count = 0
        self.circuit_state = 'closed'
        self.circuit_open_time = None

    def _on_open(self, ws):
        logger.info("✅ MO WebSocket Connection Opened. Authenticating...")
        self.is_connected = True
        self.ws_authed = False
        
        if self.mo_api.send_binary_login():
            time.sleep(1) 
            self.ws_authed = True
            logger.info("✅ WebSocket authentication successful. Subscribing to feeds...")
            self._subscribe_all()
            self._handle_connection_success()
            if self.socketio:
                self.socketio.emit('market_status', {"status": "connected"})
        else:
            logger.error("❌ Failed to send binary login packet. Closing connection.")
            ws.close()

    def _on_message(self, ws, message):
        try:
            self.last_heartbeat_received = time.time()
            
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
        exchange = str(data.get('Exchange', '')).upper()
        scrip_code_str = str(data.get('Scrip Code'))
        composite_key = f"{exchange}:{scrip_code_str}" if exchange else scrip_code_str
        symbol = self.scrip_to_symbol_map.get(composite_key)
        ltp = data.get('LTP_Rate', 0.0)

        if not symbol or ltp <= 0: 
            return
        
        prev_close = self.scrip_prev_close.get(composite_key, 0.0)
        if prev_close > 0:
            def _pct_change(reference: float) -> float:
                try:
                    return abs((ltp - reference) / reference * 100)
                except ZeroDivisionError:
                    return 0.0

            price_change_pct = _pct_change(prev_close)

            if price_change_pct > 50:
                candidates = [
                    (prev_close, price_change_pct),
                    (prev_close * 100.0, _pct_change(prev_close * 100.0)),
                    (prev_close / 100.0, _pct_change(prev_close / 100.0)),
                ]
                best_prev_close, best_pct = min(candidates, key=lambda item: item[1])
                if best_prev_close > 0 and best_pct < 20:
                    logger.warning(
                        "⚠️ Corrected prev_close scale for %s: %s -> %s (%.1f%%)",
                        symbol,
                        prev_close,
                        best_prev_close,
                        best_pct,
                    )
                    prev_close = best_prev_close
                    self.scrip_prev_close[composite_key] = best_prev_close
                    price_change_pct = best_pct

            if price_change_pct > 20:
                logger.warning(f"⚠️ Anomalous price for {symbol}: LTP={ltp}, PrevClose={prev_close}, Change={price_change_pct:.1f}%")
                if price_change_pct > 50:
                    logger.error(f"❌ Rejecting invalid price update for {symbol}")
                    return
        
        if ltp > 1000000:
            logger.error(f"❌ Rejecting unrealistic price for {symbol}: {ltp}")
            return
        
        volume = data.get('LTP_Cumulative Qty', 0)
        payload = self._compose_stock_payload(
            symbol=symbol,
            ltp=ltp,
            prev_close=prev_close,
            volume=volume,
            price_source='ltp'
        )

        with self.data_lock:
            self._upsert_stock_cache_locked(symbol, payload)
        
        with self.batch_lock:
            self.pending_stock_updates[symbol] = payload
        
        logger.debug(f"Queued STOCK update for {symbol}: {payload}")

    def _process_index_update(self, data):
        scrip_code_str = str(data.get('Scrip Code'))
        index_info = self.index_codes_map.get(scrip_code_str, {})
        ltp = data.get('Rate', 0.0)

        if not index_info or ltp <= 0:
            return

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
            'last_updated': int(time.time() * 1000),
            'entityType': 'index'
        }
        with self.data_lock:
            self._upsert_index_cache_locked(payload['symbol'], payload)
        
        with self.batch_lock:
            self.pending_index_updates[payload['symbol']] = payload
        
        logger.debug(f"Queued INDEX update for {payload['name']}: {payload}")

    def _compose_stock_payload(self, symbol, ltp, prev_close, volume=0, timestamp=None, price_source='ltp'):
        timestamp = timestamp or int(time.time() * 1000)
        change = ltp - prev_close if prev_close and prev_close > 0 else 0.0
        percent_change = (change / prev_close * 100) if prev_close and prev_close > 0 else 0.0

        return {
            'symbol': symbol,
            'ltp': round(ltp, 2),
            'change': round(change, 2),
            'percent_change': round(percent_change, 2),
            'volume': volume,
            'price_source': price_source,
            'last_updated': timestamp
        }

    def get_latest_stock_data(self, symbols=None):
        with self.data_lock:
            self._prune_cache_locked(self.latest_stock_data, STOCK_CACHE_TTL_SECONDS, STOCK_CACHE_MAX_SIZE)
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

    def get_subscription_summary(self):
        with self.subscription_lock, self.data_lock:
            return {
                'total_registered_scrips': len(self.registered_scrips),
                'total_users_with_subscriptions': len(self.user_subscriptions),
                'per_user_counts_sample': {uid: len(skeys) for uid, skeys in self.user_subscriptions.items()}
            }

    def _fetch_initial_stock_payload(self, stock, exchange, scripcode):
        try:
            from app.routes.stock import extract_price_with_fallback, _get_cached_eod_data
            
            response = self.mo_api.get_ltp_data(exchange, scripcode)
            data = {}
            ltp = 0.0
            price_source = 'unavailable'

            if response and response.get('status') == 'SUCCESS' and response.get('data'):
                data = response['data']
                ltp, price_source = extract_price_with_fallback(data)
            else:
                logger.debug("LTP unavailable for %s (%s:%s); trying EOD fallback", getattr(stock, 'symbol', '?'), exchange, scripcode)
            
            if ltp <= 0:
                logger.debug(f"LTP is zero for {stock.symbol}, trying bulk EOD data")
                eod_data_list = _get_cached_eod_data(self.mo_api, exchange)
                for eod_entry in eod_data_list:
                    if str(eod_entry.get("scripcode")) == str(scripcode):
                        ltp, price_source = extract_price_with_fallback(eod_entry)
                        if ltp > 0:
                            data = eod_entry
                            logger.debug(f"Found {stock.symbol} in EOD data: {ltp}")
                            break
            
            if ltp <= 0:
                return None

            prev_close = float(data.get('close', 0)) / 100.0
            
            if price_source in ('close', 'prevClose') and prev_close <= 0:
                prev_close = ltp
                logger.debug(f"Using fallback: setting prev_close = ltp for {stock.symbol}")
            
            composite_key = f"{exchange.upper()}:{int(scripcode)}"
            if prev_close > 0:
                self.scrip_prev_close[composite_key] = prev_close
                logger.debug(f"Stored prev_close for {stock.symbol} ({composite_key}): {prev_close}")

            volume = int(data.get('volume', 0))
            payload = self._compose_stock_payload(
                symbol=stock.symbol,
                ltp=ltp,
                prev_close=prev_close,
                volume=volume,
                timestamp=int(time.time() * 1000),
                price_source=price_source
            )

            return payload
        except Exception as e:
            logger.warning(f"Unable to fetch initial price for {getattr(stock, 'symbol', '?')}: {e}")
            return None

    def _on_close(self, ws, close_status_code, close_msg):
        self.is_connected = False
        self.ws_authed = False

        should_warn = self._is_live_market_window()
        
        if close_status_code:
            message = f"🔌 MO WebSocket connection closed: Code={close_status_code}, Message='{close_msg}'"
        else:
            message = f"🔌 MO WebSocket connection closed unexpectedly. Message='{close_msg}'"

        if should_warn:
            logger.warning(message)
        else:
            logger.debug(message)
        
        if self.socketio:
            self.socketio.emit('market_status', {
                "status": "disconnected",
                "reason": close_msg or "Connection closed"
            })

    def _on_error(self, ws, error):
        error_msg = str(error)
        in_live_window = self._is_live_market_window()
        
        if "Connection to remote host was lost" in error_msg or "Remote end closed connection" in error_msg:
            if in_live_window:
                logger.warning(f"⚠️ MO WebSocket disconnected (Provider closed connection): {error_msg}")
            else:
                logger.debug(f"MO WebSocket disconnected off-hours: {error_msg}")
        else:
            if in_live_window:
                logger.error(f"❌ MO WebSocket error: {error_msg}")
            else:
                logger.debug(f"MO WebSocket error off-hours: {error_msg}")
        
        if self.is_connected:
            self.is_connected = False
            if self.socketio:
                self.socketio.emit('market_status', {
                    "status": "error", 
                    "error": error_msg
                })

    def _subscribe_all(self):
        try:
            logger.info("Subscribing to NSE and BSE index streams...")
            self.mo_api.register_index("NSE")
            self.mo_api.register_index("BSE")
            
            if self.registered_scrips:
                logger.info(f"Subscribing to {len(self.registered_scrips)} individual scrips...")
                for scrip_key in list(self.registered_scrips):
                    exchange, exchange_type, scripcode_str = scrip_key.split(':')
                    self.mo_api.register_scrip(exchange, int(scripcode_str), exchange_type)
            
            with self.subscription_lock:
                if self.user_subscriptions:
                    logger.info(f"Re-registering subscriptions for {len(self.user_subscriptions)} active users...")
                    for user_id, scrip_keys in self.user_subscriptions.items():
                        for scrip_key in scrip_keys:
                            if scrip_key not in self.registered_scrips:
                                try:
                                    exchange, exchange_type, scripcode_str = scrip_key.split(':')
                                    self.mo_api.register_scrip(exchange, int(scripcode_str), exchange_type)
                                    self.registered_scrips.add(scrip_key)
                                    logger.debug(f"Re-registered {scrip_key} for user {user_id}")
                                except Exception as e:
                                    logger.warning(f"Failed to re-register {scrip_key}: {e}")
        except Exception as e:
            logger.error(f"Failed during subscription process: {e}")

    def _load_initial_index_data(self):
        discovered_indices = {}
        latest_indices = {}
        catalog_items = []

        try:
            for exchange, entries in MO_INDEX_CATALOG.items():
                for catalog_entry in entries:
                    code = str(catalog_entry.get('code') or '').strip()
                    name = catalog_entry.get('name') or f"{exchange}:{code}"

                    if not code:
                        continue

                    discovered_indices[code] = {
                        'name': name,
                        'exchange': exchange,
                    }
                    catalog_items.append((exchange, code, name))

            def _fetch_one(item):
                exchange, code, name = item
                try:
                    ltp_resp = self.mo_api.get_index_ltp(exchange, int(code))
                    ltp_data = _normalize_index_payload(ltp_resp)
                    price = _extract_number(ltp_data, PRICE_KEYS)
                    prev_close = _extract_number(ltp_data, PREV_CLOSE_KEYS)
                    change = _extract_number(ltp_data, CHANGE_KEYS)
                    percent_change = _extract_number(ltp_data, PERCENT_KEYS)

                    if (change is None or percent_change is None) and price and prev_close and prev_close > 0:
                        change = price - prev_close
                        percent_change = (change / prev_close) * 100.0

                    if not price or price <= 0:
                        return None

                    return {
                        'symbol': f"{exchange}:{code}",
                        'prev_close': prev_close,
                        'payload': {
                            'name': name,
                            'symbol': f"{exchange}:{code}",
                            'price': round(float(price), 2),
                            'change': round(float(change or 0.0), 2),
                            'percent_change': round(float(percent_change or 0.0), 2),
                            'last_updated': int(time.time() * 1000),
                            'entityType': 'index',
                        }
                    }
                except Exception as exc:
                    logger.warning("Failed to bootstrap index payload for %s:%s: %s", exchange, code, exc)
                    return None

            if catalog_items:
                max_workers = min(INDEX_BOOTSTRAP_MAX_WORKERS, len(catalog_items))
                executor = ThreadPoolExecutor(max_workers=max_workers)
                futures = {executor.submit(_fetch_one, item): item for item in catalog_items}
                timed_out = False
                try:
                    for future in as_completed(futures, timeout=20):
                        result = future.result()
                        if not result:
                            continue

                        prev_close = result.get('prev_close')
                        symbol = result.get('symbol')
                        if prev_close and prev_close > 0:
                            self.scrip_prev_close[symbol] = prev_close

                        payload = result.get('payload')
                        if payload:
                            latest_indices[symbol] = payload
                except FuturesTimeoutError:
                    timed_out = True
                    logger.warning(
                        "Timed out bootstrapping index cache; loaded partial values (%d/%d).",
                        len(latest_indices),
                        len(futures),
                    )
                    for future in futures:
                        if not future.done():
                            future.cancel()
                finally:
                    executor.shutdown(wait=not timed_out, cancel_futures=timed_out)
        except Exception as e:
            logger.warning(f"Failed to bootstrap tracked index values: {e}")

        self.index_codes_map = discovered_indices
        with self.data_lock:
            self.latest_indices_data = OrderedDict()
            for symbol, payload in latest_indices.items():
                self._upsert_index_cache_locked(symbol, payload)
        logger.info(f"Loaded {len(self.index_codes_map)} tracked indices with {len(self.latest_indices_data)} initial values.")

    def _heartbeat_loop(self):
        """Monitors WebSocket connection health by checking data receipt timeout."""
        logger.info("Heartbeat monitor started")
        
        while not self.stop_event.is_set():
            try:
                if self.is_connected and self.ws_authed:
                    current_time = time.time()
                    
                    # Check for heartbeat timeout (no data received)
                    if self.last_heartbeat_received:
                        silence_duration = current_time - self.last_heartbeat_received
                        if silence_duration > self.heartbeat_timeout:
                            logger.error(f"❌ Heartbeat timeout: No data received for {silence_duration:.0f}s. Forcing reconnect...")
                            if self.mo_api.ws:
                                self.mo_api.ws.close()
                            self.is_connected = False
                            self.ws_authed = False
                
                self.stop_event.wait(10)  # Check every 10 seconds
                
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}", exc_info=True)
                self.stop_event.wait(10)
    
    def _batch_emitter_loop(self):
        logger.info("Batch emitter started")
        
        while not self.stop_event.is_set():
            try:
                self.stop_event.wait(self.batch_interval)
                
                if not self.socketio:
                    continue
                
                with self.batch_lock:
                    if self.pending_stock_updates:
                        stock_batch = list(self.pending_stock_updates.values())
                        self.pending_stock_updates.clear()
                        self.socketio.emit('stock_updates_batch', {'updates': stock_batch})
                        logger.debug(f"Emitted batch of {len(stock_batch)} stock updates")
                    
                    if self.pending_index_updates:
                        index_batch = list(self.pending_index_updates.values())
                        self.pending_index_updates.clear()
                        self.socketio.emit('index_updates_batch', {'updates': index_batch})
                        logger.debug(f"Emitted batch of {len(index_batch)} index updates")
                
            except Exception as e:
                logger.error(f"Error in batch emitter loop: {e}", exc_info=True)
                self.stop_event.wait(1)

    def get_latest_indices_data(self):
        with self.data_lock:
            self._prune_cache_locked(self.latest_indices_data, INDEX_CACHE_TTL_SECONDS, INDEX_CACHE_MAX_SIZE)
            return [payload.copy() for payload in self.latest_indices_data.values()]

    def register_symbols_for_realtime(self, symbols):
        if not symbols:
            return 0

        try:
            from app.models import Stock

            unique_symbols = {str(s).strip() for s in symbols if s}
            unique_symbols.discard('')
            if not unique_symbols:
                return 0

            stocks = list(
                Stock.objects(symbol__in=list(unique_symbols))
                .only('symbol', 'exchange', 'scripcode')
            )
            if not stocks:
                return 0

            registered = 0
            for stock in stocks:
                try:
                    exchange = (getattr(stock, 'exchange', None) or 'NSE').upper()
                    raw_scripcode = getattr(stock, 'scripcode', None)
                    if raw_scripcode is None:
                        continue
                    scripcode = int(raw_scripcode)
                    composite_key = f"{exchange}:CASH:{scripcode}"
                    if composite_key in self.registered_scrips:
                        continue

                    self.register_scrip(stock.symbol, exchange, scripcode)
                    registered += 1
                except Exception as e:
                    logger.warning(
                        "Failed to register symbol %s for realtime: %s",
                        getattr(stock, 'symbol', '?'),
                        e,
                    )

            if registered:
                logger.info("Registered %s new portfolio/adhoc symbol(s) for live updates", registered)
            return registered
        except Exception as e:
            logger.error("Failed to register symbols for realtime: %s", e, exc_info=True)
            return 0

    def register_user_portfolio_stocks(self, user_id):
        try:
            from app.models import Holding, ShortPosition

            user_id_str = str(user_id)

            holding_symbols = list(
                Holding.objects(user=user_id, quantity__gt=0)
                .only('symbol')
                .scalar('symbol')
            )
            short_symbols = list(
                ShortPosition.objects(user=user_id, is_active=True)
                .only('symbol')
                .scalar('symbol')
            )

            symbols = [s for s in (holding_symbols + short_symbols) if s]
            if not symbols:
                return 0

            registered = self.register_symbols_for_realtime(symbols)

            with self.subscription_lock:
                current = set(self.user_subscriptions.get(user_id_str, set()))
                self.user_subscriptions[user_id_str] = current

            return registered
        except Exception as e:
            logger.error("Failed to register portfolio stocks for user %s: %s", user_id, e, exc_info=True)
            return 0
    
    def register_user_watchlist_stocks(self, user_id):
        try:
            from app.models import User
            
            user = User.objects(id=user_id).only('watchlists__stocks').first()
            if not user:
                logger.warning(f"User {user_id} not found while registering watchlist stocks.")
                return 0
            
            user_id_str = str(user_id)
            stocks_registered = 0
            user_scrips = set()
            
            for watchlist in getattr(user, 'watchlists', []) or []:
                for stock in getattr(watchlist, 'stocks', []) or []:
                    if stock and stock.symbol:
                        try:
                            exchange = (getattr(stock, 'exchange', None) or 'NSE').upper()
                            raw_scripcode = getattr(stock, 'scripcode', None)
                            if raw_scripcode is None:
                                continue
                            scripcode = int(raw_scripcode)
                            
                            composite_key = f"{exchange}:CASH:{scripcode}"
                            user_scrips.add(composite_key)
                            
                            if composite_key not in self.registered_scrips:
                                self.register_scrip(stock.symbol, exchange, scripcode)
                                stocks_registered += 1
                            else:
                                if stock.symbol not in self.latest_stock_data:
                                    self._enqueue_warm_scrip_initial_data(stock.symbol, exchange, scripcode)
                                logger.debug(f"Stock {stock.symbol} already subscribed, skipping duplicate")
                        except Exception as e:
                            logger.warning(f"Failed to register stock {getattr(stock, 'symbol', '?')}: {e}")
            
            with self.subscription_lock:
                self.user_subscriptions[user_id_str] = user_scrips
                logger.debug(f"Stored {len(user_scrips)} user_subscriptions for user {user_id_str}")

            if stocks_registered > 0:
                logger.info(f"Registered {stocks_registered} new watchlist stock(s) for user {user_id_str}")
            return stocks_registered
            
        except Exception as e:
            logger.error(f"Failed to register watchlist stocks for user {user_id}: {e}", exc_info=True)
            return 0