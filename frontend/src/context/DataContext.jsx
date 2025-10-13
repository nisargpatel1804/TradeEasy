import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import * as api from '../services/api.js';

const DataContext = createContext(null);

/**
 * Custom hook to easily access the DataContext from any component.
 * @returns {object} The data context value.
 */
export const useData = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};

export const useDataContext = useData;

/**
 * The DataProvider component fetches, caches, and provides application-wide
 * data to all its children. It is dependent on the AuthContext.
 */
export const DataProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [profile, setProfile] = useState(null);
  const [watchlists, setWatchlists] = useState([]);
  const [indices, setIndices] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetches all essential application data from the backend.
   * This is typically called once after the user logs in.
   */
  const fetchInitialData = useCallback(async () => {
    if (!isAuthenticated) {
        // Clear data when user logs out
        setProfile(null);
        setWatchlists([]);
        setIndices([]);
        return;
    };

    setIsLoading(true);
    setError(null);

    try {
      // Fetch all data in parallel for better performance
      const [profileData, watchlistsData, indicesData] = await Promise.all([
        api.getProfile(),
        api.getWatchlists(),
        api.getMarketIndices(),
      ]);

      setProfile(profileData.profile);
      setWatchlists(watchlistsData.watchlists);
      setIndices(indicesData.indices);
      
    } catch (err) {
      console.error("Failed to fetch initial application data:", err);
      setError(err.message || "Could not load data.");
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  // Effect to trigger the initial data fetch when the user's authentication state changes.
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  /**
   * Provides a function to manually refetch the watchlists.
   * Useful after a user creates a new watchlist or adds a stock.
   */
  const refetchWatchlists = async () => {
    try {
  const watchlistsData = await api.getWatchlists();
      setWatchlists(watchlistsData.watchlists);
    } catch (err) {
      console.error("Failed to refetch watchlists:", err);
    }
  };

  const contextValue = {
    profile,
    watchlists,
    indices,
    isLoading,
    error,
    refetchWatchlists,
    // We will add functions here later to update indices from WebSocket data
  };

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

