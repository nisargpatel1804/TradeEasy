import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { fetchProfile, fetchIndices, fetchWatchlists } from '../services/api';
import { useSocketContext } from './SocketContext';

const DataContext = createContext();

export function DataProvider({ children }) {
  const [profileData, setProfileData] = useState(null);
  const [watchlistsData, setWatchlistsData] = useState(null);
  const [indicesData, setIndicesData] = useState([]);
  const [isLoadingIndices, setIsLoadingIndices] = useState(true);
  const [hasReceivedInitialData, setHasReceivedInitialData] = useState(false);
  const [lastWatchlistsFetch, setLastWatchlistsFetch] = useState(0);
  const [lastProfileFetch, setLastProfileFetch] = useState(0);
  
  // --- New state for handling user-facing errors ---
  const [indicesError, setIndicesError] = useState(null);

  const { socket } = useSocketContext();

  useEffect(() => {
    if (!socket) return;

    const handleInitialData = (initialData) => {
        setIndicesData(initialData);
        setIsLoadingIndices(false);
        setHasReceivedInitialData(true);
        setIndicesError(null); // Clear error on successful data receipt
    };

    const handleIndexUpdate = (updatedIndex) => {
      setIsLoadingIndices(false); 
      setIndicesData(prevIndices => {
        const indexExists = prevIndices.some(idx => idx.symbol === updatedIndex.symbol);
        if (indexExists) {
          return prevIndices.map(idx =>
            idx.symbol === updatedIndex.symbol ? { ...idx, ...updatedIndex } : idx
          );
        } else {
          return [...prevIndices, updatedIndex];
        }
      });
    };

    socket.on('initial_indices', handleInitialData);
    socket.on('index_update', handleIndexUpdate);

    return () => {
      socket.off('initial_indices', handleInitialData);
      socket.off('index_update', handleIndexUpdate);
    };
  }, [socket]);

  const getInitialIndices = useCallback(async (force = false) => {
    if ((indicesData.length > 0 || hasReceivedInitialData) && !force) return;

    // Set loading state for retries
    setIsLoadingIndices(true);
    setIndicesError(null);

    try {
      const data = await fetchIndices();
      if (indicesData.length === 0 && !hasReceivedInitialData) {
        setIndicesData(data);
        setIndicesError(null); // Clear error on success
      }
    } catch (error) {
      if (error?.code === 'SESSION_EXPIRED') {
        console.info('[DataContext] Skipping HTTP indices fallback because the session is inactive.');
        // No need to show a user-facing error when the user is simply logged out.
        setIndicesError(null);
      } else {
        console.error('Failed to fetch initial indices via HTTP:', error);
        // --- Set a user-friendly error message ---
        setIndicesError('Could not connect to market data service. Please check your connection and try again.');
      }
    } finally {
        setIsLoadingIndices(false);
    }
  }, [indicesData.length, hasReceivedInitialData]);

  useEffect(() => {
      if (indicesData.length === 0 && !hasReceivedInitialData) {
        getInitialIndices();
      }
  }, [getInitialIndices, indicesData.length, hasReceivedInitialData]);

  const getProfile = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && profileData && now - lastProfileFetch < 15000) {
      return profileData;
    }
    const data = await fetchProfile();
    setProfileData(data);
    setLastProfileFetch(now);
    return data;
  }, [profileData, lastProfileFetch]);

  const getWatchlists = useCallback(async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && watchlistsData && now - lastWatchlistsFetch < 10000) {
      return watchlistsData;
    }
    const data = await fetchWatchlists();
    setWatchlistsData(data);
    setLastWatchlistsFetch(now);
    return data;
  }, [watchlistsData, lastWatchlistsFetch]);

  const contextValue = React.useMemo(() => ({
    profileData,
    indicesData,
    watchlistsData,
    isLoadingIndices,
    indicesError,
    getProfile,
    getWatchlists,
    getInitialIndices,
  }), [profileData, indicesData, watchlistsData, isLoadingIndices, indicesError, getProfile, getWatchlists, getInitialIndices]);

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
}

export const useDataContext = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useDataContext must be used within a DataProvider');
  }
  return context;
};