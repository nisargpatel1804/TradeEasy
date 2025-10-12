import axios from "axios";

// Load API base URL from .env, with a fallback for development
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * The configured Axios instance for all backend communication.
 * It includes the base URL and settings for handling credentials (cookies).
 */
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

/**
 * Centralized API error handler.
 * If a 401 Unauthorized error is received, it dispatches an 'unauthorized' event
 * for the AuthContext to handle, preventing circular dependencies.
 * Exception: 401 errors from logout and check-auth endpoints are handled gracefully without triggering logout loops.
 * @param {object} error - The Axios error object.
 */
const handleApiError = (error) => {
  // Ignore request cancellation or throttling errors
  if (axios.isCancel(error) || error.message === 'Request throttled') {
    return Promise.reject(error);
  }

  // Handle network errors (server is down, etc.)
  if (error.code === 'ERR_NETWORK') {
    return Promise.reject(new Error("Network Error: Could not connect to the server."));
  }

  // If session has expired (401), notify the application to handle logout
  // BUT: Don't trigger unauthorized event for logout, login, and signup endpoint failures
  if (error.response?.status === 401) {
    const isAuthRequest = error.config?.url?.includes('/auth/login') ||
                         error.config?.url?.includes('/auth/signup') ||
                         error.config?.url?.includes('/auth/logout');

    if (!isAuthRequest) {
      const requestUrl = error.config?.url ?? null;
      let fullUrl = null;
      try {
        if (requestUrl) {
          fullUrl = error.config?.baseURL
            ? new URL(requestUrl, error.config.baseURL).toString()
            : new URL(requestUrl, window.location.origin).toString();
        }
      } catch (urlError) {
        fullUrl = requestUrl;
      }

      const eventDetail = {
        reason: 'SESSION_EXPIRED',
        endpoint: requestUrl,
        method: error.config?.method ?? null,
        status: error.response?.status ?? null,
        fullUrl,
        timestamp: Date.now(),
      };

      const unauthorizedEvent = typeof window.CustomEvent === 'function'
        ? new CustomEvent('unauthorized', { detail: eventDetail })
        : (() => {
            const fallbackEvent = new Event('unauthorized');
            fallbackEvent.detail = eventDetail;
            return fallbackEvent;
          })();

      // Only dispatch unauthorized event for non-auth 401 errors
      window.dispatchEvent(unauthorizedEvent);

      const sessionError = new Error("You're signed out. Please log in to continue.");
      sessionError.code = 'SESSION_EXPIRED';
      sessionError.status = 401;
      if (requestUrl) {
        sessionError.endpoint = requestUrl;
      }
      if (error.config?.method) {
        sessionError.method = error.config.method;
      }

      return Promise.reject(sessionError);
    }
    // For auth requests, fall through to return the backend error message
  }

  // Extract a clear error message from the backend response, or provide a default
  const errorMessage =
    error.response?.data?.error ||
    error.response?.data?.message ||
    "An unexpected error occurred.";

  const apiError = new Error(errorMessage);
  apiError.status = error.response?.status ?? null;
  apiError.code = error.response?.data?.code ?? error.response?.status ?? 'API_ERROR';
  if (error.response?.headers) {
    apiError.headers = error.response.headers;
    const retryAfter = error.response.headers['retry-after'];
    if (retryAfter !== undefined) {
      const retrySeconds = Number.parseInt(retryAfter, 10);
      if (!Number.isNaN(retrySeconds)) {
        apiError.retryAfter = retrySeconds;
      }
    }
    const remaining = error.response.headers['x-ratelimit-remaining'];
    if (remaining !== undefined) {
      const remainingInt = Number.parseInt(remaining, 10);
      if (!Number.isNaN(remainingInt)) {
        apiError.rateLimitRemaining = remainingInt;
      }
    }
  }

  return Promise.reject(apiError);
};

// Attach the centralized error handler as an interceptor
apiClient.interceptors.response.use(
  (response) => response,
  handleApiError
);

// --- Generic Data Fetcher ---
/**
 * A generic function to fetch data from the API.
 * @param {string} endpoint - The API endpoint to fetch from (e.g., "/portfolio").
 * @param {object} options - Optional Axios request config (e.g., params).
 * @returns {Promise<any>} - The response data.
 */
const fetchData = (endpoint, options = {}) => {
  return apiClient.get(endpoint, options).then(res => res.data);
};

// =========================================================================
//                           API Service Functions
// =========================================================================
// All authentication functions (login, signup, logout) have been moved to
// 'src/services/auth.js' to act as the single source of truth.
// =========================================================================


// --- Profile API ---
/** Fetches the current user's profile data. */
export const fetchProfile = () => {
  // Updated to use the correct endpoint after backend route fix
  return fetchData("/profile");
};

