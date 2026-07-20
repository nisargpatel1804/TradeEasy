import os
import re
import uuid
import socket
import platform
import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, time as dt_time
from struct import pack
from typing import Any, Callable, Dict, Optional

import pyotp
import requests
import websocket
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from zoneinfo import ZoneInfo

# --- Logging configuration -------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


@dataclass
class ClientDeviceInfo:
    """Captures the per-client metadata required by MO OpenAPI headers."""

    local_ip: str
    public_ip: str
    mac_address: str
    source_id: str
    vendor_info: str
    os_name: str
    os_version: str
    device_model: str
    manufacturer: str
    product_name: str
    product_version: str
    installed_app_id: str
    browser_name: Optional[str] = None
    browser_version: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None

    def to_headers(self) -> Dict[str, str]:
        headers = {
            "ClientLocalIp": self.local_ip,
            "ClientPublicIp": self.public_ip,
            "MacAddress": self.mac_address,
            "SourceId": self.source_id,
            "vendorinfo": self.vendor_info,
            "osname": self.os_name,
            "osversion": self.os_version,
            "devicemodel": self.device_model,
            "manufacturer": self.manufacturer,
            "productname": self.product_name,
            "productversion": self.product_version,
            "installedappid": self.installed_app_id,
        }

        if self.source_id == "WEB":
            headers["browsername"] = self.browser_name or "Chrome"
            headers["browserversion"] = self.browser_version or "105.0"

        if self.latitude and self.longitude:
            headers["latitude"] = self.latitude
            headers["longitude"] = self.longitude

        return headers


class MarketHoursManager:
    """Utility that understands basic Indian market hours and holidays."""

    def __init__(self) -> None:
        self.ist_tz = ZoneInfo("Asia/Kolkata")
        self.market_open = dt_time(9, 15)
        self.market_close = dt_time(15, 30)
        self.holidays = {
            "2025-01-26", "2025-03-14", "2025-04-14", "2025-05-01",
            "2025-08-15", "2025-10-02", "2025-11-01", "2025-11-15", "2025-12-25",
        }

    def is_market_open(self) -> bool:
        now_ist = datetime.now(self.ist_tz)
        if now_ist.weekday() >= 5 or now_ist.date().isoformat() in self.holidays:
            return False
        return self.market_open <= now_ist.time() <= self.market_close


