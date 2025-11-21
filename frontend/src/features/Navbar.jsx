import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDataContext } from '../context/DataContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import * as api from '../services/api.js';
import priceUpdateService from '../services/priceUpdateService.js';
import { Button } from '../assets/ui/button.jsx';
import { Input } from '../assets/ui/input.jsx';
import { Avatar, AvatarFallback } from '../assets/ui/Avatar.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../assets/ui/dropdown-menu.jsx';
import { Search, LogOut, User, Menu, X, Loader2, Plus, TrendingUp } from 'lucide-react';
import { useToast } from '../assets/ui/use-toast.js';
import debounce from 'lodash.debounce';

const HEADLINE_INDEX_CONFIG = {
  'NSE:26000': { label: 'Nifty 50' },
  'BSE:999901': { label: 'Sensex' },
};

const HEADLINE_SYMBOLS = Object.keys(HEADLINE_INDEX_CONFIG);

const Navbar = () => {
  const { isAuthenticated, logout, user } = useAuth();
  const { profileData, getProfile, watchlistsData, getWatchlists, indicesData } = useDataContext();
  const { isConnected, connectionStatus, isReconnecting, lastError } = useSocket();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchRef = useRef(null);

  const [headlineIndices, setHeadlineIndices] = useState(() =>
    HEADLINE_SYMBOLS.reduce((acc, symbol) => {
      acc[symbol] = null;
      return acc;
    }, {})
  );

  const normaliseIndexPayload = useCallback((payload = {}, symbol) => {
    if (!payload || !symbol) {
      return null;
    }

    const config = HEADLINE_INDEX_CONFIG[symbol] || {};
    const coerceNumber = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const price = coerceNumber(payload.price ?? payload.ltp ?? payload.last_price ?? payload.lastTradedPrice ?? payload.value);
    const change = coerceNumber(payload.change ?? payload.net_change ?? payload.netChange ?? payload.change_amount);
    const percentChange = coerceNumber(payload.percent_change ?? payload.percentChange ?? payload.change_percent ?? payload.pChange);

    if (price === null) {
      return null;
    }

    return {
      symbol,
      name: payload.name || config.label || symbol,
      label: config.label || payload.name || symbol,
      price,
      change: change ?? 0,
      percentChange: percentChange ?? 0,
    };
  }, []);

  const updateHeadlineFromMap = useCallback((priceMap = {}) => {
    if (!priceMap || typeof priceMap !== 'object') {
      return;
    }

    setHeadlineIndices((prev) => {
      let mutated = false;
      const next = { ...prev };

      HEADLINE_SYMBOLS.forEach((symbol) => {
        const normalized = normaliseIndexPayload(priceMap[symbol], symbol);
        if (!normalized) {
          return;
        }

        const current = prev[symbol];
        if (!current ||
          current.price !== normalized.price ||
          current.change !== normalized.change ||
          current.percentChange !== normalized.percentChange ||
          current.name !== normalized.name) {
          next[symbol] = normalized;
          mutated = true;
        }
      });

      return mutated ? next : prev;
    });
  }, [normaliseIndexPayload]);

  const formatNumber = (value, fractionDigits = 2) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '--';
    }
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  };

  const formatSigned = (value, fractionDigits = 2) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '--';
    }
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    const absValue = Math.abs(value).toFixed(fractionDigits);
    return sign ? `${sign}${absValue}` : absValue;
  };

  const getTrendClass = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
      return 'text-gray-500 dark:text-gray-400';
    }
    return value > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  };

  // Fetch profile and watchlists on mount if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      getProfile();
      getWatchlists();
    }
  }, [isAuthenticated, getProfile, getWatchlists]);

  const handleLogout = () => {
    logout();
    toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
    navigate('/login');
  };

  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (query.length < 2) {
        setSearchResults([]);
        setIsSearchLoading(false);
        return;
      }
      try {
        const results = await api.searchStocks(query);
        setSearchResults(results || []);
      } catch (error) {
        console.error("Search failed:", error);
        setSearchResults([]);
      } finally {
        setIsSearchLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    setIsSearchLoading(true);
    debouncedSearch(searchQuery);
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  useEffect(() => {
    if (!Array.isArray(indicesData) || indicesData.length === 0) {
      return;
    }

    const map = indicesData.reduce((acc, item = {}) => {
      if (item.symbol) {
        acc[item.symbol] = item;
      }
      return acc;
    }, {});

    updateHeadlineFromMap(map);
  }, [indicesData, updateHeadlineFromMap]);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe((payload = {}) => {
      updateHeadlineFromMap(payload.allPrices || {});
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateHeadlineFromMap]);

  // Handle click outside of search to close results
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAddStock = async (e, stock) => {
    e.stopPropagation();
    const defaultWatchlist = watchlistsData?.watchlists.find(w => !w.is_deletable);
    if (!defaultWatchlist) {
      toast({ title: 'Error', description: 'Default watchlist not found.', variant: 'destructive' });
      return;
    }
    const existingSymbols = new Set((defaultWatchlist.stocks || []).map(item => item?.symbol?.toUpperCase()).filter(Boolean));
    if (existingSymbols.has(stock.symbol.toUpperCase())) {
      toast({
        title: 'Already added',
        description: `${stock.symbol} is already in ${defaultWatchlist.name}.`,
      });
      setSearchQuery('');
      return;
    }
    try {
      await api.addStockToWatchlist(defaultWatchlist.name, {
        symbol: stock.symbol,
        name: stock.name,
        scripcode: stock.scripcode
      });
      toast({ title: 'Success', description: `${stock.symbol} added to ${defaultWatchlist.name}.` });
      getWatchlists(true); // Refresh watchlist data
      setSearchQuery(''); // Clear search
    } catch (error) {
      const friendlyMessage = error?.status === 409
        ? `${stock.symbol} is already in ${defaultWatchlist.name}.`
        : (error?.message || 'Unable to add stock to watchlist.');
      toast({ title: 'Error', description: friendlyMessage, variant: 'destructive' });
    }
  };

  if (!isAuthenticated) {
    return null; // Don't render navbar on auth pages
  }

  const profileInitial = profileData?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U';

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
      {/* Indices Header */}
      <div className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-end gap-6 py-2">
            {HEADLINE_SYMBOLS.map((symbol) => {
              const config = HEADLINE_INDEX_CONFIG[symbol];
              const data = headlineIndices[symbol];
              const percentValue = data?.percentChange ?? null;

              return (
                <div key={symbol} className="flex flex-col items-end min-w-[140px]" title={data?.name || config.label}>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {config.label}
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatNumber(data?.price)}
                    </span>
                    <span className={`text-xs font-semibold ${getTrendClass(percentValue)}`}>
                      {formatSigned(data?.change)} ({formatSigned(percentValue)}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Navbar Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link to="/dashboard" className="flex-shrink-0 flex items-center gap-2">
              <TrendingUp className="h-8 w-8 text-blue-600" />
              <span className="font-bold text-xl text-gray-800 dark:text-white">TradeEasy</span>
            </Link>
            <div className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-4">
                <Link to="/dashboard" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">Dashboard</Link>
                <Link to="/watchlist" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">Watchlist</Link>
                <Link to="/portfolio" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">Portfolio</Link>
                <Link to="/orders" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white px-3 py-2 rounded-md text-sm font-medium">Orders</Link>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Search Bar */}
            <div className="relative hidden md:block" ref={searchRef}>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <Input
                type="text"
                placeholder="Search stocks..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
              />
              {isSearchFocused && searchQuery && (
                <div className="absolute mt-2 w-72 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5">
                  {isSearchLoading ? (
                    <div className="p-4 text-center text-sm text-gray-500">
                      <Loader2 className="h-5 w-5 animate-spin inline-block"/>
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="py-1 max-h-80 overflow-y-auto">
                      {searchResults.map((stock) => (
                        <div key={stock.symbol} className="flex items-center justify-between px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700">
                           <div className="text-sm cursor-pointer" onClick={() => navigate(`/stock/${stock.symbol}`)}>
                            <p className="font-medium text-gray-900 dark:text-white">{stock.symbol}</p>
                            <p className="text-gray-500 dark:text-gray-400 truncate w-40">{stock.name}</p>
                          </div>
                           <Button size="sm" variant="ghost" onClick={(e) => handleAddStock(e, stock)}><Plus className="h-4 w-4" /></Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-gray-500">No results found.</div>
                  )}
                </div>
              )}
            </div>

            {/* Connection Status */}
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
              <span
                className={`inline-block h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : isReconnecting ? 'bg-amber-400' : 'bg-red-500'}`}
                title={
                  isConnected
                    ? 'Live market data connected'
                    : isReconnecting
                      ? 'Reconnecting to live market data'
                      : lastError?.message || 'Live market data disconnected'
                }
                data-status={connectionStatus}
              ></span>
              <span>
                {connectionStatus === 'reconnecting' ? 'Reconnecting…' : isConnected ? 'Live' : 'Offline'}
              </span>
            </div>

            {/* Profile Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{profileInitial}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{profileData?.username || user?.username}</p>
                    <p className="text-xs leading-none text-muted-foreground">{profileData?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="-mr-2 flex md:hidden">
            <Button variant="ghost" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3">
            <Link to="/dashboard" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white block px-3 py-2 rounded-md text-base font-medium">Dashboard</Link>
            <Link to="/watchlist" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white block px-3 py-2 rounded-md text-base font-medium">Watchlist</Link>
            <Link to="/portfolio" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white block px-3 py-2 rounded-md text-base font-medium">Portfolio</Link>
            <Link to="/orders" className="text-gray-500 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white block px-3 py-2 rounded-md text-base font-medium">Orders</Link>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;

