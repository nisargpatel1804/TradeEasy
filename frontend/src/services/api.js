import axios from "axios";
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  normalizeSearchQuery,
} from "../constants/search.js";

// --- Configuration ---

// Load API base URL from environment variables, with a fallback for local development.
// NOTE: In production we may intentionally set VITE_API_BASE_URL to an empty string
// to use same-origin requests (e.g., behind Vercel rewrites).
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

const isLocalhostBase = (value) => {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return (
    v === 'http://localhost:5000' ||
    v === 'http://127.0.0.1:5000' ||
    v.startsWith('http://localhost:') ||
    v.startsWith('http://127.0.0.1:')
  );
};

// In production on Vercel, `localhost` is never correct. If it's set accidentally,
// force same-origin so `/api/*` rewrites can work.
const API_BASE_URL = (import.meta.env.PROD && isLocalhostBase(rawApiBaseUrl))
  ? ""
  : (rawApiBaseUrl ?? (import.meta.env.PROD ? "" : "http://localhost:5000"));
const DEFAULT_TIMEOUT = 15000; // 15 seconds

/**
 * The configured Axios instance for all backend communication.
 * It includes the base URL, timeouts, and settings for handling credentials (cookies).
 */
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true, // Critical for Flask-Login session cookies
  timeout: DEFAULT_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
});

// --- Interceptors ---

let lastUnauthorizedDispatchAt = 0;
let unauthorizedDispatched = false;

const onApiSuccess = (response) => {
  unauthorizedDispatched = false;
  return response;
};

/**
 * Centralized API error handler.
 * Catches errors from all API responses and normalizes them.
 */
// small set used by the interceptor; defined once at module scope so we
// don't rebuild it every time an error is processed.
const _authPaths = new Set(['/check-auth', '/logout', '/login', '/signup']);

const handleApiError = (error) => {
  const originalRequest = error.config;

  const url = String(originalRequest?.url || "");

  // Prevent infinite loops on auth checks. (see _authPaths above)
  let isAuthEndpoint = false;
  for (const p of _authPaths) {
    if (url.includes(p)) {
      isAuthEndpoint = true;
      break;
    }
  }

  // Handle Session Expiry (401)
  if (error.response?.status === 401 && !isAuthEndpoint) {
    // Throttle to avoid storms when many requests fail at once.
    const now = Date.now();
    if (!unauthorizedDispatched && now - lastUnauthorizedDispatchAt > 1000) {
      lastUnauthorizedDispatchAt = now;
      unauthorizedDispatched = true;
      window.dispatchEvent(new CustomEvent('unauthorized'));
    }
  }

  // Extract a user-friendly error message
  const errorMessage =
    error.response?.data?.message ||
    error.message ||
    "An unexpected error occurred. Please try again.";

  // Create a normalized error object
  const apiError = new Error(errorMessage);
  apiError.status = error.response?.status;
  apiError.data = error.response?.data;
  apiError.code = error.code;
  apiError.originalError = error;

  return Promise.reject(apiError);
};

// Response Interceptor
apiClient.interceptors.response.use(
  onApiSuccess,
  handleApiError
);

// --- Helpers ---

// Generic helper to extract data from GET requests
const fetchData = async (endpoint, options = {}) => {
  const response = await apiClient.get(endpoint, options);
  return response.data;
};

// Simple retry wrapper for transient errors (network failures, 5xx errors). Uses exponential backoff.
const withRetry = async (fn, attempts = 2) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const responseStatus = err?.response?.status ?? err?.originalError?.response?.status ?? err?.status;
      // Do not retry if the request was intentionally cancelled/aborted
      if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError' || err?.name === 'CanceledError') {
        throw err;
      }
      // Retry on network errors (no response) or server 5xx
      if (!responseStatus || responseStatus >= 500 || err.code === 'ECONNABORTED') {
        const delay = 100 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
};

const parseRetryAfterMs = (retryAfterHeader) => {
  if (!retryAfterHeader) return 0;
  const asNumber = Number(retryAfterHeader);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1000;
  }
  const at = Date.parse(retryAfterHeader);
  if (!Number.isNaN(at)) {
    return Math.max(0, at - Date.now());
  }
  return 0;
};

// =========================================================================
//                           API Service Functions
// =========================================================================

// --- Authentication ---
// Backend routes are mounted at /api (no extra /auth prefix)
export const signup = (credentials) => apiClient.post('/signup', credentials).then(res => res.data);
export const login = (credentials) => apiClient.post('/login', credentials).then(res => res.data);
export const logout = () => apiClient.post('/logout').then(res => res.data);
export const checkAuth = () => fetchData('/check-auth');

// --- User Profile ---
export const getProfile = () => fetchData('/profile');
export const updateProfile = (profileData) => apiClient.put('/profile', profileData).then(res => res.data);
export const updateWalletLimit = (amount, config = {}) => apiClient.post('/profile/wallet-limit', { amount }, config).then(res => res.data);

