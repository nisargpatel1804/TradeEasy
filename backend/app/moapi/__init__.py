"""Shared exports and singleton helpers for Motilal Oswal integration."""

from threading import Lock

from .mo_api import MotilalOswalAPI
from .packet_parser import MOPacketParser

_client_instance = None
_client_lock = Lock()


def get_mo_api_client() -> MotilalOswalAPI:
	"""Returns a process-wide MotilalOswalAPI client instance (lazy singleton)."""
	global _client_instance
	if _client_instance is None:
		with _client_lock:
			if _client_instance is None:
				_client_instance = MotilalOswalAPI()
	return _client_instance

