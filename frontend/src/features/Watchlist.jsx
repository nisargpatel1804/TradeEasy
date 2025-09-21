import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  addStockToWatchlist,
  fetchWatchlistStocks,
  removeStockFromWatchlist,
  searchStocks,
} from "@/services/api";
import { useDataContext } from "@/context/DataContext";
import priceUpdateService from "@/services/priceUpdateService";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { toast } from "react-hot-toast";
import { Search, Plus, Trash2, TrendingUp, TrendingDown, X } from "lucide-react";
import debounce from "lodash.debounce";
import Navbar from "@/features/Navbar";
import TradeForm from "@/features/TradeForm";
import "@/assets/css/watchlist.css";

const Watchlist = () => {
  const [activeWatchlist, setActiveWatchlist] = useState(null);
  const [watchlistStocks, setWatchlistStocks] = useState([]);
  const [loading, setLoading] = useState({ lists: true, stocks: false });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [priceUpdateStatus, setPriceUpdateStatus] = useState({
    isConnected: false,
    lastUpdate: null,
    updateCount: 0
  });
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [tradeAction, setTradeAction] = useState("buy");

  const { getWatchlists } = useDataContext();
  const navigate = useNavigate();

  // Load user watchlists and set the active one on initial render.
  useEffect(() => {
    const loadAndSetActiveWatchlist = async () => {
      setLoading(prev => ({ ...prev, lists: true }));
      try {
        const allWatchlists = await getWatchlists();
        // The project requirement is to only show the "Stocks" watchlist.
        const stocksWl = allWatchlists.find(w => w.name === "Stocks");
        if (stocksWl) {
          setActiveWatchlist(stocksWl);
        } else if (allWatchlists.length > 0) {
          // Fallback to the first watchlist if "Stocks" isn't found
          setActiveWatchlist(allWatchlists[0]);
        }
      } catch (error) {
        toast.error("Could not load watchlists.");
        console.error("Error loading watchlists:", error);
      }
      setLoading(prev => ({ ...prev, lists: false }));
    };
    loadAndSetActiveWatchlist();
  }, [getWatchlists]);

  // Fetch stocks for the currently active watchlist.
  useEffect(() => {
    const fetchStocks = async () => {
      if (!activeWatchlist) {
        setWatchlistStocks([]);
        return;
      }
      setLoading(prev => ({ ...prev, stocks: true }));
      try {
        const res = await fetchWatchlistStocks(activeWatchlist.name);
        const normalized = (res.stocks || []).map(s => ({
          symbol: s.symbol,
          name: s.name,
          price: s.current_price ?? 0,
          change: s.change ?? 0,
          percent_change: s.percent_change ?? 0,
          last_updated: s.last_updated ?? null,
        }));
        setWatchlistStocks(normalized);
        // Load the initial prices into the service for a consistent state across the app
        const initialPriceMap = normalized.reduce((acc, stock) => {
          acc[stock.symbol] = { ltp: stock.price, change: stock.change, percent_change: stock.percent_change };
          return acc;
        }, {});
        priceUpdateService.loadInitialPrices(initialPriceMap);
      } catch (error) {
        setWatchlistStocks([]);
        toast.error(`Could not load stocks for ${activeWatchlist.name}`);
      }
      setLoading(prev => ({ ...prev, stocks: false }));
    };
    fetchStocks();
  }, [activeWatchlist]);
  
  // *** REAL-TIME PRICE UPDATES via WebSocket Service ***
  // This effect subscribes to the centralized price update service.
  // It no longer polls the API.
  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe((priceData) => {
      const { allPrices, isConnected, error } = priceData;
      
      setPriceUpdateStatus(prev => ({
        isConnected: isConnected,
        lastUpdate: isConnected ? new Date().toLocaleTimeString() : prev.lastUpdate,
        updateCount: prev.updateCount + 1
      }));
      
      if (isConnected && allPrices) {
        setWatchlistStocks(prevStocks => 
          prevStocks.map(stock => {
            const newPriceData = allPrices[stock.symbol];
            return newPriceData ? { ...stock, ...newPriceData, price: newPriceData.ltp } : stock;
          })
        );
      }
      
      if (error) {
        console.warn('Price update service error:', error);
      }
    });

    return unsubscribe; // Cleanup subscription on component unmount
  }, []); // Empty dependency array ensures this subscribes only once

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (!query.trim()) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      try {
        // The searchStocks API should return scripcode for real-time subscription
        const results = await searchStocks(query);
        const currentSymbols = new Set(watchlistStocks.map(stk => stk.symbol));
        // Filter out stocks already in the watchlist
        const filteredResults = results.filter(res => !currentSymbols.has(res.symbol));
        setSearchResults(filteredResults);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300),
    [watchlistStocks]
  );

  useEffect(() => {
    if (searchQuery.trim()) {
      setSearching(true);
      setShowSearchResults(true);
      debouncedSearch(searchQuery);
    } else {
      setSearchResults([]);
      setSearching(false);
      setShowSearchResults(false);
    }
  }, [searchQuery, debouncedSearch]);

  const handleAddStock = async (stock) => {
    if (!activeWatchlist) {
      toast.error("No active watchlist selected.");
      return;
    }

    setSearchQuery("");
    setShowSearchResults(false);

    try {
      // Pass symbol, name, and scripcode to the backend
      const res = await addStockToWatchlist(
        activeWatchlist.name,
        stock.symbol,
        stock.name,
        stock.scripcode // Crucial for the backend to initiate WebSocket subscription
      );

      if (res.stock) {
        toast.success(`${stock.symbol} added to watchlist!`);
        // Optimistically update UI
        setWatchlistStocks(prev => [...prev, { ...res.stock, price: res.stock.current_price }]);
        getWatchlists(true); // Force refresh of shared context data
      } else {
        toast.error(res.error || "Failed to add stock");
      }
    } catch (error) {
      toast.error("An error occurred while adding the stock.");
    }
  };

  const handleRemoveStock = async (symbol) => {
    if (!activeWatchlist) return;
    try {
      await removeStockFromWatchlist(activeWatchlist.name, symbol);
      toast.success(`${symbol} removed.`);
      setWatchlistStocks(prev => prev.filter(stk => stk.symbol !== symbol));
      getWatchlists(true);
    } catch (error) {
      toast.error(error.message || "Failed to remove stock");
    }
  };

  const handleTrade = (stock, action) => {
    setSelectedStock(stock);
    setTradeAction(action);
    setShowTradeForm(true);
  };
  
  // Helper for formatting numbers
  const formatNumber = (value, digits = 2) => {
    const num = Number(value);
    if (isNaN(num) || num === 0) return "-.--";
    return num.toFixed(digits);
  };

  return (
    <>
      <Navbar />
      <div className="container mx-auto mt-24 p-4 max-w-7xl">
        {/* ---- WATCHLIST SEARCH AND ADD ---- */}
        <div className="mb-4 watchlist-search-container relative">
            <Input
                placeholder="Search to add stocks (e.g., RELIANCE, INFY)"
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
            {/* Search Results Dropdown */}
            {showSearchResults && (
                 <div className="absolute top-full mt-2 w-full rounded-lg border border-gray-200 bg-white shadow-lg z-20">
                    {!searching && searchQuery && searchResults.length === 0 && (
                        <div className="p-4 text-sm text-center text-gray-500">No results found for &apos;{searchQuery}&apos;.</div>
                    )}
                    <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                        {searchResults.map((stock) => (
                            <div key={stock.symbol} className="flex items-center justify-between p-3 hover:bg-gray-50 transition-colors">
                                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/stock/overview/${stock.symbol.split('.')[0]}`)}>
                                    <div className="font-medium text-gray-900 truncate">{stock.name}</div>
                                    <div className="text-xs text-gray-500">{stock.symbol}</div>
                                </div>
                                <Button size="sm" variant="outline" onClick={() => handleAddStock(stock)} className="ml-3">
                                    <Plus className="h-4 w-4 mr-1" /> Add
                                </Button>
                            </div>
                        ))}
                    </div>
                 </div>
            )}
        </div>

        {/* ---- WATCHLIST TABLE ---- */}
        <div className="rounded-lg border border-gray-200 divide-y shadow-sm">
          {loading.stocks ? (
            <div className="p-6 text-center text-sm text-gray-500">Loading Stocks…</div>
          ) : watchlistStocks.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">Your watchlist is empty. Use the search bar above to add stocks.</div>
          ) : (
            <>
              {/* Header Row */}
              <div className="flex items-center font-semibold text-xs uppercase px-3 py-2 bg-gray-50 text-gray-600">
                <div className="flex-1">Symbol</div>
                <div className="w-24 text-right">Price</div>
                <div className="w-24 text-right">Change</div>
                <div className="w-28 text-right">% Change</div>
                <div className="w-32 text-center">Actions</div>
              </div>
              {/* Stock Rows */}
              {watchlistStocks.map((stock) => {
                const isPositive = Number(stock.change) >= 0;
                return (
                  <div key={stock.symbol} className="flex items-center px-3 py-2 hover:bg-gray-50 text-sm group">
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/stock/overview/${stock.symbol.split('.')[0]}`)}>
                      <div className="font-medium text-gray-800">{stock.name || stock.symbol}</div>
                      <div className="text-xs text-gray-500">{stock.symbol}</div>
                    </div>
                    <div className="w-24 text-right font-medium">₹{formatNumber(stock.price)}</div>
                    <div className={`w-24 text-right ${isPositive ? "text-green-600" : "text-red-600"}`}>
                        {isPositive ? '+' : ''}{formatNumber(stock.change)}
                    </div>
                    <div className={`w-28 text-right ${isPositive ? "text-green-600" : "text-red-600"}`}>
                        {isPositive ? '+' : ''}{formatNumber(stock.percent_change)}%
                    </div>
                    <div className="w-32 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleTrade(stock, "buy"); }}>
                        <TrendingUp className="h-3 w-3 mr-1" /> Buy
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleTrade(stock, "sell"); }}>
                        <TrendingDown className="h-3 w-3 mr-1" /> Sell
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleRemoveStock(stock.symbol); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
        
        {/* Real-time Status Footer */}
        <div className="mt-4 text-xs text-gray-500 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${priceUpdateStatus.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span>{priceUpdateStatus.isConnected ? 'Live data connected' : 'Disconnected from live data'}</span>
            {priceUpdateStatus.lastUpdate && <span>(Last update: {priceUpdateStatus.lastUpdate})</span>}
        </div>
      </div>

      {/* Trade Form Modal */}
      {showTradeForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">{tradeAction === "buy" ? "Buy" : "Sell"} {selectedStock.symbol}</h3>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowTradeForm(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4">
              <TradeForm
                symbol={selectedStock.symbol}
                defaultAction={tradeAction}
                onClose={() => setShowTradeForm(false)}
                onTradeSuccess={() => {
                  setShowTradeForm(false);
                  toast.success("Trade executed successfully!");
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Watchlist;