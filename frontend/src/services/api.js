import axios from "axios";
import { handleApiError } from "./auth"; // Import error handler from auth.js

// Load API base URL from .env
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"; // Fallback for Postman

// Ensure API base URL is defined
if (!API_BASE_URL) {
  throw new Error("VITE_API_BASE_URL is not defined in environment variables.");
}

// Create an Axios instance with default config
const apiClient = axios.create({
  baseURL: `${API_BASE_URL}/api`, // Ensure all API calls go through "/api"
  withCredentials: true, // Enable credentials for session-based authentication
});

// Export the apiClient for direct use where needed
export { apiClient as api };

// Simplified request deduplication
const pendingRequests = {};

// Handle API errors & logout on session expiry
apiClient.interceptors.response.use(
  (response) => {
    // Request completed, clear from pending requests
    const requestKey = `${response.config.method}:${response.config.url}`;
    delete pendingRequests[requestKey];
    return response;
  },
  async (error) => {
    // Request failed, clear from pending requests
    if (error.config) {
      const requestKey = `${error.config.method}:${error.config.url}`;
      delete pendingRequests[requestKey];
    }
    await handleApiError(error);
    return Promise.reject(error);
  }
);

/**
 * Fetch data from the API with deduplication of identical requests.
 * @param {string} endpoint - The API endpoint to fetch data from.
 * @param {object} options - Additional options for the request.
 * @returns {Promise<any>} - The fetched data or an error object.
 */