// --- Portfolio ---
export const getPortfolio = () => withRetry(
  () => apiClient.get('/portfolio', { timeout: 45000 }).then((res) => res.data),
  2
);
export const fetchPortfolio = getPortfolio; // Alias used in DashboardPage

// --- Orders ---
export const getOrders = () => fetchData('/orders');
export const fetchOrders = getOrders; // Alias used in DashboardPage
export const getOrderDetail = (orderId) => fetchData(`/orders/${orderId}`);
export const fetchOrderDetail = getOrderDetail; // Alias

// --- Market Data ---

// Fetches major indices (Nifty 50, Sensex, etc.) - Matches markets.py /indices
export const getMarketIndices = () => fetchData('/indices', { timeout: 60000 });
export const fetchMarketIndices = getMarketIndices; // Alias

// Fetches static Nifty 50 movers from direct MO LTP data.
// Kept at 30 s so cold refreshes can complete when the backend has to refetch all 50 quotes.
export const fetchMarket = () => fetchData('/market', { timeout: 30000 });
export const getMarket = fetchMarket; // Alias

// Backwards-compatible alias for older endpoints
export const fetchMarketStocks = (_marketName) => fetchMarket();

// --- Stock Details ---

export const getStockDetails = (symbol) => fetchData(`/stock/${encodeURIComponent(symbol)}`);
export const getStockData = getStockDetails; // Alias
export const fetchStockDetails = getStockDetails; // Alias used in TradeForm/StockPage
export const fetchStockData = getStockDetails; // Alias

export const batchGetStockData = (symbols) => fetchData('/stocks/batch', { params: { symbols: symbols.join(',') } });

// --- Search ---
export const searchStocks = async (query, options = {}) => {
    const q = normalizeSearchQuery(query);
    const limit = options?.limit || SEARCH_DEFAULT_LIMIT;
    if (!q || q.length < SEARCH_MIN_QUERY_LENGTH) {
    return { success: true, results: [], page: 1, limit, has_next: false };
    }
    const params = {
      q,
      page: options?.page || 1,
      limit,
    };

  let response;
  try {
    response = await withRetry(() => apiClient.get('/search', { params, signal: options?.signal }));
  } catch (error) {
    const status = error?.status ?? error?.originalError?.response?.status ?? error?.response?.status;
    if (status === 429) {
      const retryAfter =
        error?.data?.retry_after ||
        error?.originalError?.response?.headers?.['retry-after'] ||
        error?.response?.headers?.['retry-after'];
      const delayMs = Math.min(2000, Math.max(300, parseRetryAfterMs(retryAfter) || 600));
      await new Promise((r) => setTimeout(r, delayMs));
      response = await apiClient.get('/search', { params, signal: options?.signal });
    } else {
      throw error;
    }
  }
    const data = response.data;
    if (Array.isArray(data)) {
      return {
        success: true,
        results: data,
        page: options?.page || 1,
        limit,
        has_next: false,
      };
    }
    return {
      success: data?.success !== false,
      results: Array.isArray(data?.results) ? data.results : [],
      page: data?.page || options?.page || 1,
      limit: data?.limit || limit,
      has_next: Boolean(data?.has_next),
    };
};

// --- Trading ---

export const placeBuyOrder = (tradeData) => apiClient.post('/buy', tradeData).then(res => res.data);
export const placeSellOrder = (tradeData) => apiClient.post('/sell', tradeData).then(res => res.data);

// Unified trade function used by TradeForm
export const placeTrade = (tradeData) => {
  const action = tradeData?.action?.toUpperCase();
  if (action === 'SELL') {
    return placeSellOrder(tradeData);
  }
  return placeBuyOrder(tradeData);
};

export const cancelOrder = (orderId) => apiClient.delete(`/cancel-order/${orderId}`).then(res => res.data);
export const modifyOrder = (orderId, payload) => apiClient.patch(`/modify-order/${orderId}`, payload).then(res => res.data);

// --- Exit Plan (Stoploss/Target) ---

export const updateExitPlan = (payload) => apiClient.patch('/exit-plan', payload).then(res => res.data);

// --- Watchlists ---
export const getWatchlists = () => fetchData('/watchlists');
export const fetchWatchlists = getWatchlists; // Alias
export const createWatchlist = (name) => apiClient.post('/watchlists', { name }).then(res => res.data);
export const deleteWatchlist = (watchlistName) => apiClient.delete(`/watchlists/${watchlistName}`).then(res => res.data);
export const addStockToWatchlist = (watchlistName, stockData) => withRetry(() => apiClient.post(`/watchlists/${watchlistName}/stocks`, stockData)).then(res => res.data);
export const removeStockFromWatchlist = (watchlistName, symbol) => apiClient.delete(`/watchlists/${watchlistName}/stocks/${symbol}`).then(res => res.data);
export const renameWatchlist = (watchlistName, newName) => apiClient.patch(`/watchlists/${watchlistName}`, { new_name: newName }).then(res => res.data);

// --- System ---
export const getMarketStatus = () => fetchData('/market-status');