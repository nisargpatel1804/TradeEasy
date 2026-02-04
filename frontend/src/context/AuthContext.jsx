import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import * as authService from '../services/auth.js'; // Using the dedicated auth service with .js extension
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

/**
 * Custom hook to easily access the AuthContext from any component.
 * @returns {object} The authentication context value.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * The AuthProvider component wraps the application and provides global
 * authentication state and functions.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Manages loading for the initial session check
  const navigate = useNavigate();

  const isLoggingOutRef = useRef(false);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setIsAuthenticated(false);
    navigate('/');
  }, [navigate]);

  // Clears local UI caches (search results, in-memory caches, etc.) when auth changes.
  const clearLocalSearchCaches = useCallback(() => {
    try {
      // Emit an event so components using hooks (e.g. search) can clear their local state.
      window.dispatchEvent(new CustomEvent('clear-local-search-caches'));
      // As a fallback, attempt to clear anything in localStorage namespaced for search.
      try {
        Object.keys(localStorage).forEach(k => {
          if (k && k.toLowerCase().includes('search')) {
            localStorage.removeItem(k);
          }
        });
      } catch (err) {
        // localStorage may be unavailable in some environments - ignore.
      }
    } catch (err) {
      // Silently ignore to avoid breaking auth flow.
      console.debug('clearLocalSearchCaches failed', err);
    }
  }, []);

  /**
   * Memoized logout function. It calls the logout service, updates state,
   * and navigates the user to the login page only on successful logout.
   */
  const handleLogout = useCallback(async () => {
    if (isLoggingOutRef.current) {
      return;
    }
    isLoggingOutRef.current = true;

    try {
      try {
        await authService.logout();
      } catch (error) {
        // If session is already expired, backend may return 401.
        // Treat it as success so UI can still log out cleanly.
        if (error?.status !== 401) {
          throw error;
        }
      }

      clearAuthState();
    } catch (error) {
      // If we can't log out server-side, still clear local state to prevent broken sessions.
      clearAuthState();
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [clearAuthState]);
  
  // Effect to verify user session on initial application load.
  useEffect(() => {
    const verifyUserSession = async () => {
      try {
        const data = await authService.checkAuth();
        if (data.isAuthenticated) {
          setUser(data.user);
          setIsAuthenticated(true);
        } else {
          clearLocalSearchCaches();
        }
      } catch (error) {
        // This is expected if the user is not logged in.
        // The api.js interceptor will handle the 401.
        setUser(null);
        setIsAuthenticated(false);
        clearLocalSearchCaches();
      } finally {
        setIsLoading(false);
      }
    };
    
    verifyUserSession();
  }, [clearLocalSearchCaches]);

  // Effect to listen for the global 'unauthorized' event dispatched by api.js
  useEffect(() => {
    const onUnauthorized = () => {
      // Important: do NOT call server logout here.
      // When the session is already invalid, calling /logout can 401 and create loops.
      if (!isLoggingOutRef.current) {
        isLoggingOutRef.current = true;
        clearAuthState();
        isLoggingOutRef.current = false;
      }
    };

    window.addEventListener('unauthorized', onUnauthorized);

    return () => {
      window.removeEventListener('unauthorized', onUnauthorized);
    };
  }, [clearAuthState]);

  /**
   * Login function to be called from components.
   * It uses the authService, updates the state on success, and navigates.
   * @param {object} credentials - { client_id, password }
   */
  const login = async (credentials) => {
    const data = await authService.login(credentials);
    if (data.success) {
      setUser(data.user);
      setIsAuthenticated(true);
      navigate('/dashboard'); // Navigate to a protected route on successful login
    }
    return data;
  };

  const contextValue = {
    user,
    isAuthenticated,
    isLoading,
    login,
    logout: handleLogout,
  };

  // While checking the initial session, display a loading indicator.
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

