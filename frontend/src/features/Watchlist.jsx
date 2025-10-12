import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  addStockToWatchlist,
  fetchWatchlistStocks,
  removeStockFromWatchlist,
  searchStocks,
} from "@/services/api";
import { useDataContext } from "@/context/DataContext";
import { useSocketContext } from "@/context/SocketContext";
import priceUpdateService from "@/services/priceUpdateService";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { toast } from "react-hot-toast";
import { Search, Trash2, TrendingUp, TrendingDown, X, ArrowUpDown } from "lucide-react";
import debounce from "lodash.debounce";
import Navbar from "@/features/Navbar";
import TradeForm from "@/features/TradeForm";
import ErrorBoundary from "@/components/ErrorBoundary";
import "@/assets/css/watchlist.css";

const Watchlist = () => {
  const [activeWatchlist, setActiveWatchlist] = useState(null);
  const [watchlistStocks, setWatchlistStocks] = useState([]);
  const [loading, setLoading] = useState({ lists: true, stocks: false });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [tradeAction, setTradeAction] = useState("buy");
  const [confirmRemove, setConfirmRemove] = useState({ open: false, symbol: null });
  const [updatedSymbols, setUpdatedSymbols] = useState({});
  const [isAddingStock, setIsAddingStock] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'ascending' });

  const { getWatchlists } = useDataContext();
  const navigate = useNavigate();
  const { isConnected } = useSocketContext();

  // Fetch initial watchlists and stocks
  useEffect(() => {
    const loadInitialData = async () => {
      setLoading({ lists: true, stocks: true });
      try {
        const allWatchlists = await getWatchlists();
        const mainWatchlist = allWatchlists.find(w => w.name === "Stocks") || allWatchlists[0] || { name: "Stocks", stocks: [] };
        
        setActiveWatchlist(mainWatchlist);

        const res = await fetchWatchlistStocks(mainWatchlist.name);
        const stocksToNormalize = Array.isArray(res.stocks) ? res.stocks : [];
        const normalized = stocksToNormalize.map(s => ({
          symbol: s.symbol, name: s.name, price: s.current_price ?? 0,
          change: s.change ?? 0, percent_change: s.percent_change ?? 0,
        }));
        setWatchlistStocks(normalized);
      } catch (error) {
        toast.error("Could not load initial data.");
        setActiveWatchlist({ name: "Stocks", stocks: [] });
        setWatchlistStocks([]);
      } finally {
        setLoading({ lists: false, stocks: false });
      }
    };
    loadInitialData();
  }, [getWatchlists]);
  
  // Subscribe to real-time price updates
  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe((priceData) => {
      const {
        allPrices,
        changedPrices = {},
        isConnected: priceFeedConnected = false,
        isStreamingPaused = false,
        connectionEvent = null,
      } = priceData;

      if (connectionEvent === 'disconnected') {
        setUpdatedSymbols({});
      }

      const symbolsToFlash = Object.keys(changedPrices || {});
      const shouldFlash = priceFeedConnected && !isStreamingPaused && symbolsToFlash.length > 0;

      if (shouldFlash) {
        setUpdatedSymbols(prev => ({
          ...prev,
          ...symbolsToFlash.reduce((acc, sym) => ({ ...acc, [sym]: true }), {}),
        }));
        setTimeout(() => {
          setUpdatedSymbols(prev => {
            const next = { ...prev };
            symbolsToFlash.forEach(sym => delete next[sym]);
            return next;
          });
        }, 600);
      }

      if (isStreamingPaused && !shouldFlash) {
        setUpdatedSymbols({});
      }

      if (allPrices) {
        setWatchlistStocks(prevStocks =>
          Array.isArray(prevStocks)
            ? prevStocks.map(stock => {
                const newPriceData = allPrices[stock.symbol];
                return newPriceData
                  ? {
                      ...stock,
                      price: newPriceData.ltp,
                      change: newPriceData.change,
                      percent_change: newPriceData.percent_change,
                    }
                  : stock;
              })
            : []
        );
      }
    });

    return () => unsubscribe();
  }, []);

  // Debounced search
  const debouncedSearch = useCallback(debounce(async (query) => {
    const trimmedQuery = (query || "").trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    try {
      const results = await searchStocks(trimmedQuery);
      const currentSymbols = new Set(watchlistStocks.map(s => s.symbol));
      setSearchResults(results.filter(r => !currentSymbols.has(r.symbol)));
    } catch (error) {
      toast.error("Search failed.");
    } finally {
      setSearching(false);
    }
  }, 300), [watchlistStocks]);

  useEffect(() => {
    setSearching(true);
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const handleAddStock = async (stock) => {
    // **LIMIT ENFORCEMENT**
    if (watchlistStocks.length >= 25) {
      toast.error("Watchlists are limited to 25 stocks.");
      return;
    }

    if (!activeWatchlist?.name) {
        toast.error("No active watchlist selected.");
        return;
    }
    setIsAddingStock(stock.symbol);
    try {
      const res = await addStockToWatchlist(activeWatchlist.name, stock.symbol, stock.name, stock.scripcode);
      if (res.stock) {
        toast.success(`${stock.symbol} added.`);
        const serverStock = res.stock || {};
        setWatchlistStocks(prev => [
          ...prev,
          {
            ...stock,
            price: serverStock.current_price ?? 0,
            change: serverStock.change ?? 0,
            percent_change: serverStock.percent_change ?? 0,
          }
        ]);
        setSearchQuery("");
        setShowSearchResults(false);
      }
    } catch (error) {
      if (error?.status === 409) {
        toast.error(error.message || "Watchlist update conflict detected.");
      } else if (error?.status === 400) {
        toast.error(error.message || "Invalid stock details provided.");
      } else {
        toast.error(error?.message || "Failed to add stock.");
      }
    } finally {
      setIsAddingStock(null);
    }
  };

  const confirmRemoveAction = async () => {
    const { symbol } = confirmRemove;
    if (!symbol || !activeWatchlist?.name) return;
    try {
      await removeStockFromWatchlist(activeWatchlist.name, symbol);
      toast.success(`${symbol} removed.`);
      setWatchlistStocks(prev => prev.filter(s => s.symbol !== symbol));
    } catch (error) {
      toast.error(error.message || "Failed to remove stock.");
    } finally {
      setConfirmRemove({ open: false, symbol: null });
    }
  };

  const handleTrade = useCallback((stock, action) => {
    setSelectedStock(stock);
    setTradeAction(action);
    setShowTradeForm(true);
  }, []);
  
  const formatNumber = useCallback((value, digits = 2) => {
    const num = Number(value);
    return !isNaN(num) ? num.toFixed(digits) : "0.00";
  }, []);
  
  const sortedStocks = useMemo(() => {
    if (!Array.isArray(watchlistStocks)) return [];
    const sortable = [...watchlistStocks];
    sortable.sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];
      if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
      return 0;
    });
    return sortable;
  }, [watchlistStocks, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30 group-hover:opacity-70" />;
    return <span className="ml-1">{sortConfig.direction === 'ascending' ? '▲' : '▼'}</span>;
  };

  return (
    <>
      <Navbar />
      <div className="container mx-auto mt-24 p-4 max-w-7xl">
        <div className="mb-4 relative">
          <Input placeholder="Search to add stocks (e.g., RELIANCE, INFY)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setShowSearchResults(true)} className="w-full pl-10" />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          {searching && <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>}
          {showSearchResults && searchQuery && (
            <div className="absolute top-full mt-2 w-full rounded-lg border bg-white shadow-lg z-20 max-h-80 overflow-y-auto">
              {searchResults.length > 0 ? searchResults.map((stock) => (
                <div key={stock.symbol} className={`flex items-center justify-between p-3 hover:bg-gray-50 cursor-pointer ${isAddingStock === stock.symbol ? 'opacity-50 pointer-events-none' : ''}`} onClick={() => handleAddStock(stock)}>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{stock.name}</div>
                    <div className="text-xs text-gray-500">{stock.symbol}</div>
                  </div>
                  {isAddingStock === stock.symbol && <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>}
                </div>
              )) : !searching && <div className="p-4 text-sm text-center text-gray-500">No results found.</div>}
            </div>
          )}
        </div>

        <div className="rounded-lg border shadow-sm">
          {loading.stocks || loading.lists ? <div className="p-6 text-center text-gray-500">Loading Stocks…</div> : (
            <>
              <div className="flex items-center font-semibold text-xs uppercase px-3 py-2 bg-gray-50 text-gray-600 border-b">
                <div className="flex-1 cursor-pointer group flex items-center" onClick={() => requestSort('name')}>Symbol {getSortIndicator('name')}</div>
                <div className="w-24 text-right cursor-pointer group flex items-center justify-end" onClick={() => requestSort('price')}>Price {getSortIndicator('price')}</div>
                <div className="w-24 text-right cursor-pointer group flex items-center justify-end" onClick={() => requestSort('change')}>Change {getSortIndicator('change')}</div>
                <div className="w-28 text-right cursor-pointer group flex items-center justify-end" onClick={() => requestSort('percent_change')}>% Change {getSortIndicator('percent_change')}</div>
                <div className="w-32 text-center">Actions</div>
              </div>
              <ErrorBoundary>
                <div>
                  {sortedStocks.length > 0 ? sortedStocks.map((stock) => {
                      const isPositive = Number(stock.change) >= 0;
                      const isUpdated = updatedSymbols[stock.symbol];
                      return (
                        <div key={stock.symbol} className={`flex items-center h-[52px] px-3 group text-sm border-b border-gray-100 last:border-b-0 ${isUpdated ? 'price-flash' : ''}`}>
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/stock/overview/${stock.symbol.split('.')[0]}`)}>
                                <div className="font-medium text-gray-800 truncate">{stock.name || stock.symbol}</div>
                                <div className="text-xs text-gray-500">{stock.symbol}</div>
                            </div>
                            <div className={`w-24 text-right font-medium transition-colors duration-500 ${isUpdated ? (isPositive ? 'flash-green' : 'flash-red') : ''}`}>₹{formatNumber(stock.price)}</div>
                            <div className={`w-24 text-right transition-colors duration-500 ${isPositive ? "text-green-600" : "text-red-600"}`}>
                                {isPositive ? '+' : ''}{formatNumber(stock.change)}
                            </div>
                            <div className={`w-28 text-right transition-colors duration-500 ${isPositive ? "text-green-600" : "text-red-600"}`}>
                                {isPositive ? '+' : ''}{formatNumber(stock.percent_change)}%
                            </div>
                            <div className="w-32 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleTrade(stock, "buy"); }}>
                                <TrendingUp className="h-3 w-3 mr-1" /> Buy
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handleTrade(stock, "sell"); }}>
                                <TrendingDown className="h-3 w-3 mr-1" /> Sell
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setConfirmRemove({ open: true, symbol: stock.symbol }); }}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                        </div>
                      );
                  }) : (
                    <div className="p-6 text-center text-sm text-gray-500">Your watchlist is empty. Search to add stocks.</div>
                  )}
                </div>
              </ErrorBoundary>
            </>
          )}
        </div>
         <div className="mt-4 text-xs text-gray-500 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <span>{isConnected ? 'Live data connected' : 'Disconnected'}</span>
        </div>
      </div>

      {showTradeForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
             <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-semibold">{tradeAction === "buy" ? "Buy" : "Sell"} {selectedStock?.symbol}</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowTradeForm(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="p-4">
                <TradeForm symbol={selectedStock?.symbol} defaultAction={tradeAction} onClose={() => setShowTradeForm(false)} />
            </div>
          </div>
        </div>
      )}

      {confirmRemove.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="p-4"><h3 className="text-lg font-semibold">Confirm Removal</h3></div>
            <div className="p-4">Remove <span className="font-semibold">{confirmRemove.symbol}</span>?</div>
            <div className="p-4 flex justify-end gap-2 border-t">
              <Button variant="ghost" onClick={() => setConfirmRemove({ open: false, symbol: null })}>Cancel</Button>
              <Button variant="destructive" onClick={confirmRemoveAction}>Remove</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Watchlist;