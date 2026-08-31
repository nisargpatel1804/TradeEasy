"""
Simple thread-safe in-memory caching utility for Flask routes and service functions.
"""
import copy
import functools
import hashlib
import json
import logging
import time
from threading import Lock

logger = logging.getLogger(__name__)


class SimpleCache:
    """Thread-safe in-memory cache with TTL support and bounded capacity."""

    def __init__(self, max_entries: int = 1000):
        self._cache = {}
        self._lock = Lock()
        self.max_entries = max_entries

    def _evict_expired_or_oldest_locked(self):
        """Evicts expired items first; if still over capacity, removes the oldest entry."""
        now = time.time()
        expired_keys = [k for k, v in self._cache.items() if now > v['expires_at']]
        for key in expired_keys:
            del self._cache[key]

        # If still over capacity after clearing expired items, evict the oldest entry
        while len(self._cache) >= self.max_entries:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

    def get(self, key):
        """Get a deep-copied value from cache if it exists and hasn't expired."""
        with self._lock:
            if key not in self._cache:
                return None

            entry = self._cache[key]
            if time.time() > entry['expires_at']:
                del self._cache[key]
                return None

            # Return a deepcopy so caller mutations do not pollute cached memory
            try:
                return copy.deepcopy(entry['value'])
            except Exception:
                return entry['value']

    def set(self, key, value, ttl=300):
        """Set a value in cache with TTL in seconds (default 5 minutes)."""
        with self._lock:
            if key not in self._cache and len(self._cache) >= self.max_entries:
                self._evict_expired_or_oldest_locked()

            self._cache[key] = {
                'value': value,
                'expires_at': time.time() + ttl
            }

    def delete(self, key):
        """Delete a key from cache."""
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        """Clear all cache entries."""
        with self._lock:
            self._cache.clear()

    def invalidate_pattern(self, pattern):
        """Invalidate all keys matching a pattern (simple string prefix match)."""
        with self._lock:
            keys_to_delete = [k for k in self._cache.keys() if k.startswith(pattern)]
            for key in keys_to_delete:
                del self._cache[key]


# Global cache instance with a max limit of 1000 entries
cache = SimpleCache(max_entries=1000)


def cached(ttl=300, key_prefix=''):
    """
    Decorator to cache function results.

    Args:
        ttl: Time to live in seconds (default 300 = 5 minutes)
        key_prefix: Prefix for cache keys

    Example:
        @cached(ttl=60, key_prefix='user')
        def get_user_data(user_id):
            return expensive_db_query(user_id)
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Generate deterministic cache key using JSON serialization + short SHA256 hash
            try:
                key_payload = {
                    "args": args,
                    "kwargs": kwargs
                }
                serialized = json.dumps(key_payload, default=str, sort_keys=True, separators=(',', ':'))
                digest = hashlib.sha256(serialized.encode('utf-8')).hexdigest()[:16]
                cache_key = f"{key_prefix}:{func.__name__}:{digest}"
            except Exception as e:
                logger.exception("Failed to generate cache key, skipping cache: %s", e)
                return func(*args, **kwargs)

            # Try to get from cache (safe - don't fail caller on cache errors)
            try:
                cached_value = cache.get(cache_key)
            except Exception as e:
                logger.exception("Cache get failed for %s: %s", cache_key, e)
                cached_value = None

            if cached_value is not None:
                logger.debug(f"Cache HIT for {cache_key}")
                return cached_value

            # Cache miss - call function and cache result
            logger.debug(f"Cache MISS for {cache_key}")
            result = func(*args, **kwargs)
            try:
                cache.set(cache_key, result, ttl)
            except Exception as e:
                logger.exception("Cache set failed for %s: %s", cache_key, e)
            return result

        return wrapper
    return decorator


def cached_route(ttl=300, key_func=None):
    """
    Decorator to cache Flask route responses, dynamically taking request query args
    into account to prevent parameterized query collisions.

    Args:
        ttl: Time to live in seconds
        key_func: Optional function to generate cache key from request

    Example:
        @watchlist_bp.route('/watchlists')
        @login_required
        @cached_route(ttl=60)
        def get_watchlists():
            return jsonify(...)
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            from flask import request
            from flask_login import current_user

            # Generate cache key
            try:
                if key_func:
                    cache_key = key_func()
                else:
                    user_id = getattr(current_user, 'id', 'anonymous')
                    path = request.path if request else func.__name__
                    args_items = sorted(list(request.args.items())) if request else []

                    key_payload = {
                        "user": str(user_id),
                        "path": path,
                        "args": args_items
                    }
                    serialized = json.dumps(key_payload, default=str, sort_keys=True, separators=(',', ':'))
                    digest = hashlib.sha256(serialized.encode('utf-8')).hexdigest()[:12]
                    cache_key = f"route:{func.__name__}:{user_id}:{digest}"
            except Exception as e:
                logger.exception("Failed to build route cache key, skipping cache: %s", e)
                return func(*args, **kwargs)

            # Try cache (safe)
            try:
                cached_response = cache.get(cache_key)
            except Exception as e:
                logger.exception("Route cache get failed for %s: %s", cache_key, e)
                cached_response = None

            if cached_response is not None:
                logger.debug(f"Route cache HIT for {cache_key}")
                return cached_response

            # Execute route and cache
            logger.debug(f"Route cache MISS for {cache_key}")
            response = func(*args, **kwargs)

            # Only cache successful responses (status 200-299)
            try:
                if hasattr(response, 'status_code'):
                    if 200 <= response.status_code < 300:
                        cache.set(cache_key, response, ttl)
                elif isinstance(response, tuple) and len(response) == 2:
                    # Handle (response, status_code) tuple
                    if 200 <= response[1] < 300:
                        cache.set(cache_key, response, ttl)
                else:
                    cache.set(cache_key, response, ttl)
            except Exception as e:
                logger.exception("Route cache set failed for %s: %s", cache_key, e)

            return response

        return wrapper
    return decorator