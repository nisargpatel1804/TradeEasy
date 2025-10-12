import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/auth.js';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/assets/ui/use-toast';

// Global flag to prevent multiple session verifications across component instances
let isVerifyingSessionGlobal = false;

// Create the context to be shared across the application
const AuthContext = createContext(null);

/**
 * The AuthProvider component is a wrapper that provides authentication state
 * and functions to all of its children components.
 */
export const AuthProvider = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(authService.isAuthenticatedSync());
  const [isLoading, setIsLoading] = useState(true); // Manages loading state for initial auth check
  const [clientId, setClientId] = useState(authService.getClientId());
  const [lastLogoutTime, setLastLogoutTime] = useState(0); // Track last logout to prevent spam
  const navigate = useNavigate();
  const { toast } = useToast();

  // Memoized logout handler to ensure consistency
  const handleLogout = useCallback(async () => {
    // Prevent rapid successive logout attempts (debounce to 1 second)
    const now = Date.now();
    if (now - lastLogoutTime < 1000) {
      console.log('Logout debounced - too soon since last logout attempt');
      return;
    }
    setLastLogoutTime(now);

    await authService.logout();
    setClientId(authService.getClientId());
    // The 'authStateChanged' event dispatched by authService will update isLoggedIn
    navigate('/login');
  }, [navigate, lastLogoutTime]);

  useEffect(() => {
    // This handler listens for login/logout events from our authService
    const handleAuthChange = () => {
      setIsLoggedIn(authService.isAuthenticatedSync());
      setClientId(authService.getClientId());
    };

    // This handler listens for 401 Unauthorized errors from our apiService
    const handleUnauthorized = (event) => {
      const isExpired = event?.detail?.reason === 'SESSION_EXPIRED';
      const message = isExpired
        ? 'Your session has expired. Please sign in again.'
        : 'Authentication issue detected. Please sign in to continue.';

      console.info(`[AuthContext] ${message}`);
      toast({
        title: isExpired ? 'Session ended' : 'Authentication required',
        description: message,
        variant: 'destructive',
      });

      handleLogout();
    };

    // Subscribe to custom events
    window.addEventListener('authStateChanged', handleAuthChange);
    window.addEventListener('unauthorized', handleUnauthorized);

    // Cleanup function to remove listeners when the component unmounts
    return () => {
      window.removeEventListener('authStateChanged', handleAuthChange);
      window.removeEventListener('unauthorized', handleUnauthorized);
    };
  }, []); // Remove dependencies that cause re-runs

  // Separate effect for initial session verification
  useEffect(() => {
    // Initial check to verify session with the backend when the app loads
    if (!isVerifyingSessionGlobal) {
      // If we're clearly logged out locally, skip check-auth to avoid 401 noise
      if (!authService.isAuthenticatedSync()) {
        setIsLoading(false);
        return;
      }
      isVerifyingSessionGlobal = true;
      authService.verifySession().then(isValid => {
        if (!isValid) {
          // If server says not authenticated, clear local state
          // Silenced info log
          localStorage.removeItem('isAuthenticated');
          localStorage.removeItem('client_id');
          window.dispatchEvent(new Event('authStateChanged'));
        }
        setIsLoading(false); // Auth check is complete
        isVerifyingSessionGlobal = false;
      }).catch(() => {
        setIsLoading(false);
        isVerifyingSessionGlobal = false;
      });
    }
  }, []); // Only run once on mount

  /**
   * Provides a login function that components can call.
   * It uses the authService to perform the login and then navigates on success.
   */
  const login = async (credentials) => {
    const response = await authService.login(credentials);
    if (response?.success) {
      if (response.client_id) {
        setClientId(response.client_id);
      }
      navigate('/dashboard');
      return response;
    }

    const loginError = new Error(response?.message || 'Login failed.');
    loginError.code = response?.code || 'LOGIN_FAILED';
    throw loginError;
  };

  // The value provided to consuming components
  const value = {
    isLoggedIn,
    isLoading,
    clientId,
    login,
    logout: handleLogout, // Provide the memoized logout function
  };

  // While checking auth, show a loading screen to prevent UI flashes
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen w-full">
        <Loader2 className="w-10 h-10 animate-spin text-gray-700" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Custom hook `useAuth` for easy consumption of the AuthContext in components.
 * This avoids the need to import `useContext` and `AuthContext` everywhere.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