/** Updates the user's profile. */
export const updateProfile = (profileData) => {
  return apiClient.put("/profile/update", profileData).then(res => {
    const payload = res.data;
    if (payload?.success && typeof window !== 'undefined') {
      const eventDetail = { profile: payload.profile ?? null };
      const profileUpdatedEvent = typeof window.CustomEvent === 'function'
        ? new CustomEvent('profile:updated', { detail: eventDetail })
        : (() => {
            const fallbackEvent = new Event('profile:updated');
            fallbackEvent.detail = eventDetail;
            return fallbackEvent;
          })();

      window.dispatchEvent(profileUpdatedEvent);
    }
    return payload;
  });
};


// --- Portfolio & Performance API ---
/** Fetches the user's portfolio holdings. */
export const fetchPortfolio = () => fetchData("/portfolio");

/** Fetches the user's performance data. */
export const fetchPerformance = () => fetchData("/performance");


// --- Market & Stock Data API ---
/** Fetches detailed data for a single stock symbol. */
export const getStockData = (symbol) => fetchData(`/stocks/${symbol}`);

/** Fetches overview data for a single stock. */
export const getStockOverview = (symbol) => {
  const formattedSymbol = symbol.replace(/\.(NS|NSE|BO|BSE)$/i, '');
  return fetchData(`/stock/overview/${encodeURIComponent(formattedSymbol)}`);
};

/** Searches for stocks based on a query. */
export const searchStocks = (query) => {
  if (!query || !query.trim()) return Promise.resolve([]);
  return fetchData("/stocks/search", { params: { query } });
};

/** Fetches market indices (e.g., Nifty 50, Sensex). */
export const fetchIndices = (options = {}) => {
  // ✅ FIX: The backend now returns { indices: [], metadata: {} }.
  // This extracts the array so the DataContext fallback works correctly.
  return fetchData("/indices", options).then(data => data.indices || []);
};

/**
 * ✅ NEW: Fetches all stocks for a specific market index (e.g., Nifty 50).
 * This supports the MarketPage component.
 * Assumes a backend endpoint like GET /api/markets/nifty50
 * @param {string} marketName - The name of the market index to fetch (e.g., "nifty50").
 */
export const fetchMarketStocks = (marketName = 'nifty50') => {
  return fetchData(`/markets/${marketName}`);
};

/** Fetches top market gainers. */
export const getTopGainers = () => fetchData('/markets/gainers');

/** Fetches top market losers. */
export const getTopLosers = () => fetchData('/markets/losers');


// --- Watchlist API ---
/** Fetches all of the user's watchlists. */
export const fetchWatchlists = () => fetchData("/watchlists");

/** Creates a new watchlist. */
export const createWatchlist = (name) => {
  return apiClient.post("/watchlists", { name }).then(res => res.data);
};

/** Deletes a watchlist by its name. */
export const deleteWatchlist = (watchlistName) => {
  return apiClient.delete(`/watchlists/${encodeURIComponent(watchlistName)}`).then(res => res.data);
};

// --- THIS FUNCTION IS UPDATED ---
/** * Adds a stock to a specific watchlist (by name).
 * Includes the scripcode, which is essential for the backend to trigger
 * a real-time WebSocket subscription for the newly added stock.
 */
export const addStockToWatchlist = (watchlistName, symbol, name, scripcode) => {
  return apiClient.post(`/watchlists/${encodeURIComponent(watchlistName)}/stocks`, { symbol, name, scripcode }).then(res => res.data);
};

/** Removes a stock from a specific watchlist (by name). */
export const removeStockFromWatchlist = (watchlistName, symbol) => {
  return apiClient.delete(`/watchlists/${encodeURIComponent(watchlistName)}/stocks/${encodeURIComponent(symbol)}`).then(res => res.data);
};

/** Fetches stocks in a specific watchlist (by name). */
export const fetchWatchlistStocks = (watchlistName) => {
  return fetchData(`/watchlists/${encodeURIComponent(watchlistName)}/stocks`);
};

// --- Batch Stock Data ---
/** Fetches batch LTP data for multiple symbols. Symbols may include .NS/.NSE suffixes. */
export const fetchBatchStockData = (symbols = []) => {
  if (!Array.isArray(symbols) || symbols.length === 0) return Promise.resolve({ data: {} });
  return fetchData(`/stocks/batch`, { params: { symbols: symbols.join(',') } });
};


// --- Order & Trade API ---
/** Fetches all of the user's orders. */
export const fetchOrders = () => fetchData("/orders");

/** Fetches details for a specific order. */
export const fetchOrderDetail = (orderId) => fetchData(`/orders/${orderId}`);

/** Places a trade order (buy/sell). */
export const placeTrade = (tradeData = {}) => {
  const action = (tradeData.action || 'buy').toLowerCase();
  const endpoint = action === 'sell' ? '/trade/sell' : '/trade/buy';
  const payload = {
    symbol: tradeData.symbol,
    quantity: Number(tradeData.quantity),
    orderType: tradeData.orderType,
    price: tradeData.price,
    client_id: tradeData.client_id,
  };

  if (payload.orderType !== 'limit') {
    delete payload.price;
  }

  return apiClient.post(endpoint, payload).then(res => res.data);
};

export default apiClient;