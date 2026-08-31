"""
Shared exports and singleton helpers for Motilal Oswal integration.
Ensures a single, thread-safe API client is reused across the application.
"""

from threading import Lock

from .mo_api import MotilalOswalAPI
from .packet_parser import MOPacketParser

__all__ = ["MotilalOswalAPI", "MOPacketParser", "get_mo_api_client"]

_client_instance = None
_client_lock = Lock()


def get_mo_api_client() -> MotilalOswalAPI:
    """
    Returns a process-wide MotilalOswalAPI client instance (lazy singleton).
    Uses double-checked locking to ensure thread safety during initialization.
    """
    global _client_instance
    if _client_instance is None:
        with _client_lock:
            if _client_instance is None:
                _client_instance = MotilalOswalAPI()
    return _client_instance