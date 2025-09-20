import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  createWatchlist,
  deleteWatchlist,
  fetchWatchlistStocks,
  addStockToWatchlist,
  removeStockFromWatchlist,
  searchStocks,
} from "@/services/api";
import { useDataContext } from "@/context/DataContext";
import priceUpdateService from "@/services/priceUpdateService";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { Skeleton } from "@/assets/ui/skeleton";
import { toast } from "react-hot-toast";
import { Search, Plus, Trash2, TrendingUp, TrendingDown } from "lucide-react";
import debounce from "lodash.debounce";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/features/Navbar";
import TradeForm from "@/features/TradeForm";
import "@/assets/css/watchlist.css";

const Watchlist = () => {
  const [watchlists, setWatchlists] = useState([]);
  const [activeWatchlist, setActiveWatchlist] = useState(null);
  const [watchlistStocks, setWatchlistStocks] = useState([]);
  const [loading, setLoading] = useState({ lists: true, stocks: false });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const watchlistCacheRef = useRef({});
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [realTimePrices, setRealTimePrices] = useState({});
  const [priceUpdateStatus, setPriceUpdateStatus] = useState({
    isConnected: false,
    lastUpdate: null,
    updateCount: 0
  });
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [tradeAction, setTradeAction] = useState("buy");
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  
  // Get shared context data
  const { getIndices, getWatchlists } = useDataContext();

  const navigate = useNavigate();

  // Add click outside functionality to close search dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Close search dropdown when clicking outside
      if (!event.target.closest('.search-container') && !event.target.closest('[data-search-trigger]')) {
        setSearchQuery("")
        setSearchResults([])
        setSearching(false)
        setShowSearchResults(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // --- Layout helpers & page behaviour ---
  // Always start the page scrolled to top to avoid the search bar being hidden beneath the navbar on first load / refresh.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, []);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      const searchContainer = event.target.closest('.watchlist-search-container')
      if (!searchContainer) {
        setShowSearchResults(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, []);

  // Only show custom watchlists (should just be "Stocks")
  const customWatchlists = watchlists;

  // Locate the default 'Stocks' watchlist (if present)
  const stocksWatchlist = watchlists.find((w) => w.name?.toLowerCase() === "stocks");

  const loadWatchlists = useCallback(async () => {
    setLoading(prev => ({ ...prev, lists: true }));
    const res = await getWatchlists();
    if (!res.error) {
      // Only show "Stocks" watchlist - filter out others
      const stocksWatchlist = res.filter(w => w.name === "Stocks");
      
      setWatchlists(stocksWatchlist);

      // Set active to Stocks watchlist
      const stocks = stocksWatchlist.find(w => w.name === "Stocks");
      const desired = stocks || stocksWatchlist[0] || null;

      // Update only if different to avoid unnecessary renders
      if (desired && (!activeWatchlist || activeWatchlist.id !== desired.id)) {
        setActiveWatchlist(desired);
      }
    } else {
      toast.error("Could not load watchlists.");
    }
    setLoading(prev => ({ ...prev, lists: false }));
  }, []);

  // Flag to prevent duplicate API calls in React's StrictMode
  const [hasLoadedWatchlists, setHasLoadedWatchlists] = useState(false);

  // Load user watchlists on initial render.
  useEffect(() => {
    if (!hasLoadedWatchlists) {
      loadWatchlists();
      setHasLoadedWatchlists(true);
    }
  }, [loadWatchlists, hasLoadedWatchlists]);

  // Real-time price updates
  useEffect(() => {
    // Subscribe to price updates only if we have stocks to track
    if (watchlistStocks.length === 0) return;

    const unsubscribe = priceUpdateService.subscribe((priceData) => {
      const { allPrices, changedPrices, isConnected, error } = priceData;
      
      // Update connection status
      setPriceUpdateStatus(prev => ({
        isConnected: isConnected !== undefined ? isConnected : prev.isConnected,
        lastUpdate: isConnected ? new Date().toLocaleTimeString() : prev.lastUpdate,
        updateCount: isConnected ? prev.updateCount + 1 : prev.updateCount
      }));
      
      if (isConnected && allPrices && Object.keys(allPrices).length > 0) {
        // Update watchlist stocks with new prices
        setWatchlistStocks(prevStocks => 
          prevStocks.map(stock => {
            const newPriceData = allPrices[stock.symbol];
            if (newPriceData) {
              return {
                ...stock,
                price: newPriceData.ltp,
                change: newPriceData.change,
                percent_change: newPriceData.percent_change,
                last_updated: newPriceData.last_updated
              };
            }
            return stock;
          })
        );
        
        // Update real-time prices state
        setRealTimePrices(allPrices);
      }
      
      if (error) {
        console.warn('Price update service error:', error);
      }
    });

    // Cleanup subscription on unmount or when stocks change
    return unsubscribe;
  }, [watchlistStocks.length > 0]);

  useEffect(() => {
    const fetchStocks = async () => {
      if (activeWatchlist) {
        if (watchlistCacheRef.current[activeWatchlist.id]) {
          setWatchlistStocks(watchlistCacheRef.current[activeWatchlist.id]);
          return;
        }
        // fetch real stocks
        setLoading(prev => ({ ...prev, stocks: true }));
        const res = await fetchWatchlistStocks(activeWatchlist.id);
        if (!res.error) {
          // The backend now returns full stock data
          setWatchlistStocks(res.stocks || []);
          watchlistCacheRef.current[activeWatchlist.id] = res.stocks || [];
        } else {
          setWatchlistStocks([]);
          toast.error(`Could not load stocks for ${activeWatchlist.name}`);
        }
        setLoading(prev => ({ ...prev, stocks: false }));
      } else {
        setWatchlistStocks([]);
      }
    };
    fetchStocks();
  }, [activeWatchlist]);
  
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (!query.trim()) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      
      // Keep loading state that was set immediately
      try {
        const results = await searchStocks(query);
        
        // Handle the new backend response format
        let filtered = [];
        if (Array.isArray(results)) {
          filtered = results;
        } else if (results?.error) {
          console.warn('Search error:', results.error);
          setSearchResults([]);
          setSearching(false);
          return;
        }
        
        // Remove duplicates and exclude symbols already in current watchlist
        const currentSymbols = new Set(watchlistStocks.map((stk) => stk.symbol.toUpperCase()));
        const deduped = [];
        const seen = new Set();
        
        for (const s of filtered) {
          const symbol = s["1. symbol"];
          if (!symbol) continue;
          
          const symbolNorm = symbol.toUpperCase();
          if (seen.has(symbolNorm) || currentSymbols.has(symbolNorm)) continue;
          
          seen.add(symbolNorm);
          deduped.push(s);
        }
        
        setSearchResults(deduped);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      }
      setSearching(false);
    }, 300),
    [watchlistStocks]
  );

  useEffect(() => {
    if (searchQuery.trim()) {
      // Show loader immediately when user starts typing
      setSearching(true);
      setShowSearchResults(true);
    } else {
      setSearchResults([]);
      setSearching(false);
      setShowSearchResults(false);
    }
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

    const handleAddStock = async (stock) => {
    if (!stocksWatchlist) {
      toast.error("Stocks watchlist not found.");
      return;
    }

    // Prevent adding duplicates that already exist in Stocks
    const stocksSymbols = new Set(watchlistStocks.map((stk) => stk.symbol.toUpperCase()));
    if (stocksSymbols.has(stock["1. symbol"].toUpperCase())) {
      toast.error("Stock already exists in Stocks.");
      return;
    }

    setSearchQuery("");
    setSearchResults([]);

    const res = await addStockToWatchlist(
      stocksWatchlist.id,
      stock["1. symbol"],
      stock["2. name"]
    );

    if (!res.error) {
      toast.success(`${stock["1. symbol"]} added.`);

      // Use stock data from backend response if available, otherwise use defaults
      const stockData = res.stock_data || {};
      
      // Optimistically update local state so UI reflects immediately
      setWatchlistStocks((prev) => [
        ...prev,
        {
          symbol: stock["1. symbol"],
          name: stock["2. name"],
          price: stockData.price || 0,
          change: stockData.change || 0,
          percent_change: stockData.percent_change || 0,
        },
      ]);

      // Emit global event so other components (e.g. Navbar) refresh
      window.dispatchEvent(
        new CustomEvent("watchlist-stock-added", {
          detail: {
            watchlistId: stocksWatchlist.id,
            symbol: stock["1. symbol"],
            name: stock["2. name"],
            price: stockData.price || 0,
            change: stockData.change || 0,
            percent_change: stockData.percent_change || 0,
          },
        })
      );

      // Force refresh of DataContext cache
      getWatchlists(true);
    } else {
      toast.error(res.error);
    }
  };

  const handleRemoveStock = async (symbol) => {
    if (!activeWatchlist) return;
    const res = await removeStockFromWatchlist(activeWatchlist.id, symbol);
    if (!res.error) {
      toast.success(`${symbol.toUpperCase()} removed.`);

      // Optimistically update local state
      setWatchlistStocks((prev) =>
        prev.filter((stk) => stk.symbol.toUpperCase() !== symbol.toUpperCase())
      );

      // Force refresh of DataContext cache so other components update
      getWatchlists(true);
    } else {
      toast.error(res.error || "Failed to remove stock");
    }
  };

  const handleTrade = (stock, action) => {
    setSelectedStock(stock);
    setTradeAction(action);
    setShowTradeForm(true);
  };

  const handleTradeSuccess = () => {
    setShowTradeForm(false);
    setSelectedStock(null);
    toast.success("Trade executed successfully!");
  };

  /* ------------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------------ */

  return (
    <>
      <Navbar />

      <div className="container mx-auto mt-24 p-4 max-w-7xl">
        {/* Watchlist Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {watchlists.map((wl) => (
            <Button
              key={wl.id || wl.name}
              variant={activeWatchlist?.id === wl.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveWatchlist(wl)}
            >
              {wl.name === "Nifty50" ? "Nifty 50" : wl.name}
            </Button>
          ))}
        </div>

        {/* -------------------  MAIN CONTENT  ------------------- */}
        <div className="flex flex-col">
          {/* ---------------- MAIN AREA ---------------- */}
          <section className="flex-1 flex flex-col gap-6">
            {/* Price Update Status Indicator */}
            {activeWatchlist && watchlistStocks.length > 0 && (
              <div className="p-2 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${priceUpdateStatus.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span>Live Price Updates</span>
                    {priceUpdateStatus.isConnected && priceUpdateStatus.lastUpdate && (
                      <span className="text-gray-500">Last: {priceUpdateStatus.lastUpdate}</span>
                    )}
                  </div>
                  <div className="text-gray-500">
                    {priceUpdateStatus.updateCount > 0 && `${priceUpdateStatus.updateCount} updates`}
                  </div>
                </div>
              </div>
            )}

            {/* Search bar (for all watchlists) */}
            {activeWatchlist && (
              <div className="mb-4 watchlist-search-container">
                <div className="relative">
                  <Input
                    placeholder="Search stocks by name or symbol..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => searchQuery.trim() && setShowSearchResults(true)}
                    className="w-full pl-10"
                  />
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  {searching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Search Results */}
            {activeWatchlist && (
              <>
                {showSearchResults && !searching && searchQuery.trim() !== "" && searchResults.length === 0 && (
                  <div className="p-4 mb-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">
                          No stocks found
                        </h3>
                        <div className="mt-2 text-sm text-yellow-700">
                          <p>
                            Try searching with a different term or check if the stock symbol is correct.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {showSearchResults && searchResults.length > 0 && (
                  <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm">
                    <div className="p-3 bg-gray-50 border-b border-gray-200">
                      <h4 className="text-sm font-medium text-gray-900">Search Results ({searchResults.length})</h4>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {searchResults.slice(0, 10).map((s) => (
                        <div
                          key={s["1. symbol"]}
                          className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 truncate">{s["2. name"]}</div>
                            <div className="text-xs text-gray-500">{s["1. symbol"]} • {s["4. region"]}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddStock(s)}
                            className="ml-3 flex-shrink-0"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                          </Button>
                        </div>
                      ))}
                      {searchResults.length > 10 && (
                        <div className="p-3 text-center text-sm text-gray-500 bg-gray-50">
                          Showing first 10 results of {searchResults.length} found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Stocks table */}
            <div className="rounded-lg border border-gray-200 divide-y shadow-sm">
              {loading.stocks ? (
                <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
              ) : watchlistStocks.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500">No stocks to display.</div>
              ) : (
                /* Header Row */
                <>
                  <div className="flex items-center font-semibold text-sm uppercase px-3 py-2 bg-gray-50">
                    <div className="flex-1">Symbol</div>
                    <div className="w-32 text-center">Actions</div>
                    <div className="w-24 text-right">Price</div>
                    <div className="w-24 text-right">Change</div>
                    <div className="w-28 text-right">% Change</div>
                    <div className="w-10"></div>
                  </div>
                  {watchlistStocks.map((stk) => {
                    const isPositive = parseFloat(stk.change) >= 0;
                    const fmt = (v, d = 2) => {
                      if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "-.--";
                      const num = Number(v);
                      if (isNaN(num) || !isFinite(num)) return "-.--";
                      if (num === 0) return "-.--";
                      return num.toFixed(d);
                    };
                    
                    const formatPrice = (v) => {
                      if (v === null || v === undefined || v === "" || isNaN(Number(v))) return "-.--";
                      const num = Number(v);
                      if (isNaN(num) || !isFinite(num) || num === 0) return "-.--";
                      return num.toFixed(2);
                    };
                    
                    return (
                      <div
                        key={stk.symbol}
                        className="flex items-center px-3 py-2 hover:bg-gray-50 text-sm cursor-pointer group"
                        onClick={(e) => {
                          // Prevent row click when buttons are pressed
                          const el = e.target;
                          if (el && el.closest && el.closest("button")) return;
                          const base = stk.symbol.split(".")[0];
                          navigate(`/stock/overview/${base}`);
                        }}
                      >
                        <div className="flex-1 hover:text-blue-600 dark:hover:text-blue-400 transition-all duration-200 hover:scale-105">
                          <div className="font-medium">{stk.name || stk.symbol}</div>
                          <div className="text-xs text-gray-500">{stk.symbol}</div>
                        </div>
                        <div className="w-32 flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100 hover:text-green-800 px-2 py-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrade(stk, "buy");
                            }}
                          >
                            <TrendingUp className="h-3 w-3 mr-1" />
                            Buy
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-red-50 border-red-200 text-red-700 hover:bg-red-100 hover:text-red-800 px-2 py-1 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrade(stk, "sell");
                            }}
                          >
                            <TrendingDown className="h-3 w-3 mr-1" />
                            Sell
                          </Button>
                        </div>
                        <div className="w-24 text-right">₹{formatPrice(stk.price)}</div>
                        <div
                          className={`w-24 text-right ${isPositive ? "text-green-600" : "text-red-600"}`}
                        >
                          {stk.change === 0 || stk.change === null || stk.change === undefined ? "-.--" : 
                           `${isPositive ? "+" : ""}${fmt(stk.change)}`}
                        </div>
                        <div
                          className={`w-28 text-right ${isPositive ? "text-green-600" : "text-red-600"}`}
                        >
                          {stk.percent_change === 0 || stk.percent_change === null || stk.percent_change === undefined ? "-.--%" : 
                           `${isPositive ? "+" : ""}${fmt(stk.percent_change)}%`}
                        </div>
                        {activeWatchlist && (
                          <div className="w-10 flex justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveStock(stk.symbol);
                              }}
                              className="hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Trade Form Modal */}
      {showTradeForm && selectedStock && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {tradeAction === "buy" ? "Buy" : "Sell"} {selectedStock.symbol}
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTradeForm(false)}
                className="h-8 w-8 p-0"
              >
                <span className="sr-only">Close</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
            <div className="p-4">
              <TradeForm
                symbol={selectedStock.symbol}
                defaultAction={tradeAction}
                onClose={() => setShowTradeForm(false)}
                onTradeSuccess={handleTradeSuccess}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Watchlist;