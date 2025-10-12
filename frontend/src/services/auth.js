import { apiClient } from './api';
import axios from 'axios';

// Create a separate axios instance for session verification to avoid console logs
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const authCheckClient = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  withCredentials: true,
});

// Add a response interceptor to silently handle 401 errors for session checks
authCheckClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // For 401 errors, return a custom response instead of rejecting
    // This prevents axios from logging the error to console
    if (error.response?.status === 401) {
      return Promise.reject({ 
        isAuthError: true, 
        status: 401,
        response: error.response 
      });
    }
    // For other errors, pass them through normally
    return Promise.reject(error);
  }
);

/**
 * A dedicated service object for handling all authentication-related logic.
 * This includes logging in, signing up, logging out, and checking session validity.
 */
export const authService = {
  _isLoggingOut: false, // Flag to prevent multiple simultaneous logout attempts

  /**
   * Logs a user in by calling the backend API.
   * On success, it updates localStorage and notifies the app of the state change.
   * @param {object} credentials - The user's credentials { client_id, password }.
   * @returns {Promise<object>} - The response data from the server.
   */
  login: async (credentials) => {
    const response = await apiClient.post('/auth/login', credentials);

    const { data } = response;
    if (!data?.success) {
      const loginError = new Error(data?.message || 'Login failed.');
      loginError.code = data?.code || 'LOGIN_FAILED';
      loginError.status = response.status;
      throw loginError;
    }

    localStorage.setItem('isAuthenticated', 'true');
    localStorage.setItem('client_id', data.client_id);
    window.dispatchEvent(new Event('authStateChanged'));

    return data;
  },

  /**
   * Registers a new user.
   * Note: This function does not automatically log the user in.
   * The backend API expects 'confirm_password', which is handled here.
   * @param {object} userData - The new user's details.
   * @returns {Promise<object>} - The response data from the server, including the new client_id.
   */
  signup: async (userData) => {
    // Match the backend's expected snake_case key
    const payload = {
      ...userData,
      confirm_password: userData.confirmPassword,
    };
    // Clean up the original key to avoid sending unnecessary data
    delete payload.confirmPassword;
    
    const response = await apiClient.post('/auth/signup', payload);
    return response.data;
  },

  /**
   * Logs the user out.
   * It attempts to notify the backend and then *always* clears local session data
   * and notifies the app of the state change.
   * Includes protection against multiple simultaneous logout attempts.
   */
  logout: async () => {
    // Prevent multiple logout attempts
    if (authService._isLoggingOut) {
      console.log('Logout already in progress, skipping duplicate attempt');
      return Promise.resolve();
    }

    authService._isLoggingOut = true;
    
    try {
      // Notify the backend to invalidate the session server-side.
      await apiClient.post('/auth/logout');
    } catch (error) {
      // Log the error but proceed with cleanup regardless, as the client-side
      // state must be cleared for security.
      console.error('Logout API call failed, but clearing local session anyway:', error.message);
    } finally {
      localStorage.removeItem('isAuthenticated');
      localStorage.removeItem('client_id');
      authService._isLoggingOut = false;
      window.dispatchEvent(new Event('authStateChanged'));
    }
  },

  /**
   * Synchronously checks if the user is authenticated based on localStorage.
   * This is very fast and useful for initial UI rendering decisions before
   * a full session verification is complete.
   * @returns {boolean} - True if the user is marked as authenticated in localStorage.
   */
  isAuthenticatedSync: () => {
    return localStorage.getItem('isAuthenticated') === 'true';
  },

  /**
   * Gets the client ID from localStorage.
   * @returns {string|null} - The client ID if available, null otherwise.
   */
  getClientId: () => {
    return localStorage.getItem('client_id');
  },

  /**
   * Verifies the current session with the backend.
   * Uses a separate axios instance to avoid console logging of expected 401s.
   * @returns {Promise<boolean>} - True if the session is valid, false otherwise.
   */
  verifySession: async () => {
    try {
      const response = await authCheckClient.get('/auth/check-auth');
      return response.data.isAuthenticated === true;
    } catch (error) {
      // Handle our custom 401 error format (silently processed)
      if (error.isAuthError && error.status === 401) {
        return false;
      }
      // Handle regular 401 errors (fallback)
      if (error.response && error.response.status === 401) {
        return false;
      }
      // Handle network errors
      if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
        console.warn('Cannot verify session - server appears to be offline');
        return false;
      }
      // For other unexpected errors, log and assume session is invalid for safety
      console.error('Unexpected error verifying session:', error.message || error);
      return false;
    }
  },
};

// Export individual functions for convenience
export const { login, signup, logout, isAuthenticatedSync, getClientId } = authService;