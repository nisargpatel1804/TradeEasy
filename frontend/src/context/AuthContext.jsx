import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
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

  /**
   * Memoized logout function. It calls the logout service, updates state,
   * and navigates the user to the login page only on successful logout.
   */
  const handleLogout = useCallback(async () => {
    try {
      await authService.logout();
      // Only clear state and navigate if logout succeeds
      setUser(null);
      setIsAuthenticated(false);
      navigate('/login');
    } catch (error) {
      console.error("Logout failed:", error);
      // Keep user on current page and let them know logout failed
      throw error; // Re-throw so calling components can handle it
    }
  }, [navigate]);
  
  // Effect to verify user session on initial application load.
  useEffect(() => {
    const verifyUserSession = async () => {
      try {
        const data = await authService.checkAuth();
        if (data.isAuthenticated) {
          setUser(data.user);
          setIsAuthenticated(true);
        }
      } catch (error) {
        // This is expected if the user is not logged in.
        // The api.js interceptor will handle the 401.
        setUser(null);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };
    
    verifyUserSession();
  }, []);

  // Effect to listen for the global 'unauthorized' event dispatched by api.js
  useEffect(() => {
    const onUnauthorized = () => {
      console.log("Session expired or invalid. Logging out.");
      handleLogout();
    };

    window.addEventListener('unauthorized', onUnauthorized);

    return () => {
      window.removeEventListener('unauthorized', onUnauthorized);
    };
  }, [handleLogout]);

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

