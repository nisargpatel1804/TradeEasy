import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext.jsx';
import * as api from '../services/api.js';
import priceUpdateService from '../services/priceUpdateService.js';

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

  const [profileData, setProfileData] = useState(null);
  const [watchlistsData, setWatchlistsData] = useState(null);
  const [indicesData, setIndicesData] = useState([]);
  const [livePrices, setLivePrices] = useState({});

  const profileRef = useRef(profileData);
  const watchlistsRef = useRef(watchlistsData);
  const indicesRef = useRef(indicesData);

  const updateProfileData = useCallback((data) => {
    profileRef.current = data;
    setProfileData(data);
  }, []);

  const updateWatchlistsData = useCallback((data) => {
    watchlistsRef.current = data;
    setWatchlistsData(data);
  }, []);

  const updateIndicesData = useCallback((data) => {
    indicesRef.current = data;
    setIndicesData(data);
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isLoadingWatchlists, setIsLoadingWatchlists] = useState(false);
  const [isLoadingIndices, setIsLoadingIndices] = useState(true);

  const [error, setError] = useState(null);
  const [indicesError, setIndicesError] = useState(null);

  const resetState = useCallback(() => {
    updateProfileData(null);
    updateWatchlistsData(null);
    updateIndicesData([]);
    setLivePrices({});
    setIsLoading(false);
    setIsLoadingProfile(false);
    setIsLoadingWatchlists(false);
    setIsLoadingIndices(false);
    setError(null);
    setIndicesError(null);
  }, [updateProfileData, updateWatchlistsData, updateIndicesData]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLivePrices({});
      return;
    }

    const unsubscribe = priceUpdateService.subscribe((payload = {}) => {
      setLivePrices((prev) => {
        if (payload.type === "snapshot" || payload.type === "reset") {
          return payload.allPrices || {};
        }
        if (payload.changedPrices && Object.keys(payload.changedPrices).length > 0) {
          return { ...prev, ...payload.changedPrices };
        }
        return prev;
      });
    });

    return () => unsubscribe?.();
  }, [isAuthenticated]);

  const getProfile = useCallback(
    async (force = false) => {
      if (!isAuthenticated) {
        updateProfileData(null);
        return null;
      }

      if (!force && profileRef.current) {
        return profileRef.current;
      }

      setIsLoadingProfile(true);
      setError(null);

      try {
  const response = await api.getProfile();
  const profile = response?.profile ?? response ?? null;
  updateProfileData(profile);
        return profile;
      } catch (err) {
        console.error('Failed to load profile:', err);
        setError(err.message || 'Could not load profile.');
        throw err;
      } finally {
        setIsLoadingProfile(false);
      }
    },
    [isAuthenticated, updateProfileData]
  );

  const refreshProfile = useCallback(() => getProfile(true), [getProfile]);

  const getWatchlists = useCallback(
    async (force = false) => {
      if (!isAuthenticated) {
        updateWatchlistsData(null);
        return null;
      }

      if (!force && watchlistsRef.current) {
        return watchlistsRef.current;
      }

      setIsLoadingWatchlists(true);

      try {
  const response = await api.getWatchlists();
  updateWatchlistsData(response);
        return response;
      } catch (err) {
        console.error('Failed to load watchlists:', err);
        setError(err.message || 'Could not load watchlists.');
        throw err;
      } finally {
        setIsLoadingWatchlists(false);
      }
    },
    [isAuthenticated, updateWatchlistsData]
  );

  const refreshWatchlists = useCallback(() => getWatchlists(true), [getWatchlists]);

  const createWatchlist = useCallback(
    async (name) => {
      const response = await api.createWatchlist(name);
      await getWatchlists(true);
      return response;
    },
    [getWatchlists]
  );

  const renameWatchlist = useCallback(
    async (watchlistName, newName) => {
      const response = await api.renameWatchlist(watchlistName, newName);
      await getWatchlists(true);
      return response;
    },
    [getWatchlists]
  );

  const deleteWatchlist = useCallback(
    async (watchlistName) => {
      const response = await api.deleteWatchlist(watchlistName);
      await getWatchlists(true);
      return response;
    },
    [getWatchlists]
  );

  const addStockToWatchlist = useCallback(
    async (watchlistName, stockData) => {
      const response = await api.addStockToWatchlist(watchlistName, stockData);
      await getWatchlists(true);
      return response;
    },
    [getWatchlists]
  );

  const removeStockFromWatchlist = useCallback(
    async (watchlistName, symbol) => {
      const response = await api.removeStockFromWatchlist(watchlistName, symbol);
      await getWatchlists(true);
      return response;
    },
    [getWatchlists]
  );

  const getInitialIndices = useCallback(
    async (force = false) => {
      if (!isAuthenticated) {
        updateIndicesData([]);
        return [];
      }

      if (!force && Array.isArray(indicesRef.current) && indicesRef.current.length > 0) {
        return indicesRef.current;
      }

      setIsLoadingIndices(true);
      setIndicesError(null);

      try {
        const response = await api.getMarketIndices();
        const indices = Array.isArray(response?.indices) ? response.indices : [];
        updateIndicesData(indices);
        if (indices.length > 0) {
          const priceMap = indices.reduce((acc, item = {}) => {
            if (item.symbol) {
              acc[item.symbol] = { ...item, entityType: 'index' };
            }
            return acc;
          }, {});
          priceUpdateService.seedPrices(priceMap);
        }
        return indices;
      } catch (err) {
        updateIndicesData([]);
        setIndicesError(err.message || 'Could not load market indices.');
        return [];
      } finally {
        setIsLoadingIndices(false);
      }
    },
    [isAuthenticated, updateIndicesData]
  );

  /**
   * Fetches all essential application data from the backend.
   * This is typically called once after the user logs in.
   */
  const fetchInitialData = useCallback(async () => {
    if (!isAuthenticated) {
      resetState();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await Promise.allSettled([
        getProfile(true),
        getWatchlists(true),
        getInitialIndices(true),
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [getInitialIndices, getProfile, getWatchlists, isAuthenticated, resetState]);

  // Effect to trigger the initial data fetch when the user's authentication state changes.
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const contextValue = {
    profileData,
    watchlistsData,
    indicesData,
    livePrices,
    isLoading,
    isLoadingProfile,
    isLoadingWatchlists,
    isLoadingIndices,
    error,
    indicesError,
    getProfile,
    refreshProfile,
    getWatchlists,
    refreshWatchlists,
    createWatchlist,
    renameWatchlist,
    deleteWatchlist,
    addStockToWatchlist,
    removeStockFromWatchlist,
    getInitialIndices,
    // Backwards compatibility conveniences
    profile: profileData,
    watchlists: watchlistsData?.watchlists ?? [],
  };

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

