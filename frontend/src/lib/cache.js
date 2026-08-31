/**
 * Unified in-memory cache utility for the frontend.
 */

// --- General Purpose TTL Cache ---
class SimpleCache {
  constructor() {
    this.cache = new Map();
    this.timers = new Map();
  }

  set(key, value, ttl = 300) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl * 1000,
    });
    if (ttl > 0) {
      const timer = setTimeout(() => this.delete(key), ttl * 1000);
      this.timers.set(key, timer);
    }
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.timestamp;
    if (entry.ttl > 0 && age > entry.ttl) {
      this.delete(key);
      return null;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    this.cache.delete(key);
  }

  clear() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.cache.clear();
    this.timers.clear();
  }
}

export const cache = new SimpleCache();

// --- Dedicated Market (Nifty 50) Cache ---
const TTL_OPEN_MS = 30 * 1000;   // 30 seconds during live market
const TTL_CLOSED_MS = 300 * 1000; // 5 mins when market closed

const _marketCacheState = {
  data: null,
  ts: 0,
  marketOpen: null,
};

export const MarketCache = {
  get() {
    return _marketCacheState.data;
  },
  set(data, isMarketOpen) {
    _marketCacheState.data = data;
    _marketCacheState.ts = Date.now();
    _marketCacheState.marketOpen = Boolean(isMarketOpen);
  },
  isValid(isMarketOpen = null) {
    if (!_marketCacheState.data || !_marketCacheState.ts) return false;
    const open = isMarketOpen !== null ? isMarketOpen : _marketCacheState.marketOpen;
    const ttl = open ? TTL_OPEN_MS : TTL_CLOSED_MS;
    return (Date.now() - _marketCacheState.ts) < ttl;
  },
  clear() {
    _marketCacheState.data = null;
    _marketCacheState.ts = 0;
    _marketCacheState.marketOpen = null;
  },
};

export default cache;