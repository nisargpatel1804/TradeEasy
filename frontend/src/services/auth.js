import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Configure axios defaults
axios.defaults.withCredentials = true; // Important for session cookies

// Centralized Error Handling
export const handleApiError = async (error) => {
  console.error("API Error:", error); // Log the full error for debugging

  if (error.response?.status === 401) {
    console.warn("Session expired, logging out...");
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
    console.log("Signing up user..."); // Log the action
    const response = await axios.post(`${API_BASE_URL}/api/signup`, {
      email,
      mobile,
      password,
      confirm_password: confirmPassword,
    });

    console.log("Signup Response:", response.data); // Log the response

    // Store client_id only (for future login)
    if (response.data.client_id) {
      localStorage.setItem("client_id", response.data.client_id);
      console.log("Client ID stored in localStorage.");
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
    console.log("Logging in user..."); // Log the action
    const response = await axios.post(`${API_BASE_URL}/api/login`, {
      client_id: clientId,
      password,
    });

    console.log("Login Response:", response.data); // Log the response

    // Set isAuthenticated flag in localStorage
    localStorage.setItem("isAuthenticated", "true");
    console.log("User authenticated.");

    return response.data;
  } catch (error) {
    console.error("Login Error:", error); // Log the error
    await handleApiError(error);
  }
};

// User Logout
export const logout = async () => {
  try {
    console.log("Logging out user..."); // Log the action
    await axios.post(`${API_BASE_URL}/api/logout`, {});
    console.log("Logout successful.");
  } catch (error) {
    console.error("Logout failed:", error); // Log the error
  } finally {
    clearAuthData();
    console.log("Authentication data cleared.");
    window.location.href = "/login";
  }
};

// Helper: Clear Authentication Data
const clearAuthData = () => {
  localStorage.removeItem("isAuthenticated");
  console.log("LocalStorage cleared.");
};

// Fetch User Profile
export const getProfile = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/profile`);
    return response.data;
  } catch (error) {
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
    const response = await axios.get(`${API_BASE_URL}/api/watchlist`);// Log the response
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