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
      // Only dispatch unauthorized event for non-auth 401 errors
      window.dispatchEvent(new Event('unauthorized'));
      return Promise.reject(new Error("Session expired. Please log in again."));
    }
    // For auth requests, fall through to return the backend error message
  }

  // Extract a clear error message from the backend response, or provide a default
  const errorMessage =
    error.response?.data?.error ||
    error.response?.data?.message ||
    "An unexpected error occurred.";

  return Promise.reject(new Error(errorMessage));
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
  return apiClient.put("/profile/update", profileData).then(res => res.data);
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

/** Deletes a watchlist by its ID. */
export const deleteWatchlist = (watchlistId) => {
  return apiClient.delete(`/watchlists/${watchlistId}`).then(res => res.data);
};

/** Adds a stock to a specific watchlist. */
export const addStockToWatchlist = (watchlistId, symbol, name) => {
  return apiClient.post(`/watchlists/${watchlistId}/stocks`, { symbol, name }).then(res => res.data);
};

/** Removes a stock from a specific watchlist. */
export const removeStockFromWatchlist = (watchlistId, symbol) => {
  return apiClient.delete(`/watchlists/${watchlistId}/stocks/${symbol}`).then(res => res.data);
};

/** Fetches stocks in a specific watchlist. */
export const fetchWatchlistStocks = (watchlistId) => {
  return fetchData(`/watchlists/${watchlistId}/stocks`);
};


// --- Order & Trade API ---
/** Fetches all of the user's orders. */
export const fetchOrders = () => fetchData("/orders");

/** Fetches details for a specific order. */
export const fetchOrderDetail = (orderId) => fetchData(`/orders/${orderId}`);

/** Places a trade order (buy/sell). */
export const placeTrade = (tradeData) => {
  return apiClient.post("/trade", tradeData).then(res => res.data);
};

export default apiClient;