export const fetchData = async (endpoint, options = {}) => {
  // Generate a request key
  const requestKey = `get:${endpoint}${options.params ? JSON.stringify(options.params) : ''}`;
  
  // If we already have a pending request for this endpoint, return the existing promise
  if (pendingRequests[requestKey]) {
    return pendingRequests[requestKey];
  }
  
  // Create the request promise
  const requestPromise = (async () => {
    try {
      const response = await apiClient.get(endpoint, options);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch data from ${endpoint}:`, error);
      return { error: error?.response?.data?.message || "Failed to fetch data" };
    }
  })();
  
  // Store the promise
  pendingRequests[requestKey] = requestPromise;
  
  return requestPromise;
};

// -------------------------------------------------------------
// Stock symbols for BSE and NSE
// -------------------------------------------------------------

// BSE 30 (SENSEX) symbols
export const BSE30_SYMBOLS = [
  "RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS", "LT.NS",
  "TATAMOTORS.NS", "BAJFINANCE.NS", "HINDUNILVR.NS", "ITC.NS", "SBIN.NS",
  "AXISBANK.NS", "KOTAKBANK.NS", "MARUTI.NS", "SUNPHARMA.NS", "TITAN.NS",
  "ULTRACEMCO.NS", "NESTLEIND.NS", "M&M.NS", "NTPC.NS", "WIPRO.NS",
  "POWERGRID.NS", "TECHM.NS", "ASIANPAINT.NS", "BAJAJ-AUTO.NS", "ADANIPORTS.NS",
  "HCLTECH.NS", "ONGC.NS", "HEROMOTOCO.NS", "TATASTEEL.NS",
];

// NSE 50 (NIFTY) symbols
export const NSE50_SYMBOLS = [
  "ADANIENT.NS", "ADANIPORTS.NS", "APOLLOHOSP.NS", "ASIANPAINT.NS", "AXISBANK.NS",
  "BAJAJ-AUTO.NS", "BAJFINANCE.NS", "BAJAJFINSV.NS", "BHARTIARTL.NS", "BPCL.NS",
  "BRITANNIA.NS", "CIPLA.NS", "COALINDIA.NS", "DIVISLAB.NS", "DRREDDY.NS",
  "EICHERMOT.NS", "GRASIM.NS", "HCLTECH.NS", "HDFCBANK.NS", "HDFCLIFE.NS",
  "HEROMOTOCO.NS", "HINDALCO.NS", "HINDUNILVR.NS", "ICICIBANK.NS", "INDUSINDBK.NS",
  "INFY.NS", "ITC.NS", "JSWSTEEL.NS", "KOTAKBANK.NS", "LT.NS", "M&M.NS",
  "MARUTI.NS", "NESTLEIND.NS", "NTPC.NS", "ONGC.NS", "POWERGRID.NS", "RELIANCE.NS",
  "SBIN.NS", "SBILIFE.NS", "SHREECEM.NS", "SUNPHARMA.NS", "TATACONSUM.NS",
  "TATAMOTORS.NS", "TATASTEEL.NS", "TECHM.NS", "TITAN.NS", "ULTRACEMCO.NS",
  "UPL.NS", "WIPRO.NS",
];

/**
 * Fetch stock data for a batch of symbols
 * @param {Array} symbols - Array of stock symbols to fetch
 * @returns {Promise<Object>} - Object with symbols as keys and stock data as values
 */
export const fetchBatchStockData = async (symbols) => {
  // Disabled: previously fetched large batches via backend.
  return {};
};

/**
 * Fetch data for both BSE 30 and NSE 50 stocks
 * This combines both index stocks and removes duplicates
 */
export const fetchAllIndexStocks = async () => {
  // Disabled to improve performance
  return {};
};

/** Fetch Portfolio */
export const fetchPortfolio = async () => {
  return fetchData("/portfolio");
};

export const getStockData = async (symbol) => {
  try {
    return await fetchData(`/stocks/${symbol}`);
  } catch (error) {
    console.error("Error fetching stock data:", error);
    return { error: error.message };
  }
};


export const getStockOverview = async (symbol) => {
  if (!symbol) return { error: "Symbol is required" };

  // Strip common suffixes so backend handles all variants
  const formattedSymbol = symbol.replace(/\.(NS|NSE|BO|BSE)$/i, '');

  return fetchData(`/stock/overview/${encodeURIComponent(formattedSymbol)}`);
};


/** Search Indian stocks (NSE/BSE) */
export const searchStocks = async (query) => {
  if (!query.trim()) return [];
  
  // Generate a request key
  const requestKey = `get:/stocks/search?${query}`;
  
  // If we already have a pending request for this search query, return the existing promise
  if (pendingRequests[requestKey]) {
    return pendingRequests[requestKey];
  }
  
  // Create the request promise
  const requestPromise = (async () => {
    try {
      const response = await apiClient.get("/stocks/search", { params: { query } });
      return response.data;
    } catch (error) {
      console.error("Error searching stocks:", error);
      return [];
    }
  })();
  
  // Store the promise
  pendingRequests[requestKey] = requestPromise;
  
  return requestPromise;
};

// --- Watchlist API Functions ---

/** Fetches all of the user's watchlists. */
export const fetchWatchlists = async () => {
  return fetchData("/watchlists");
};

/** Creates a new watchlist. */
export const createWatchlist = async (name) => {
  try {
    const response = await apiClient.post("/watchlists", { name });
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || "Failed to create watchlist" };
  }
};

/** Deletes a specific watchlist by its ID. */
export const deleteWatchlist = async (watchlistId) => {
  try {
    const response = await apiClient.delete(`/watchlists/${watchlistId}`);
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || "Failed to delete watchlist" };
  }
};

/** Fetches all stocks within a specific watchlist. */
export const fetchWatchlistStocks = async (watchlistId) => {
  // Use our deduplication-enabled fetchData function
  return fetchData(`/watchlists/${watchlistId}/stocks`);
};

/** Adds a stock to a specific watchlist. */
export const addStockToWatchlist = async (watchlistId, symbol, name) => {
  try {
    const response = await apiClient.post(`/watchlists/${watchlistId}/stocks`, { symbol, name });
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || "Failed to add stock" };
  }
};

/** Removes a stock from a specific watchlist. */
export const removeStockFromWatchlist = async (watchlistId, symbol) => {
  try {
    const response = await apiClient.delete(`/watchlists/${watchlistId}/stocks/${symbol}`);
    return response.data;
  } catch (error) {
    return { error: error.response?.data?.error || "Failed to remove stock" };
  }
};

/** Format Volume */
const formatVolume = (volume) => {
  if (volume >= 10000000) {
    return `${(volume / 10000000).toFixed(2)} Cr`; // Crores
  } else if (volume >= 100000) {
    return `${(volume / 100000).toFixed(2)} L`; // Lakhs
  } else {
    return volume.toLocaleString(); // Plain number if it's less than 1 Lakh
  }
};

/** Format Market Cap */
const formatMarketCap = (marketCap) => {
  if (marketCap >= 10000000000) {
    return `${(marketCap / 10000000000).toFixed(2)} Tr`; // Trillion
  } else if (marketCap >= 100000000) {
    return `${(marketCap / 100000000).toFixed(2)} Cr`; // Crores
  } else if (marketCap >= 1000000) {
    return `${(marketCap / 1000000).toFixed(2)} L`; // Lakhs
  } else {
    return marketCap.toLocaleString(); // Plain number if it's below 1 Lakh
  }
};

/** Fetch Performance Data */
export const fetchPerformance = async () => {
  return fetchData("/performance");
};

/** Fetch Market Indices */
export const fetchIndices = async (includeMovers = false, navbarOnly = false) => {
  const options = { params: {} };
  
  if (includeMovers) {
    options.params.include_movers = 'true';
  }
  
  if (navbarOnly) {
    options.params.navbar_only = 'true';
  }
  
  return fetchData("/indices", options);
};

/** Update Market Indices */
export const updateIndices = async () => {
  try {
    const response = await apiClient.post("/indices/update");
    return response.data;
  } catch (error) {
    console.error("Failed to update indices:", error);
    return { error: error?.response?.data?.message || "Failed to update indices." };
  }
};

/** Fetch User Profile */
export const fetchProfile = async () => {
  return fetchData("/profile");
};

/** Update User Profile */
export const updateProfile = async (email, mobile) => {
  try {
    const response = await apiClient.put("/profile/update", { email, mobile });
    return response.data;
  } catch (error) {
    console.error("Failed to update profile:", error);
    return { error: error?.response?.data?.message || "Failed to update profile." };
  }
};

/** Fetch Order Details */
export const fetchOrderDetail = async (orderId) => {
  return fetchData(`/orders/${orderId}`);
};

/** Create Order */
export const createOrder = async (orderData) => {
  try {
    const response = await apiClient.post("/orders", orderData);
    return response.data;
  } catch (error) {
    console.error("Failed to create order:", error);
    return { error: error?.response?.data?.message || "Failed to create order." };
  }
};

/** Update Order */
export const updateOrder = async (orderId, updateData) => {
  try {
    const response = await apiClient.put(`/orders/${orderId}`, updateData);
    return response.data;
  } catch (error) {
    console.error("Failed to update order:", error);
    return { error: error?.response?.data?.message || "Failed to update order." };
  }
};

/** Delete Order */
export const deleteOrder = async (orderId) => {
  try {
    const response = await apiClient.delete(`/orders/${orderId}`);
    return response.data;
  } catch (error) {
    console.error("Failed to delete order:", error);
    return { error: error?.response?.data?.message || "Failed to delete order." };
  }
};

/** 
 * Place a Trade with support for market/limit orders
 * @param {string} action - 'buy' or 'sell'
 * @param {string} symbol - Stock symbol (e.g., 'AAPL.NS')
 * @param {number} quantity - Number of shares
 * @param {number|null} [price] - Required for limit orders
 * @param {string} [orderType='market'] - 'market' or 'limit'
 */
export const placeTrade = async (action, symbol, quantity, price = null, orderType = 'market') => {
  try {
    // Validate action
    if (!['buy', 'sell'].includes(action.toLowerCase())) {
      throw new Error('Invalid action. Must be "buy" or "sell"');
    }

    // Prepare request payload
    const payload = {
      symbol: symbol.toUpperCase().trim(),
      quantity: Number(quantity),
      orderType: orderType.toLowerCase()
    };

    // Add price if limit order
    if (orderType === 'limit') {
      if (!price || isNaN(price)) {
        throw new Error('Price is required for limit orders');
      }
      payload.price = Number(price);
    }

    const response = await apiClient.post(`/trade/${action}`, payload);
    
    return {
      success: true,
      data: response.data,
      message: response.data?.message || 'Trade executed successfully'
    };

  } catch (error) {
    console.error('Trade Error:', error);
    
    // Handle different error scenarios
    let errorMessage = 'Failed to place trade';
    
    if (error.response) {
      // Server responded with error status
      errorMessage = error.response.data?.error || 
                    error.response.data?.message || 
                    `Server error: ${error.response.status}`;
    } else if (error.request) {
      // Request was made but no response
      errorMessage = 'No response from server. Please check your connection.';
    } else if (error.message) {
      // Custom validation errors
      errorMessage = error.message;
    }

    return {
      success: false,
      error: errorMessage,
      status: error.response?.status
    };
  }
};

/** 
 * Get trade history for the user
 */
export const getTradeHistory = async () => {
  try {
    const response = await apiClient.get('/trade/history');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch trade history:', error);
    return { 
      error: error?.response?.data?.message || 'Failed to fetch trade history' 
    };
  }
};

// --- Market Data API Functions ---

/**
 * Get Nifty 50 stocks data with gainers and losers
 */
export const getNifty50Stocks = async () => {
  try {
    const response = await apiClient.get('/markets/nifty50');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch Nifty 50 data:', error);
    return {
      error: error?.response?.data?.error || 'Failed to fetch market data'
    };
  }
};

/**
 * Get top gainers from Nifty 50
 */
export const getTopGainers = async () => {
  try {
    const response = await apiClient.get('/markets/gainers');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch gainers:', error);
    return {
      error: error?.response?.data?.error || 'Failed to fetch gainers'
    };
  }
};

/**
 * Get top losers from Nifty 50
 */
export const getTopLosers = async () => {
  try {
    const response = await apiClient.get('/markets/losers');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch losers:', error);
    return {
      error: error?.response?.data?.error || 'Failed to fetch losers'
    };
  }
};