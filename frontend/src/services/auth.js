import { apiClient } from './api';

// This module re‑exports the simple wrappers for signup/login/logout but
// retains a custom checkAuth implementation.  The latter was previously
// responsible for treating 401 responses and timeouts as a harmless
// "not authenticated" result, which is convenient during app startup.

export { signup, login, logout } from './api';

/**
 * Checks if the current user's session is still valid with the backend.
 * This is a protected route, so it will fail with a 401 error if the session is
 * invalid.  The caller (AuthContext) expects the function to resolve to an
 * object instead of rejecting when the session is gone.  In addition to the
 * basic `isAuthenticated/user` fields we also return `profile` now so the
 * client can bootstrap user data without making a second HTTP request.
 */
export const checkAuth = () => {
  return apiClient
    .get('/check-auth', {
      timeout: 8000,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 401,
    })
    .then((res) => {
      if (res.status === 401) {
        return { isAuthenticated: false, user: null };
      }
      return res.data;
    })
    .catch((error) => {
      if (
        error?.code === 'ECONNABORTED' ||
        error?.status === 401 ||
        error?.response?.status === 401
      ) {
        return { isAuthenticated: false, user: null };
      }
      throw error;
    });
};

