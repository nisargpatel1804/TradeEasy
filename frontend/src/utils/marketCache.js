/**
 * Module-level singleton cache for market (Nifty 50 movers) data.
 * Lives for the page session — resets on full page refresh, zero serialization overhead.
 * TTL mirrors backend: 30 s when market is open, 300 s when closed.
 */
const TTL_OPEN_MS   = 30  * 1000;   // 30 s
const TTL_CLOSED_MS = 300 * 1000;   // 5 min

const _cache = {
  data:       null,
  ts:         0,
  marketOpen: null,
};

const MarketCache = {
  /** Return cached response object, or null if cache is empty. */
  get() {
    return _cache.data;
  },

  /**
   * Store a fresh API response.
   * @param {object}  data         - Full API response to cache.
   * @param {boolean} isMarketOpen - Whether the market was open when data was fetched.
   */
  set(data, isMarketOpen) {
    _cache.data       = data;
    _cache.ts         = Date.now();
    _cache.marketOpen = Boolean(isMarketOpen);
  },

  /**
   * Is the cached data still fresh enough to serve without a network request?
   * @param {boolean|null} isMarketOpen - Current market-open status.
   *   Pass null to fall back to the flag stored during the last set() call.
   */
  isValid(isMarketOpen = null) {
    if (!_cache.data || !_cache.ts) return false;
    const open = isMarketOpen !== null ? isMarketOpen : _cache.marketOpen;
    const ttl  = open ? TTL_OPEN_MS : TTL_CLOSED_MS;
    return (Date.now() - _cache.ts) < ttl;
  },

  /** Evict the cache (e.g. on forced refresh). */
  clear() {
    _cache.data       = null;
    _cache.ts         = 0;
    _cache.marketOpen = null;
  },
};

export default MarketCache;
