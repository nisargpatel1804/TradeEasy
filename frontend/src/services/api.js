import axios from "axios";

// Load API base URL from environment variables, with a fallback for local development.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * The configured Axios instance for all backend communication.
 * It includes the base URL and settings for handling credentials (cookies),
 * which is essential for flask-login session management.
 */
export const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

/**
 * Centralized API error handler.
 * This interceptor catches errors from all API responses.
 * @param {object} error - The Axios error object.
 */
const handleApiError = (error) => {
  // If the session has expired (401 Unauthorized), dispatch a global event.
  // The AuthContext will listen for this event to trigger a global logout,
  // preventing circular dependencies between this service and the context.
  // We ignore 401s from the '/check-auth' endpoint to avoid logout loops on initial load.
  if (error.response?.status === 401 && !error.config.url.endsWith('/check-auth')) {
    window.dispatchEvent(new CustomEvent('unauthorized'));
  }

  // For all other errors, extract the specific message from the backend response
  // or provide a generic one.
  const errorMessage =
    error.response?.data?.message ||
    "An unexpected error occurred. Please try again.";

  return Promise.reject(new Error(errorMessage));
};

// Attach the centralized error handler to the Axios instance.
apiClient.interceptors.response.use(
  (response) => response,
  handleApiError
);

// A generic function to simplify GET requests and extract the data.
const fetchData = (endpoint, options = {}) => {
  return apiClient.get(endpoint, options).then(res => res.data);
};

// =========================================================================
//                           API Service Functions
// =========================================================================

// --- Auth ---
export const signup = (credentials) => apiClient.post('/auth/signup', credentials).then(res => res.data);
export const login = (credentials) => apiClient.post('/auth/login', credentials).then(res => res.data);
export const logout = () => apiClient.post('/auth/logout').then(res => res.data);
export const checkAuth = () => fetchData('/auth/check-auth');

// --- Profile ---
export const getProfile = () => fetchData('/profile');
export const updateProfile = (profileData) => apiClient.put('/profile', profileData).then(res => res.data);

// --- Portfolio ---
export const getPortfolio = () => fetchData('/portfolio');
export const fetchPortfolio = getPortfolio;

// --- Orders ---
export const getOrders = () => fetchData('/orders');
export const fetchOrders = getOrders;

// --- Markets ---
export const getMarketIndices = () => fetchData('/indices');
export const fetchMarketIndices = getMarketIndices;
export const fetchMarketStocks = (marketName) => fetchData(`/markets/${marketName}`);

// --- Stock ---
export const getStockDetails = (symbol) => fetchData(`/stock/${symbol}`);
export const getStockData = getStockDetails;
export const fetchStockData = getStockDetails;
export const batchGetStockData = (symbols) => fetchData('/stocks/batch', { params: { symbols: symbols.join(',') } });

// --- Search ---
// The backend expects the query parameter 'q'.
export const searchStocks = (query) => {
    if (!query || query.trim().length < 2) {
        return Promise.resolve([]); // Return empty for short queries, matching backend logic
    }
    return fetchData('/search', { params: { q: query } });
};

// --- Trade ---
export const placeBuyOrder = (tradeData) => apiClient.post('/buy', tradeData).then(res => res.data);
export const placeSellOrder = (tradeData) => apiClient.post('/sell', tradeData).then(res => res.data);
export const placeTrade = (tradeData) => {
  const action = tradeData?.action?.toUpperCase();
  if (action === 'SELL') {
    return placeSellOrder(tradeData);
  }
  return placeBuyOrder(tradeData);
};

// --- Watchlists ---
export const getWatchlists = () => fetchData('/watchlists');
export const createWatchlist = (name) => apiClient.post('/watchlists', { name }).then(res => res.data);
export const deleteWatchlist = (watchlistName) => apiClient.delete(`/watchlists/${watchlistName}`).then(res => res.data);
export const addStockToWatchlist = (watchlistName, stockData) => apiClient.post(`/watchlists/${watchlistName}/stocks`, stockData).then(res => res.data);
export const removeStockFromWatchlist = (watchlistName, symbol) => apiClient.delete(`/watchlists/${watchlistName}/stocks/${symbol}`).then(res => res.data);
