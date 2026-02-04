import axios from "axios";

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

/**
 * Centralized API error handler.
 * Catches errors from all API responses and normalizes them.
 */
const handleApiError = (error) => {
  const originalRequest = error.config;

  const url = String(originalRequest?.url || "");

  // Prevent infinite loops on auth checks
  const isAuthEndpoint =
    url.includes('/check-auth') ||
    url.includes('/logout') ||
    url.includes('/login') ||
    url.includes('/signup');

  // Handle Session Expiry (401)
  if (error.response?.status === 401 && !isAuthEndpoint) {
    // Throttle to avoid storms when many requests fail at once.
    const now = Date.now();
    if (now - lastUnauthorizedDispatchAt > 1000) {
      lastUnauthorizedDispatchAt = now;
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
  (response) => response,
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
      // Do not retry if the request was intentionally cancelled/aborted
      if (err?.code === 'ERR_CANCELED' || err?.name === 'AbortError' || err?.name === 'CanceledError') {
        throw err;
      }
      // Retry on network errors (no response) or server 5xx
      if (!err.response || (err.response && err.response.status >= 500) || err.code === 'ECONNABORTED') {
        const delay = 100 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
export const fetchProfile = getProfile; // Alias
export const updateProfile = (profileData) => apiClient.put('/profile', profileData).then(res => res.data);
export const updateWalletLimit = (amount) => apiClient.post('/profile/wallet-limit', { amount }).then(res => res.data);

// --- Portfolio ---
export const getPortfolio = () => fetchData('/portfolio');
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

// Fetches Nifty 50 constituents and snapshot - Matches markets.py /market
export const fetchMarket = () => fetchData('/market');
export const getMarket = fetchMarket; // Alias

// Backwards-compatible alias for legacy calls
export const fetchMarketStocks = (_marketName) => fetchMarket();

// --- Stock Details ---

export const getStockDetails = (symbol) => fetchData(`/stock/${encodeURIComponent(symbol)}`);
export const getStockData = getStockDetails; // Alias
export const fetchStockDetails = getStockDetails; // Alias used in TradeForm/StockPage
export const fetchStockData = getStockDetails; // Alias

export const batchGetStockData = (symbols) => fetchData('/stocks/batch', { params: { symbols: symbols.join(',') } });

// --- Search ---
export const searchStocks = async (query, options = {}) => {
    const q = (query || '').trim().replace(/\s+/g, ' ');
    if (!q || q.length < 2) {
    return [];
    }
    const params = { q };

  const response = await withRetry(() => apiClient.get('/search', { params, signal: options?.signal }));
    const data = response.data;
    return Array.isArray(data) ? data : (data?.results || []);
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