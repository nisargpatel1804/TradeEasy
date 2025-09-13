import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { fetchProfile, fetchIndices, fetchWatchlists, fetchAllIndexStocks } from './api';

// Create the context
const DataContext = createContext();

// Provider component
export function DataProvider({ children }) {
  const [profileData, setProfileData] = useState(null);
  const [indicesData, setIndicesData] = useState(null);
  const [watchlistsData, setWatchlistsData] = useState(null);
  const [stocksData, setStocksData] = useState(null);
  const [isLoadingStocks, setIsLoadingStocks] = useState(false);
  const [stocksError, setStocksError] = useState(null);
  
  // Data fetch timestamps
  const [fetchTimestamps, setFetchTimestamps] = useState({
    profile: 0,
    indices: 0,
    watchlists: 0,
    stocks: 0
  });

  // Cache TTL in milliseconds
  const CACHE_TTL = 30000; // 30 seconds
  const STOCKS_CACHE_TTL = 3600000; // 1 hour for stocks data

  // Check if cached data is still valid
  const isCacheValid = (dataType) => {
    const now = Date.now();
    const ttl = dataType === 'stocks' ? STOCKS_CACHE_TTL : CACHE_TTL;
    return (now - fetchTimestamps[dataType]) < ttl;
  };

  // Add event listener for Ctrl+Shift+R to refresh stock data
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl+Shift+R
      if (e.ctrlKey && e.shiftKey && e.key === 'r') {
        e.preventDefault(); // Prevent browser refresh
        refreshStocksData();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Controlled prefetch of index stocks – set to true if you want to load on login
  const PREFETCH_INDEX_STOCKS = false;

  // Initial fetch of stocks data (disabled by default)
  useEffect(() => {
    if (!PREFETCH_INDEX_STOCKS) return;

    const storedStocks = localStorage.getItem('cachedStocksData');
    const storedTimestamp = localStorage.getItem('stocksDataTimestamp');

    if (storedStocks && storedTimestamp) {
      try {
        const parsedStocks = JSON.parse(storedStocks);
        const timestamp = parseInt(storedTimestamp, 10);

        setStocksData(parsedStocks);
        setFetchTimestamps(prev => ({ ...prev, stocks: timestamp }));

        if (Date.now() - timestamp > STOCKS_CACHE_TTL) {
          getStocksData(true);
        }
      } catch (e) {
        console.error('Error parsing stored stocks data:', e);
        getStocksData(true);
      }
    } else {
      getStocksData(true);
    }
  }, []);

  // Fetch profile with caching
  const getProfile = useCallback(async (forceRefresh = false) => {
    if (profileData && isCacheValid('profile') && !forceRefresh) {
      return profileData;
    }
    
    const data = await fetchProfile();
    setProfileData(data);
    setFetchTimestamps(prev => ({ ...prev, profile: Date.now() }));
    return data;
  }, [profileData, fetchTimestamps]);

  // Fetch indices with caching
  const getIndices = useCallback(async (forceRefresh = false, includeMovers = false, navbarOnly = false) => {
    // Special case for navbar - check if we have cached data with the right indices
    if (navbarOnly && indicesData && isCacheValid('indices') && !forceRefresh) {
      // Filter the existing data to only Nifty 50 and Sensex indices
      const navbarIndices = indicesData.filter(idx => 
        idx.name === "Nifty 50" || idx.name === "Sensex"
      );
      
      if (navbarIndices.length === 2) {
        return navbarIndices;
      }
    }

    // Either we need all indices, or we don't have the navbar indices cached
    const options = {
      params: {}
    };
    
    if (includeMovers) {
      options.params.include_movers = 'true';
    }
    
    if (navbarOnly) {
      options.params.navbar_only = 'true';
    }

    const data = await fetchIndices(includeMovers, navbarOnly);
    setIndicesData(data);
    setFetchTimestamps(prev => ({ ...prev, indices: Date.now() }));
    return data;
  }, [indicesData, fetchTimestamps]);

  // Fetch watchlists with caching
  const getWatchlists = useCallback(async (forceRefresh = false) => {
    if (watchlistsData && isCacheValid('watchlists') && !forceRefresh) {
      return watchlistsData;
    }
    
    const data = await fetchWatchlists();
    setWatchlistsData(data);
    setFetchTimestamps(prev => ({ ...prev, watchlists: Date.now() }));
    return data;
  }, [watchlistsData, fetchTimestamps]);

  // Fetch all index stocks with caching
  const getStocksData = useCallback(async (forceRefresh = false) => {
    if (stocksData && isCacheValid('stocks') && !forceRefresh) {
      return stocksData;
    }
    
    try {
      setIsLoadingStocks(true);
      setStocksError(null);
      
      const data = await fetchAllIndexStocks();
      
      if (data.error) {
        setStocksError(data.error);
        return null;
      }
      
      setStocksData(data);
      const timestamp = Date.now();
      setFetchTimestamps(prev => ({ ...prev, stocks: timestamp }));
      
      // Save to localStorage for persistence
      localStorage.setItem('cachedStocksData', JSON.stringify(data));
      localStorage.setItem('stocksDataTimestamp', timestamp.toString());
      
      return data;
    } catch (error) {
      console.error("Error fetching stocks data:", error);
      setStocksError(error.message || "Failed to fetch stocks data");
      return null;
    } finally {
      setIsLoadingStocks(false);
    }
  }, [stocksData, fetchTimestamps]);

  // Function to manually refresh stocks data (for Ctrl+Shift+R)
  const refreshStocksData = useCallback(async () => {
    return getStocksData(true);
  }, [getStocksData]);

  // Get data for a specific stock from the cached data
  const getStockData = useCallback((symbol) => {
    if (!stocksData || !stocksData.data) return null;
    
    // Try exact match first
    if (stocksData.data[symbol]) {
      return stocksData.data[symbol];
    }
    
    // Try without extension (.NS, .BSE)
    const baseSymbol = symbol.replace(/\.(NS|NSE|BO|BSE)$/i, '');
    
    // Try to find it with .NS or .BSE
    const withNS = `${baseSymbol}.NS`;
    const withBSE = `${baseSymbol}.BSE`;
    
    return stocksData.data[withNS] || stocksData.data[withBSE] || null;
  }, [stocksData]);

  return (
    <DataContext.Provider value={{ 
      profileData, 
      indicesData, 
      watchlistsData,
      stocksData,
      isLoadingStocks,
      stocksError,
      getProfile,
      getIndices,
      getWatchlists,
      getStocksData,
      refreshStocksData,
      getStockData,
      stocksLastUpdated: fetchTimestamps.stocks ? new Date(fetchTimestamps.stocks) : null
    }}>
      {children}
    </DataContext.Provider>
  );
}

// Custom hook for using this context
const useDataContext = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useDataContext must be used within a DataProvider');
  }
  return context;
}

export { useDataContext }; 