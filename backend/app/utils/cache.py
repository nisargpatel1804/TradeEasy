"""
Simple in-memory caching utility for Flask routes
"""
import time
import functools
import logging
from threading import Lock

logger = logging.getLogger(__name__)


class SimpleCache:
    """Thread-safe in-memory cache with TTL support."""
    
    def __init__(self):
        self._cache = {}
        self._lock = Lock()
    
    def get(self, key):
        """Get a value from cache if it exists and hasn't expired."""
        with self._lock:
            if key not in self._cache:
                return None
            
            entry = self._cache[key]
            if time.time() > entry['expires_at']:
                del self._cache[key]
                return None
            
            return entry['value']
    
    def set(self, key, value, ttl=300):
        """Set a value in cache with TTL in seconds (default 5 minutes)."""
        with self._lock:
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


# Global cache instance
cache = SimpleCache()


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
            # Generate cache key from function name and arguments
            cache_key = f"{key_prefix}:{func.__name__}:"
            cache_key += ':'.join(str(arg) for arg in args)
            if kwargs:
                cache_key += ':' + ':'.join(f"{k}={v}" for k, v in sorted(kwargs.items()))
            
            # Try to get from cache
            cached_value = cache.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache HIT for {cache_key}")
                return cached_value
            
            # Cache miss - call function and cache result
            logger.debug(f"Cache MISS for {cache_key}")
            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl)
            return result
        
        return wrapper
    return decorator


def cached_route(ttl=300, key_func=None):
    """
    Decorator to cache Flask route responses.
    
    Args:
        ttl: Time to live in seconds
        key_func: Optional function to generate cache key from request
                  If None, uses current_user.id from flask_login
    
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
            from flask_login import current_user
            
            # Generate cache key
            if key_func:
                cache_key = key_func()
            elif current_user and hasattr(current_user, 'id'):
                cache_key = f"route:{func.__name__}:user:{current_user.id}"
            else:
                # No caching if no user context
                return func(*args, **kwargs)
            
            # Try cache
            cached_response = cache.get(cache_key)
            if cached_response is not None:
                logger.debug(f"Route cache HIT for {cache_key}")
                return cached_response
            
            # Execute route and cache
            logger.debug(f"Route cache MISS for {cache_key}")
            response = func(*args, **kwargs)
            
            # Only cache successful responses (status 200-299)
            if hasattr(response, 'status_code'):
                if 200 <= response.status_code < 300:
                    cache.set(cache_key, response, ttl)
            elif isinstance(response, tuple) and len(response) == 2:
                # Handle (response, status_code) tuple
                if 200 <= response[1] < 300:
                    cache.set(cache_key, response, ttl)
            else:
                cache.set(cache_key, response, ttl)
            
            return response
        
        return wrapper
    return decorator