class MotilalOswalAPI:
    """High-fidelity Motilal Oswal OpenAPI client aligned with official specs."""

    REST_BASE_URL = "https://openapi.motilaloswal.com/rest"
    WEBSOCKET_URL = "wss://ws1feed.motilaloswal.com/jwebsocket/jwebsocket"
    WEBSOCKET_VERSION = "VER 2.0"

    REST_ENDPOINTS = {
        "login": "/login/v7/authdirectapi",
        "logout": "/login/v5/logout",
        "profile": "/login/v5/getprofile",
        "ltp": "/report/v3/getltpdata",
        "scrips": "/report/v3/getscripsbyexchangename",
        "eod": "/report/v3/geteoddatabyexchangename",
        "index_master": "/report/v3/getindexdatabyexchangename",
        "index_ltp": "/report/v3/getindexltpdata",
        "get_access_token": "/login/v1/getaccesstoken",
    }

    EXCHANGE_CODES = {
        "NSE": "N",
        "BSE": "B",
        "NSEFO": "N",
        "BSEFO": "G",
        "MCX": "M",
        "NSECD": "C",
        "NCDEX": "D",
    }

    INDEX_CODES = {
        "NSE": "N",
        "BSE": "B",
    }

    EXCHANGE_TYPE_CODES = {
        "CASH": "C",
        "DERIVATIVES": "D",
    }

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        load_dotenv()

        self.user_id = self._require_env("USER_ID")
        self.password = self._require_env("PASSWORD")
        self.api_key = self._require_env("API_KEY")
        self.api_secret_key = os.getenv("API_SECRET_KEY")
        self.two_fa = self._require_env("TWO_FA")
        self.totp_secret = os.getenv("TOTP_SECRET")

        if self.api_secret_key and not self._is_valid_secret_key(self.api_secret_key):
            logger.warning("API_SECRET_KEY format looks suspicious (expected UUID or 32-char string). Login may fail.")

        if not self.api_secret_key:
            logger.warning("API_SECRET_KEY not set. v7 login will fail.")
        if not self.totp_secret:
            logger.warning("TOTP_SECRET not provided. Falling back to OTP flow where applicable.")

        self.vendor_info = os.getenv("MO_VENDOR_INFO", self.user_id)
        self.source_id = os.getenv("MO_SOURCE_ID", "WEB").strip().upper() or "WEB"
        self.base_url = self._normalise_base_url(os.getenv("MO_BASE_URL", self.REST_BASE_URL))

        self.session = session or requests.Session()
        self._configure_http_pool()
        connect_timeout = float(os.getenv("MO_API_CONNECT_TIMEOUT", "10"))
        read_timeout = float(os.getenv("MO_API_READ_TIMEOUT", os.getenv("MO_API_TIMEOUT", "30")))
        self.request_timeout = (connect_timeout, read_timeout)

        self.device_info = self._build_device_info()

        self.auth_token: Optional[str] = None
        self.access_token: Optional[str] = None
        self.last_login_at: Optional[datetime] = None
        self.auth_ttl_seconds = int(os.getenv("MO_AUTH_TTL_SECONDS", "3300"))
        self._auth_lock = threading.Lock()
        self._access_token_lock = threading.Lock()
        self._login_in_progress = threading.Event()
        self._static_price_cache: Dict[str, Dict[str, Any]] = {}  # Fallback cache
        self._static_cache_lock = threading.Lock()

        self._cache_lock = threading.Lock()
        self._response_cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
        self._endpoint_cache_ttl = {
            self.REST_ENDPOINTS["ltp"]: int(os.getenv("MO_CACHE_LTP_TTL", "2")),
            self.REST_ENDPOINTS["eod"]: int(os.getenv("MO_CACHE_EOD_TTL", "60")),
            self.REST_ENDPOINTS["index_master"]: int(os.getenv("MO_CACHE_INDEX_MASTER_TTL", "60")),
            self.REST_ENDPOINTS["index_ltp"]: int(os.getenv("MO_CACHE_INDEX_LTP_TTL", "5")),
            self.REST_ENDPOINTS["scrips"]: int(os.getenv("MO_CACHE_SCRIPS_TTL", "300")),
        }

        self.ws: Optional[websocket.WebSocketApp] = None
        self.ws_thread: Optional[threading.Thread] = None
        self.registered_scrips: set[str] = set()
        self.registered_indices: set[str] = set()

        self.market_hours = MarketHoursManager()

        self._update_headers()

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------
    @staticmethod
    def _is_valid_secret_key(key: str) -> bool:
        if not key:
            return False
        uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
        if uuid_pattern.match(key):
            return True
        if re.match(r'^[A-Z2-7]{32}$', key):
            return True
        return False

    def _configure_http_pool(self) -> None:
        pool_connections = int(os.getenv("MO_HTTP_POOL_CONNECTIONS", "60"))
        pool_maxsize = int(os.getenv("MO_HTTP_POOL_MAXSIZE", "60"))
        pool_block = os.getenv("MO_HTTP_POOL_BLOCK", "true").strip().lower() in {"1", "true", "yes", "on"}
        adapter = HTTPAdapter(
            pool_connections=pool_connections,
            pool_maxsize=pool_maxsize,
            pool_block=pool_block,
        )
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    @staticmethod
    def _require_env(key: str) -> str:
        value = os.getenv(key)
        if not value:
            raise ValueError(f"Environment variable '{key}' must be set for Motilal Oswal API integration.")
        return value.strip()

    @staticmethod
    def _normalise_base_url(url: str) -> str:
        url = url.rstrip("/")
        if not url.endswith("/rest"):
            return f"{url}/rest"
        return url

    def _build_device_info(self) -> ClientDeviceInfo:
        local_ip = os.getenv("MO_CLIENT_LOCAL_IP") or socket.gethostbyname(socket.gethostname())
        public_ip = os.getenv("MO_CLIENT_PUBLIC_IP") or "1.2.3.4"
        mac_address = os.getenv("MO_CLIENT_MAC") or ":".join(re.findall("..", f"{uuid.getnode():012x}"))

        os_name = os.getenv("MO_OS_NAME") or platform.system()
        os_version = os.getenv("MO_OS_VERSION") or platform.version()
        device_model = os.getenv("MO_DEVICE_MODEL") or platform.node() or "Generic"
        manufacturer = os.getenv("MO_DEVICE_MANUFACTURER") or "Generic"
        product_name = os.getenv("MO_PRODUCT_NAME") or "TradeEasy"
        product_version = os.getenv("MO_PRODUCT_VERSION") or "1.0.0"
        installed_app_id = os.getenv("MO_INSTALLED_APP_ID") or str(uuid.uuid4())

        browser_name = os.getenv("MO_BROWSER_NAME") or "Chrome"
        browser_version = os.getenv("MO_BROWSER_VERSION") or "105.0"

        latitude = os.getenv("MO_LATITUDE")
        longitude = os.getenv("MO_LONGITUDE")

        return ClientDeviceInfo(
            local_ip=local_ip,
            public_ip=public_ip,
            mac_address=mac_address,
            source_id=self.source_id,
            vendor_info=self.vendor_info,
            os_name=os_name,
            os_version=os_version,
            device_model=device_model,
            manufacturer=manufacturer,
            product_name=product_name,
            product_version=product_version,
            installed_app_id=installed_app_id,
            browser_name=browser_name,
            browser_version=browser_version,
            latitude=latitude,
            longitude=longitude,
        )

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def _update_headers(self, auth_token: Optional[str] = None) -> None:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "MOSL/V.1.1.0",
            "ApiKey": self.api_key,
            "SourceId": self.device_info.source_id,
            "sdkversion": "Python 3.0",
        }

        if self.api_secret_key:
            headers["apisecretkey"] = self.api_secret_key

        if self.access_token:
            headers["accesstoken"] = self.access_token

        headers.update(self.device_info.to_headers())

        if auth_token:
            headers["Authorization"] = auth_token

        self.session.headers.clear()
        self.session.headers.update(headers)

    def _request(
        self,
        method: str,
        endpoint: str,
        payload: Optional[Dict[str, Any]] = None,
        require_auth: bool = True,
        retry_on_auth: bool = True,
    ) -> Optional[Dict[str, Any]]:
        try:
            if require_auth and not self._ensure_authenticated():
                return None

            url = f"{self.base_url}{endpoint}"
            response = self.session.request(method, url, json=payload or {}, timeout=self.request_timeout)
            response.raise_for_status()
            data = response.json()

            if isinstance(data, dict) and data.get("status") == "FAILURE":
                error_code = data.get("errorcode")
                if retry_on_auth and (error_code == "MO8002" or response.status_code == 401):
                    logger.warning("Token expired or invalid. Re-authenticating and retrying.")
                    self.auth_token = None
                    self.access_token = None
                    self.last_login_at = None
                    if self._ensure_authenticated():
                        return self._request(method, endpoint, payload, require_auth, retry_on_auth=False)
                logger.warning("MO API call failed (%s): %s | %s", endpoint, data.get("message"), error_code)
            return data
        except requests.exceptions.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else 0
            if status_code == 404:
                logger.debug("HTTP 404 for %s (endpoint unavailable, likely outside market hours)", url)
            elif status_code >= 500:
                logger.error("HTTP %s server error while calling %s: %s", status_code, url, exc)
            else:
                logger.warning("HTTP %s error while calling %s: %s", status_code, url, exc)
            return None
        except requests.exceptions.RequestException as exc:
            logger.warning("Request error while calling %s: %s", url, exc)
            return None

    def _ensure_authenticated(self) -> bool:
        if self._is_auth_valid():
            return True
        response = self.login()
        return bool(response and response.get("status") == "SUCCESS")

    def _is_auth_valid(self) -> bool:
        if not self.auth_token or not self.last_login_at:
            return False
        age_seconds = (datetime.now() - self.last_login_at).total_seconds()
        return age_seconds < self.auth_ttl_seconds

    def _build_cache_key(self, endpoint: str, payload: Optional[Dict[str, Any]]) -> str:
        serialized = json.dumps(payload or {}, sort_keys=True, separators=(",", ":"), default=str)
        hash_digest = hashlib.md5(serialized.encode('utf-8')).hexdigest()[:16]
        return f"{endpoint}:{hash_digest}"

    def _cached_request(
        self,
        method: str,
        endpoint: str,
        payload: Optional[Dict[str, Any]] = None,
        require_auth: bool = True,
    ) -> Optional[Dict[str, Any]]:
        ttl = self._endpoint_cache_ttl.get(endpoint, 0)
        if ttl <= 0:
            return self._request(method, endpoint, payload, require_auth=require_auth)

        now = time.time()
        cache_key = self._build_cache_key(endpoint, payload)

        with self._cache_lock:
            cached = self._response_cache.get(cache_key)
            if cached:
                cached_at, cached_data = cached
                if now - cached_at < ttl:
                    return cached_data

        data = self._request(method, endpoint, payload, require_auth=require_auth)
        if data and isinstance(data, dict) and data.get("status") == "SUCCESS":
            with self._cache_lock:
                self._response_cache[cache_key] = (now, data)
            return data
        else:
            # Log the failure reason
            logger.error(f"Failed to fetch data from {endpoint}: {data if data else 'No response'}")
            return None

    def _generate_totp_code(self, time_offset: int = 0) -> Optional[str]:
        if not self.totp_secret:
            return None
        totp = pyotp.TOTP(self.totp_secret)
        current_time = time.time() + time_offset
        current_code = totp.at(int(current_time))
        logger.debug("Generated TOTP at timestamp: %s (offset: %ss)", int(current_time), time_offset)
        return current_code

    # ------------------------------------------------------------------
    # Authentication & session APIs
    # ------------------------------------------------------------------
    def get_access_token(self) -> Optional[str]:
        if not self.auth_token:
            logger.warning("Cannot get access token: no auth token available.")
            return None

        with self._access_token_lock:
            if self.access_token:
                return self.access_token

            old_headers = self.session.headers.copy()
            self._update_headers(self.auth_token)
            try:
                response = self._request("POST", self.REST_ENDPOINTS["get_access_token"], require_auth=True)
            finally:
                self.session.headers.update(old_headers)

            if response and response.get("status") == "SUCCESS":
                token = response.get("accesstoken")
                if token:
                    self.access_token = token
                    self._update_headers(self.auth_token)
                    logger.info("Access token obtained successfully.")
                    return token
            logger.error("Failed to obtain access token: %s", response.get("message") if response else "No response")
            return None

    def login(self, totp_code: Optional[str] = None, two_fa: Optional[str] = None, retry_count: int = 0) -> Optional[Dict[str, Any]]:
        with self._auth_lock:
            if self._is_auth_valid() and not totp_code and not two_fa and retry_count == 0:
                return {"status": "SUCCESS", "message": "Using existing authenticated session", "AuthToken": self.auth_token}

        if self._login_in_progress.is_set():
            logger.debug("Login already in progress, waiting...")
            self._login_in_progress.wait()
            with self._auth_lock:
                if self.auth_token:
                    return {"status": "SUCCESS", "AuthToken": self.auth_token}

        self._login_in_progress.set()
        try:
            hashed_password = hashlib.sha256((self.password + self.api_key).encode("utf-8")).hexdigest()
            payload: Dict[str, Any] = {
                "userid": self.user_id,
                "password": hashed_password,
                "2FA": two_fa or self.two_fa,
            }

            time_offsets = [0, -30, 30] if retry_count == 0 else [0]
            response = None

            for offset in time_offsets:
                if totp_code is None or retry_count > 0:
                    totp_code = self._generate_totp_code(time_offset=offset)

                if totp_code:
                    payload["totp"] = str(totp_code)
                    if offset != 0:
                        logger.info(f"Trying TOTP with {offset:+d}s time offset...")
                else:
                    logger.warning("No TOTP code available - login may require OTP verification")

                response = self._request("POST", self.REST_ENDPOINTS["login"], payload, require_auth=False)

                if response and response.get("status") == "SUCCESS":
                    self.auth_token = response.get("AuthToken")
                    self.last_login_at = datetime.now()
                    self.get_access_token()
                    self._update_headers(self.auth_token)
                    if offset != 0:
                        logger.info(f"✅ Authenticated successfully with {offset:+d}s time offset")
                    else:
                        logger.info("✅ Authenticated with Motilal Oswal OpenAPI successfully")
                    return response
                elif response and response.get("errorcode") == "MO1093" and offset != time_offsets[-1]:
                    logger.debug(f"TOTP failed with {offset:+d}s offset, trying next...")
                    totp_code = None
                    continue
                else:
                    break

            self.auth_token = None
            if response:
                error_code = response.get("errorcode")
                error_msg = response.get("message")
                if error_code == "MO1093":
                    logger.error(
                        "❌ Login failed - INVALID TOTP: %s | Error: %s\n"
                        "  1. Verify system time is synchronized\n"
                        "  2. Confirm TOTP_SECRET in .env matches your MO profile\n"
                        "  3. Try regenerating TOTP_SECRET",
                        error_msg, error_code
                    )
                else:
                    logger.error("❌ Login failed: %s | Error Code: %s", error_msg, error_code)
            else:
                logger.error("❌ Login failed: No response returned from API")
            return response
        finally:
            self._login_in_progress.clear()

    def logout(self) -> Optional[Dict[str, Any]]:
        response = self._request("POST", self.REST_ENDPOINTS["logout"], {"userid": self.user_id})
        if response and response.get("status") == "SUCCESS":
            self.auth_token = None
            self.access_token = None
            self.last_login_at = None
            with self._cache_lock:
                self._response_cache.clear()
            self._update_headers()
        return response

    def get_profile(self, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {"clientcode": clientcode or self.user_id} if clientcode or self.user_id else {}
        return self._request("POST", self.REST_ENDPOINTS["profile"], payload)

    # ------------------------------------------------------------------
    # Market data REST endpoints (clientcode is optional – do NOT auto‑add)
    # ------------------------------------------------------------------
    def get_scrips_by_exchange(self, exchangename: str, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {"exchangename": exchangename.upper()}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._cached_request("POST", self.REST_ENDPOINTS["scrips"], payload)

    def get_ltp_data(self, exchange: str, scripcode: int, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {
            "exchange": exchange.upper(),
            "scripcode": int(scripcode),
        }
        if clientcode:
            payload["clientcode"] = clientcode
        return self._cached_request("POST", self.REST_ENDPOINTS["ltp"], payload)

    def get_eod_data(self, exchangename: str, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {"exchangename": exchangename.upper()}
        if clientcode:
            payload["clientcode"] = clientcode
        # Log the request for debugging
        logger.debug(f"Fetching EOD data for {exchangename} with payload {payload}")
        result = self._cached_request("POST", self.REST_ENDPOINTS["eod"], payload)
        if result is None:
            logger.error(f"EOD request for {exchangename} returned None")
        elif result.get("status") != "SUCCESS":
            logger.error(f"EOD API error: {result.get('message')} (code {result.get('errorcode')})")
        return result

    def get_index_data(self, exchangename: str, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {"exchangename": exchangename.upper()}
        if clientcode:
            payload["clientcode"] = clientcode
        return self._cached_request("POST", self.REST_ENDPOINTS["index_master"], payload)

    def get_index_ltp(self, exchange: str, scripcode: int, clientcode: Optional[str] = None) -> Optional[Dict[str, Any]]:
        payload = {
            "exchangename": exchange.upper(),
            "scripcode": str(scripcode),
        }
        if clientcode:
            payload["clientcode"] = clientcode
        return self._cached_request("POST", self.REST_ENDPOINTS["index_ltp"], payload)

    # ------------------------------------------------------------------
    # WebSocket helpers
    # ------------------------------------------------------------------
    def connect_websocket(
        self,
        on_message: Callable[[websocket.WebSocketApp, bytes], None],
        on_open: Callable[[websocket.WebSocketApp], None],
        on_close: Callable[[websocket.WebSocketApp, int, str], None],
        on_error: Callable[[websocket.WebSocketApp, Exception], None],
    ) -> None:
        if not self._ensure_authenticated():
            logger.error("Authenticate before opening the Motilal Oswal WebSocket feed.")
            return

        if self.ws and self.ws.sock and self.ws.sock.connected:
            logger.info("WebSocket already connected; skipping new connection.")
            return

        self.ws = websocket.WebSocketApp(
            self.WEBSOCKET_URL,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )

        import ssl
        sslopt = {
            "cert_reqs": ssl.CERT_NONE,
            "check_hostname": False,
            "ssl_version": ssl.PROTOCOL_TLS
        }

        self.ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={
                "ping_interval": 20,
                "ping_timeout": 10,
                "sslopt": sslopt
            },
            daemon=True,
            name="MO-WebSocketThread",
        )
        self.ws_thread.start()
        logger.info("Started Motilal Oswal WebSocket thread -> %s", self.WEBSOCKET_URL)

    def disconnect_websocket(self) -> None:
        if self.ws:
            try:
                self.ws.close()
            finally:
                logger.info("Closed Motilal Oswal WebSocket connection.")
        if self.ws_thread and self.ws_thread.is_alive():
            self.ws_thread.join(timeout=5)
        self.ws = None
        self.ws_thread = None

    def send_binary_login(self) -> bool:
        if not self._ws_connected():
            logger.warning("Cannot send binary login; WebSocket is not connected.")
            return False

        try:
            clientcode = self.user_id
            version = self.WEBSOCKET_VERSION

            clientcode_buffer1 = clientcode.ljust(15, " ").encode("utf-8")
            clientcode_buffer2 = clientcode.ljust(30, " ").encode("utf-8")
            version_buffer = version.ljust(10, " ").encode("utf-8")
            padding = (" " * 45).encode("utf-8")

            login_packet = pack(
                "=cHB15sB30sBBBB10sBBBBB45s",
                b"Q",
                111,
                len(clientcode),
                clientcode_buffer1,
                len(clientcode),
                clientcode_buffer2,
                1,
                1,
                1,
                len(version),
                version_buffer,
                0,
                0,
                0,
                0,
                1,
                padding,
            )

            self.ws.send(login_packet, opcode=websocket.ABNF.OPCODE_BINARY)
            logger.info("Sent binary login handshake to MO WebSocket.")
            return True
        except Exception as exc:
            logger.error("Failed to send binary login packet: %s", exc)
            return False

    def register_scrip(self, exchange: str, scripcode: int, exchange_type: str = "CASH") -> bool:
        return self._toggle_scrip_subscription(exchange, exchange_type, scripcode, subscribe=True)

    def unregister_scrip(self, exchange: str, scripcode: int, exchange_type: str = "CASH") -> bool:
        return self._toggle_scrip_subscription(exchange, exchange_type, scripcode, subscribe=False)

    def _toggle_scrip_subscription(self, exchange: str, exchange_type: str, scripcode: int, subscribe: bool) -> bool:
        if not self._ws_connected():
            logger.warning("WebSocket not connected; cannot modify scrip subscriptions.")
            return False

        exchange_code = self.EXCHANGE_CODES.get(exchange.upper())
        exchange_type_code = self.EXCHANGE_TYPE_CODES.get(exchange_type.upper())
        if not exchange_code or not exchange_type_code:
            logger.error("Unsupported exchange (%s) or exchange type (%s)", exchange, exchange_type)
            return False

        key = f"{exchange.upper()}:{exchange_type.upper()}:{int(scripcode)}"
        if subscribe and key in self.registered_scrips:
            logger.debug("Scrip %s already registered on the WebSocket feed.", key)
            return True

        try:
            packet = pack("=cHcciB", b"D", 7, exchange_code.encode("ascii"), exchange_type_code.encode("ascii"), int(scripcode), 1 if subscribe else 0)
            self.ws.send(packet, opcode=websocket.ABNF.OPCODE_BINARY)

            if subscribe:
                self.registered_scrips.add(key)
                logger.info("Subscribed to %s via MO WebSocket.", key)
            else:
                self.registered_scrips.discard(key)
                logger.info("Unsubscribed from %s via MO WebSocket.", key)
            return True
        except Exception as exc:
            logger.error("Failed to toggle subscription for %s: %s", key, exc)
            return False

    def register_index(self, exchange: str) -> bool:
        return self._toggle_index_subscription(exchange, subscribe=True)

    def unregister_index(self, exchange: str) -> bool:
        return self._toggle_index_subscription(exchange, subscribe=False)

    def _toggle_index_subscription(self, exchange: str, subscribe: bool) -> bool:
        if not self._ws_connected():
            logger.warning("WebSocket not connected; cannot modify index subscriptions.")
            return False

        exchange_code = self.INDEX_CODES.get(exchange.upper())
        if not exchange_code:
            logger.error("Unsupported index exchange '%s'", exchange)
            return False

        key = f"{exchange.upper()}"
        if subscribe and key in self.registered_indices:
            logger.debug("Index %s already registered on the WebSocket feed.", key)
            return True

        try:
            packet = pack("=cHcB", b"I", 2, exchange_code.encode("ascii"), 1 if subscribe else 0)
            self.ws.send(packet, opcode=websocket.ABNF.OPCODE_BINARY)

            if subscribe:
                self.registered_indices.add(key)
                logger.info("Subscribed to %s index feed via MO WebSocket.", key)
            else:
                self.registered_indices.discard(key)
                logger.info("Unsubscribed from %s index feed via MO WebSocket.", key)
            return True
        except Exception as exc:
            logger.error("Failed to toggle index subscription for %s: %s", exchange, exc)
            return False

    def _ws_connected(self) -> bool:
        return bool(self.ws and self.ws.sock and self.ws.sock.connected)