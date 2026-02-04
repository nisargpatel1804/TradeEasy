import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import { useStockSearch } from "../hooks/useStockSearch.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Search, Plus, Loader2 } from "lucide-react";

const StockSearch = ({
  activeWatchlist,
  onAddStock,
  onResultClick,
  placeholder = "Search for stocks (e.g., RELIANCE)",
  containerClassName = "relative w-full max-w-md",
  inputClassName = "pl-10",
  dropdownClassName = "absolute z-20 left-0 right-0 mt-2 bg-white dark:bg-gray-800 border rounded-xl shadow-lg overflow-hidden max-h-80 overflow-y-auto",
  showAddButton = true,
}) => {
  const { getWatchlists, watchlistsData } = useDataContext();
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef(null);
  const lastSearchToastAtRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearchError = useCallback((error) => {
    const now = Date.now();
    if (now - lastSearchToastAtRef.current < 1500) {
      return;
    }
    lastSearchToastAtRef.current = now;

    if (error?.status === 401) {
      toast.error("Please sign in to search.");
      return;
    }
    if (error?.status === 429) {
      toast.error("You are searching too fast. Please wait a moment.");
      return;
    }
    if (error?.code === "ECONNABORTED" || /Network Error/i.test(error?.message || "")) {
      toast.error("Search failed due to a network issue. Please check your connection.");
    }
  }, []);

  const {
    query,
    setQuery,
    results,
    isLoading,
    clearResults,
  } = useStockSearch({ onError: handleSearchError });

  const isStockInWatchlist = (stock) => {
    if (activeWatchlist?.stocks) {
      return activeWatchlist.stocks.some((s) => s.symbol === stock.symbol || s.scripcode === stock.scripcode);
    }
    if (!watchlistsData?.watchlists) return false;
    return watchlistsData.watchlists.some((watchlist) =>
      watchlist.stocks.some((s) => s.symbol === stock.symbol || s.scripcode === stock.scripcode)
    );
  };

  const handleAddStock = async (e, stock) => {
    e.stopPropagation();

    if (onAddStock) {
      try {
        const wasAdded = await onAddStock(stock);
        if (wasAdded === false) {
          return;
        }
        setQuery("");
        clearResults();
        setIsFocused(false);
      } catch (err) {
        console.debug("onAddStock handler error:", err);
      }
      return;
    }

    const targetWatchlistName = activeWatchlist?.name;
    const defaultWatchlist = !targetWatchlistName ? watchlistsData?.watchlists.find((w) => !w.is_deletable) : null;
    const watchlistName = targetWatchlistName ?? defaultWatchlist?.name;

    if (!watchlistName) {
      toast.error("No target watchlist found.");
      return;
    }

    if (isStockInWatchlist(stock)) {
      toast.error(`${stock.symbol} is already in ${activeWatchlist?.name || "your watchlist"}`, {
        duration: 2000,
        icon: "ℹ️",
      });
      return;
    }

    const toastId = toast.loading(`Adding ${stock.symbol}...`);
    try {
      const res = await api.addStockToWatchlist(watchlistName, {
        symbol: stock.symbol,
        name: stock.name,
        scripcode: stock.scripcode,
      });

      const sub = res?.subscription;
      if (sub && !sub.success) {
        toast(`${stock.symbol} added to ${watchlistName}, but live updates may be unavailable: ${sub.message}`, { id: toastId });
      } else {
        toast.success(`${stock.symbol} added to ${watchlistName}`, { id: toastId });
      }

      getWatchlists(true);
      setQuery("");
      clearResults();
      setIsFocused(false);
    } catch (error) {
      const errCode = error?.data?.error_code || null;
      if (errCode === "DUPLICATE_STOCK" || error.status === 409) {
        toast.error(`${stock.symbol} is already in ${watchlistName}`, {
          id: toastId,
          icon: "ℹ️",
        });
      } else if (errCode === "INSTRUMENT_NOT_TRADABLE") {
        toast.error(`${stock.symbol} cannot be added because the instrument is not tradable.`, { id: toastId });
      } else if (error.code === "ECONNABORTED" || /Network Error/i.test(error.message)) {
        toast.error(`Network error while adding ${stock.symbol}. Please check your connection.`, { id: toastId });
      } else {
        toast.error(error.message || `Failed to add ${stock.symbol}`, { id: toastId });
      }
    }
  };

  const handleSelectStock = async (stock) => {
    if (onResultClick) {
      try {
        const result = await onResultClick(stock);
        if (result === false) {
          return;
        }
        setQuery("");
        clearResults();
        setIsFocused(false);
      } catch (err) {
        console.debug("onResultClick handler error:", err);
      }
      return;
    }
    const cleanSymbol = stock.symbol.split(".")[0];
    setQuery("");
    clearResults();
    setIsFocused(false);
    navigate(`/stock/${cleanSymbol}`);
  };

  const inputRef = useRef(null);
  const showDropdown = isFocused && (query.length > 1 || results.length > 0 || isLoading);

  return (
    <div className={containerClassName} ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          className={inputClassName}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          aria-autocomplete="list"
          aria-controls="stock-search-list"
          aria-expanded={showDropdown}
        />
        {isLoading && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className={dropdownClassName}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {isLoading && results.length === 0 ? (
              <div className="p-2 space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : results.length > 0 ? (
              <>
                <div id="stock-search-list" role="listbox">
                  {results.map((stock, idx) => {
                    const alreadyAdded = isStockInWatchlist(stock);
                    return (
                      <div
                        id={`stock-search-item-${idx}`}
                        key={stock.symbol}
                        role="option"
                        className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0 flex items-center justify-between cursor-pointer"
                        onClick={() => handleSelectStock(stock)}
                      >
                        <div className="flex-1">
                          <div className="font-medium">{stock.symbol}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{stock.name}</div>
                        </div>
                        {alreadyAdded ? (
                          <div className="text-xs text-green-600 dark:text-green-400 font-medium px-2">
                            Added ✓
                          </div>
                        ) : (
                          showAddButton && onAddStock ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleAddStock(e, stock)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          ) : null
                        )}
                      </div>
                    );
                  })}
                </div>

              </>
            ) : (
              <div className="p-4 text-center text-sm text-gray-500">
                {query.length > 1 ? "No results found." : "Type to search..."}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StockSearch;

