import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Configure axios defaults
axios.defaults.withCredentials = true; // Important for session cookies

// Centralized Error Handling
export const handleApiError = async (error) => {
  console.error("API Error:", error); // Log the full error for debugging

  if (error.response?.status === 401) {
    await logout();
    throw new Error("Session expired. Please log in again.");
  }

  // Handle specific error messages from the backend
  const errorMessage =
    error.response?.data?.error ||
    error.response?.data?.message ||
    error.message ||
    "An unexpected error occurred. Please try again.";

  throw new Error(errorMessage);
};

// User Signup
export const signup = async ({ email, mobile, password, confirmPassword }) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/signup`, {
      email,
      mobile,
      password,
      confirm_password: confirmPassword,
    });

    // Store client_id only (for future login)
    if (response.data.client_id) {
      localStorage.setItem("client_id", response.data.client_id);
    }

    return response.data;
  } catch (error) {
    console.error("Signup Error:", error); // Log the error
    await handleApiError(error);
  }
};

// User Login
export const login = async (clientId, password) => {
  try {
    const response = await axios.post(`${API_BASE_URL}/api/login`, {
      client_id: clientId,
      password,
    });

    // Set isAuthenticated flag in localStorage
    localStorage.setItem("isAuthenticated", "true");

    return response.data;
  } catch (error) {
    console.error("Login Error:", error); // Log the error
    await handleApiError(error);
  }
};

// User Logout
export const logout = async () => {
  try {
    await axios.post(`${API_BASE_URL}/api/logout`, {});
  } catch (error) {
    console.error("Logout failed:", error); // Log the error
  } finally {
    clearAuthData();
    window.location.href = "/login";
  }
};

// Helper: Clear Authentication Data
const clearAuthData = () => {
  localStorage.removeItem("isAuthenticated");
};

// Fetch User Profile
export const getProfile = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/profile`);
    return response.data;
  } catch (error)
  {
    console.error("Profile Fetch Error:", error); // Log the error
    await handleApiError(error);
  }
};

// Update User Profile
export const updateProfile = async (profileData) => {
  try {
    const response = await axios.put(
      `${API_BASE_URL}/api/profile/update`,
      profileData
    );
    return response.data;
  } catch (error) {
    console.error("Profile Update Error:", error); // Log the error
    await handleApiError(error);
  }
};

// Fetch Watchlist (or other protected endpoints)
export const fetchWatchlist = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/watchlist`);
    return response.data;
  } catch (error) {
    console.error("Watchlist Fetch Error:", error); // Log the error
    await handleApiError(error);
  }
};

// Check if user is authenticated
export const isAuthenticated = () => {
  const isAuth = localStorage.getItem("isAuthenticated") === "true";
  return isAuth;
};

// Retrieve stored client ID (for login purposes)
export const getClientId = () => {
  const clientId = localStorage.getItem("client_id") || "";
  return clientId;
};