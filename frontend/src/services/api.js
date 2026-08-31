import axios from "axios";

// =========================================================================
//                           Configuration & Constants
// =========================================================================

// --- Search Constants (Merged to reduce file clutter) ---
const SEARCH_MIN_QUERY_LENGTH = 2;
const SEARCH_MAX_QUERY_LENGTH = 64;
const SEARCH_DEFAULT_LIMIT = 15;

const normalizeSearchQuery = (value, maxLength = SEARCH_MAX_QUERY_LENGTH) => {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

// --- Network Configuration ---
// NOTE: In production, setting VITE_API_BASE_URL to an empty string uses same-origin
// requests (e.g. behind Vercel rewrites).
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

const isLocalhostBase = (value) => {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return (
    v === "http://localhost:5000" ||
    v === "http://127.0.0.1:5000" ||
    v.startsWith("http://localhost:") ||
    v.startsWith("http://127.0.0.1:")
  );
};

const API_BASE_URL =
  import.meta.env.PROD && isLocalhostBase(rawApiBaseUrl)
    ? ""
    : rawApiBaseUrl ?? (import.meta.env.PROD ? "" : "http://localhost:5000");
    
const DEFAULT_TIMEOUT = 15000; // 15 seconds

/**
 * Configured Axios instance for all backend communication.
 */
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true, // Critical for Flask-Login session cookies
  timeout: DEFAULT_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// =========================================================================
//                           Interceptors
// =========================================================================

let lastUnauthorizedDispatchAt = 0;
let unauthorizedDispatched = false;

const onApiSuccess = (response) => {
  unauthorizedDispatched = false;
  return response;
};

const _authPaths = new Set(["/check-auth", "/logout", "/login", "/signup"]);

/**
 * Centralized API error handler.
 * Normalizes error objects and handles 401/429 status codes cleanly.
 */
const handleApiError = (error) => {
  const originalRequest = error.config;
  const url = String(originalRequest?.url || "");

  let isAuthEndpoint = false;
  for (const p of _authPaths) {
    if (url.includes(p)) {
      isAuthEndpoint = true;
      break;
    }
  }

  const responseStatus = error.response?.status;

  // Handle Session Expiry (401)
  if (responseStatus === 401 && !isAuthEndpoint) {
    const now = Date.now();
    if (!unauthorizedDispatched && now - lastUnauthorizedDispatchAt > 1000) {
      lastUnauthorizedDispatchAt = now;
      unauthorizedDispatched = true;
      window.dispatchEvent(new CustomEvent("unauthorized"));
    }
  }

  // Extract user-friendly error message from backend JSON
  const errorMessage =
    error.response?.data?.message ||
    error.message ||
    "An unexpected error occurred. Please try again.";

  const apiError = new Error(errorMessage);
  apiError.status = responseStatus;
  apiError.data = error.response?.data;
  apiError.code = error.code;
  apiError.isRateLimit = responseStatus === 429;
  apiError.originalError = error;

  return Promise.reject(apiError);
};

apiClient.interceptors.response.use(onApiSuccess, handleApiError);

// =========================================================================
//                           Helpers
// =========================================================================

const fetchData = async (endpoint, options = {}) => {
  const response = await apiClient.get(endpoint, options);
  return response.data;
};

const withRetry = async (fn, attempts = 2) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const responseStatus =
        err?.status ?? err?.response?.status ?? err?.originalError?.response?.status;

      // Never retry if cancelled or rate-limited (handled specifically)
      if (
        err?.code === "ERR_CANCELED" ||
        err?.name === "AbortError" ||
        err?.name === "CanceledError" ||
        responseStatus === 429
      ) {
        throw err;
      }

      // Retry on network timeouts or 5xx server errors
      if (!responseStatus || responseStatus >= 500 || err.code === "ECONNABORTED") {
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
export const signup = (credentials) =>
  apiClient.post("/signup", credentials).then((res) => res.data);

export const login = (credentials) =>
  apiClient.post("/login", credentials).then((res) => res.data);

export const logout = () =>
  apiClient.post("/logout").then((res) => res.data);

/**
 * Verifies active session with backend. Gracefully intercepts 401/timeouts
 * without throwing errors to allow smooth startup initialization.
 */
export const checkAuth = () => {
  return apiClient
    .get("/check-auth", {
      timeout: 8000,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 401,
    })
    .then((res) => {
      if (res.status === 401) {
        return { isAuthenticated: false, user: null, profile: null };
      }
      return res.data;
    })
    .catch((error) => {
      if (
        error?.code === "ECONNABORTED" ||
        error?.status === 401 ||
        error?.response?.status === 401
      ) {
        return { isAuthenticated: false, user: null, profile: null };
      }
      throw error;
    });
};

// --- User Profile ---
export const getProfile = () => fetchData("/profile");

export const updateProfile = (profileData) =>
  apiClient.put("/profile", profileData).then((res) => res.data);

export const updateWalletLimit = (amount, config = {}) =>
  apiClient.post("/profile/wallet-limit", { amount }, config).then((res) => res.data);

// --- Portfolio ---
export const getPortfolio = () =>
  withRetry(
    () => apiClient.get("/portfolio", { timeout: 45000 }).then((res) => res.data),
    2
  );
export const fetchPortfolio = getPortfolio;

// --- Orders ---
export const getOrders = (params = {}) => fetchData("/orders", { params });
export const fetchOrders = getOrders;

export const getOrderDetail = (orderId) => fetchData(`/orders/${orderId}`);
export const fetchOrderDetail = getOrderDetail;

// --- Market Data ---
export const getMarketIndices = () => fetchData("/indices", { timeout: 60000 });
export const fetchMarketIndices = getMarketIndices;

export const fetchMarket = () => fetchData("/market", { timeout: 30000 });
export const getMarket = fetchMarket;
export const fetchMarketStocks = () => fetchMarket();

// --- Stock Details & Charts ---
export const getStockDetails = (symbol) => fetchData(`/stock/${encodeURIComponent(symbol)}`);
export const getStockData = getStockDetails;
export const fetchStockDetails = getStockDetails;
export const fetchStockData = getStockDetails;

export const batchGetStockData = (symbols) =>
  fetchData("/stocks/batch", { params: { symbols: symbols.join(",") } });

/**
 * Historical Candlestick (OHLCV) Data
 * @param {string} symbol - Stock symbol (e.g. RELIANCE or RELIANCE.NSE)
 * @param {object} params - { interval: '5m', range: '5d' }
 */
export const getHistoricalChartData = (symbol, params = {}) =>
  fetchData(`/charts/${encodeURIComponent(symbol)}`, { params });

/**
 * Batch Sparkline Trend Data
 * @param {Array<string>} symbols - List of stock symbols
 */
export const getBatchSparklines = (symbols) =>
  fetchData("/charts/sparklines/batch", { params: { symbols: symbols.join(",") } });

// --- Search ---
export const searchStocks = async (query, options = {}) => {
  const q = normalizeSearchQuery(query);
  const limit = options?.limit || SEARCH_DEFAULT_LIMIT;
  if (!q || q.length < SEARCH_MIN_QUERY_LENGTH) {
    return { success: true, results: [], limit, has_next: false, next_page_token: null };
  }
  const params = { q, limit };
  if (options?.pageToken) {
    params.page_token = options.pageToken;
  }

  let response;
  try {
    response = await withRetry(() =>
      apiClient.get("/search", { params, signal: options?.signal })
    );
  } catch (error) {
    const status = error?.status ?? error?.originalError?.response?.status ?? error?.response?.status;
    if (status === 429) {
      const retryAfter =
        error?.data?.retry_after ||
        error?.originalError?.response?.headers?.["retry-after"] ||
        error?.response?.headers?.["retry-after"];
      const delayMs = Math.min(2000, Math.max(300, parseRetryAfterMs(retryAfter) || 600));
      await new Promise((r) => setTimeout(r, delayMs));
      response = await apiClient.get("/search", { params, signal: options?.signal });
    } else {
      throw error;
    }
  }

  const data = response.data;
  if (Array.isArray(data)) {
    return { success: true, results: data, limit, has_next: false, next_page_token: null };
  }
  return {
    success: data?.success !== false,
    results: Array.isArray(data?.results) ? data.results : [],
    limit: data?.limit || limit,
    has_next: Boolean(data?.has_next),
    next_page_token: data?.next_page_token || null,
  };
};

// --- Trading ---
export const placeBuyOrder = (tradeData) =>
  apiClient.post("/buy", tradeData).then((res) => res.data);

export const placeSellOrder = (tradeData) =>
  apiClient.post("/sell", tradeData).then((res) => res.data);

export const placeTrade = (tradeData) => {
  const action = tradeData?.action?.toUpperCase();
  if (action === "SELL") {
    return placeSellOrder(tradeData);
  }
  return placeBuyOrder(tradeData);
};

export const cancelOrder = (orderId) =>
  apiClient.delete(`/cancel-order/${orderId}`).then((res) => res.data);

export const modifyOrder = (orderId, payload) =>
  apiClient.patch(`/modify-order/${orderId}`, payload).then((res) => res.data);

// --- Exit Plan ---
export const updateExitPlan = (payload) =>
  apiClient.patch("/exit-plan", payload).then((res) => res.data);

// --- Watchlists ---
export const getWatchlists = () => fetchData("/watchlists");
export const fetchWatchlists = getWatchlists;

export const createWatchlist = (name) =>
  apiClient.post("/watchlists", { name }).then((res) => res.data);

export const deleteWatchlist = (watchlistName) =>
  apiClient.delete(`/watchlists/${watchlistName}`).then((res) => res.data);

export const addStockToWatchlist = (watchlistName, stockData) =>
  withRetry(() => apiClient.post(`/watchlists/${watchlistName}/stocks`, stockData)).then(
    (res) => res.data
  );

export const removeStockFromWatchlist = (watchlistName, symbol) =>
  apiClient.delete(`/watchlists/${watchlistName}/stocks/${symbol}`).then((res) => res.data);

export const renameWatchlist = (watchlistName, newName) =>
  apiClient.patch(`/watchlists/${watchlistName}`, { new_name: newName }).then(
    (res) => res.data
  );

// --- System ---
export const getMarketStatus = () => fetchData("/market-status");