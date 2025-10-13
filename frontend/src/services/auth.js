import { apiClient } from './api';

/**
 * A dedicated service module for handling all authentication-related API calls.
 */

/**
 * Registers a new user.
 * @param {object} credentials - The user's registration details 
 * (e.g., { email, mobile, password, confirm_password }).
 * @returns {Promise<any>} The response data from the server.
 */
export const signup = (credentials) => {
  return apiClient.post('/signup', credentials).then(res => res.data);
};

/**
 * Logs a user in.
 * @param {object} credentials - The user's login credentials ({ client_id, password }).
 * @returns {Promise<any>} The response data from the server, including user details on success.
 */
export const login = (credentials) => {
  return apiClient.post('/login', credentials).then(res => res.data);
};

/**
 * Logs the current user out by invalidating the session on the server.
 * @returns {Promise<any>} The confirmation message from the server.
 */
export const logout = () => {
  return apiClient.post('/logout').then(res => res.data);
};

/**
 * Checks if the current user's session is still valid with the backend.
 * This is a protected route, so it will fail with a 401 error if the session is invalid.
 * @returns {Promise<any>} The user's session details if authenticated.
 */
export const checkAuth = () => {
  return apiClient.get('/check-auth').then(res => res.data);
};
