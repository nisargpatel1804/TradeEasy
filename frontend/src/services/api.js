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

// Handle API errors & logout on session expiry
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    await handleApiError(error);
    return Promise.reject(error);
  }
);

/**
 * Fetch data from the API.
 * @param {string} endpoint - The API endpoint to fetch data from.
 * @param {object} options - Additional options for the request.
 * @returns {Promise<any>} - The fetched data or an error object.
 */
const fetchData = async (endpoint, options = {}) => {
  try {
    const response = await apiClient.get(endpoint, options);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch data from ${endpoint}:`, error);
    return { error: error?.response?.data?.message || "Failed to fetch data" };
  }
};

/** Fetch Portfolio */
export const fetchPortfolio = async () => {
  return fetchData("/portfolio");
};

export const fetchStockData = async (symbol) => {
  console.log("Fetching stock data for:", symbol);
  try {
    const formattedSymbol = symbol.replace(/\.(NS|NSE|BO|BSE)$/i, '');
    const response = await fetchData(`/stock/overview/${encodeURIComponent(formattedSymbol)}`);
    return response.data;
  } catch (error) {
    console.error("Error fetching stock data:", error);
    throw error;
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
  try {
    const response = await apiClient.get("/stocks/search", { params: { query } });
    return response.data;
  } catch (error) {
    console.error("Error searching stocks:", error);
    return [];
  }
};

// Fetch watchlist data from the backend
export const fetchWatchlist = async () => {
  try {
    const response = await apiClient.get("/watchlist");
    if (response.data.success) {
      return response.data; // Return the entire response object
    } else {
      throw new Error("Failed to fetch watchlist");
    }
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    return { data: [] }; // Return an empty array in case of error
  }
};

// Add a symbol to the watchlist
export const addToWatchlist = async (symbol) => {
  try {
    const response = await apiClient.post("/watchlist/add", { symbol });
    return response.data;
  } catch (error) {
    console.error("Error adding to watchlist:", error);
    return { error: error.response?.data?.error || "Failed to add symbol" };
  }
};

// Remove a symbol from the watchlist
export const removeFromWatchlist = async (symbol) => {
  try {
    const response = await apiClient.delete("/watchlist/remove", {
      data: { symbol }, // Send symbol in the request body
    });
    return response.data;
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    return { error: error.response?.data?.error || "Failed to remove symbol" };
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
export const fetchIndices = async () => {
  return fetchData("/indices");
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