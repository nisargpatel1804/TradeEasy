import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-hot-toast";
import { useDataContext } from "../context/DataContext.jsx";
import { useStockSearch } from "../lib/useStockSearch.js";
import { Input } from "../components/ui/input.jsx";
import { Button } from "../components/ui/button.jsx";
import { Skeleton } from "../components/ui/skeleton.jsx";
import { Search, Plus, Loader2 } from "lucide-react";

const StockSearch = ({
  activeWatchlist,
  onAddStock,
  onResultClick,
  placeholder = "Search for stocks (e.g., RELIANCE)",
  containerClassName = "relative w-full max-w-md",
  inputClassName = "pl-10",
  dropdownClassName = "absolute z-20 left-0 right-0 mt-2 max-h-80 overflow-y-auto overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg",
  showAddButton = true,
}) => {
  const { addStockToWatchlist, watchlistsData } = useDataContext();
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
    isLoadingMore,
    hasMore,
    loadMore,
    clearResults,
  } = useStockSearch({ onError: handleSearchError });

  const nseResults = useMemo(
    () => (Array.isArray(results) ? results.filter((stock) => {
      const exchange = String(stock?.exchange || "").toUpperCase();
      const symbol = String(stock?.symbol || "").toUpperCase();
      return exchange === "NSE" && symbol.endsWith(".NSE");
    }) : []),
    [results]
  );

  const handleDropdownScroll = useCallback((event) => {
    const el = event?.currentTarget;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 80) {
      loadMore();
    }
  }, [loadMore]);

  // Pre-built O(1) lookup set so isStockInWatchlist does not scan all lists on every render
  const watchlistStockSet = useMemo(() => {
    const symbolSet = new Set();
    const scripcodeSet = new Set();
    if (activeWatchlist?.stocks) {
      activeWatchlist.stocks.forEach((s) => {
        if (s.symbol) symbolSet.add(s.symbol);
        if (s.scripcode != null) scripcodeSet.add(String(s.scripcode));
      });
    } else if (watchlistsData?.watchlists) {
      watchlistsData.watchlists.forEach((wl) =>
        wl.stocks.forEach((s) => {
          if (s.symbol) symbolSet.add(s.symbol);
          if (s.scripcode != null) scripcodeSet.add(String(s.scripcode));
        })
      );
    }
    return { symbolSet, scripcodeSet };
  }, [activeWatchlist, watchlistsData]);

  const isStockInWatchlist = useCallback(
    (stock) =>
      watchlistStockSet.symbolSet.has(stock.symbol) ||
      watchlistStockSet.scripcodeSet.has(String(stock.scripcode)),
    [watchlistStockSet]
  );

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

    const stockExchange = String(stock?.exchange || "").toUpperCase();
    if (stockExchange !== "NSE") {
      toast.error("Only NSE stocks can be added.");
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
      const res = await addStockToWatchlist(watchlistName, {
        symbol: String(stock.symbol || "").toUpperCase(),
        name: stock.name,
        exchange: 'NSE',
        scripcode: stock.scripcode,
      });

      const sub = res?.subscription;
      if (sub && !sub.success) {
        toast(`${stock.symbol} added to ${watchlistName}, but live updates may be unavailable: ${sub.message}`, { id: toastId });
      } else {
        toast.success(`${stock.symbol} added to ${watchlistName}`, { id: toastId });
      }

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
  const showDropdown = isFocused && (query.length > 1 || nseResults.length > 0 || isLoading);

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
            ) : nseResults.length > 0 ? (
              <>
                <div id="stock-search-list" role="listbox" onScroll={handleDropdownScroll} className="">
                  {nseResults.map((stock, idx) => {
                    const alreadyAdded = isStockInWatchlist(stock);
                    return (
                      <div
                        id={`stock-search-item-${idx}`}
                        key={stock.symbol}
                        role="option"
                        className="flex cursor-pointer items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50"
                        onClick={() => handleSelectStock(stock)}
                      >
                        <div className="flex-1">
                          <div className="font-medium text-slate-900">{stock.symbol}</div>
                          <div className="truncate text-sm text-slate-500">{stock.name}</div>
                        </div>
                        {alreadyAdded ? (
                          <div className="px-2 text-xs font-medium text-emerald-600">
                            Added ✓
                          </div>
                        ) : (
                          showAddButton && onAddStock ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                              onClick={(e) => handleAddStock(e, stock)}
                              aria-label={`Add ${stock.symbol} to watchlist`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          ) : null
                        )}
                      </div>
                    );
                  })}
                </div>

                {isLoadingMore && (
                  <div className="flex items-center justify-center gap-2 border-t border-slate-100 p-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading more...
                  </div>
                )}
                {!isLoadingMore && hasMore && (
                  <div className="border-t border-slate-100 p-2 text-center text-xs text-slate-500">
                    Scroll for more results
                  </div>
                )}

              </>
            ) : (
              <div className="p-4 text-center text-sm text-slate-500">
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