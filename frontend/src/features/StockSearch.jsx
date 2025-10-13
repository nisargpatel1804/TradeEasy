import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import debounce from "lodash.debounce";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Search, Plus, Loader2 } from "lucide-react";

const StockSearch = () => {
  const { getWatchlists, watchlistsData } = useDataContext();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (searchQuery) => {
      if (searchQuery.length < 2) {
        setResults([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      try {
        const data = await api.searchStocks(searchQuery);
        setResults(data || []);
      } catch (error) {
        console.error("Search failed:", error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    debouncedSearch(query);
  }, [query, debouncedSearch]);

  const handleAddStock = async (e, stock) => {
    e.stopPropagation(); // Prevent dropdown from closing
    const defaultWatchlist = watchlistsData?.watchlists.find(w => !w.is_deletable);
    if (!defaultWatchlist) {
      toast.error("Default watchlist not found.");
      return;
    }

    const toastId = toast.loading(`Adding ${stock.symbol}...`);
    try {
      await api.addStockToWatchlist(defaultWatchlist.name, {
        symbol: stock.symbol,
        name: stock.name,
        scripcode: stock.scripcode
      });
      toast.success(`${stock.symbol} added to ${defaultWatchlist.name}`, { id: toastId });
      getWatchlists(true); // Refresh watchlists data
      setQuery(""); // Clear search after adding
    } catch (error) {
      toast.error(error.message || `Failed to add ${stock.symbol}`, { id: toastId });
    }
  };
  
  const handleSelectStock = (stock) => {
      setQuery('');
      // Navigate to a detailed stock page (assuming this route exists)
      navigate(`/stock/${stock.symbol}`);
  }

  const showDropdown = isFocused && query.length > 1;

  return (
    <div className="relative w-full max-w-md" ref={searchRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Search for stocks (e.g., RELIANCE)"
          className="pl-10"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
        />
        {isLoading && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
      </div>

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="absolute z-20 left-0 right-0 mt-2 bg-white dark:bg-gray-800 border rounded-xl shadow-lg overflow-hidden max-h-80 overflow-y-auto"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {isLoading && results.length === 0 ? (
                <div className="p-2 space-y-2">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
            ) : results.length > 0 ? (
              results.map((stock) => (
                <div
                  key={stock.symbol}
                  className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0 flex items-center justify-between cursor-pointer"
                  onClick={() => handleSelectStock(stock)}
                >
                  <div>
                    <div className="font-medium">{stock.symbol}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{stock.name}</div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={(e) => handleAddStock(e, stock)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ))
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

