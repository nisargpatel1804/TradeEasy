import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { Search, Plus, Loader2 } from "lucide-react";
import debounce from "lodash.debounce";
import { searchStocks, addStockToWatchlist } from "@/services/api";
import { useDataContext } from "@/context/DataContext";
import { toast } from "react-hot-toast";

const StockSearch = ({ onSelect }) => {
  const { getWatchlists } = useDataContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [allWatchlists, setAllWatchlists] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    (async () => {
      const wl = await getWatchlists();
      if (!wl?.error) setAllWatchlists(wl);
    })();
  }, [getWatchlists]);

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const debouncedSearch = useCallback(
    debounce(async (q) => {
      if (!q.trim()) {
        setSearchResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await searchStocks(q);
        const results = res?.bestMatches || res || [];
        setSearchResults(results);
      } catch (e) {
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    if (searchQuery.trim()) {
      setShowDropdown(true);
      debouncedSearch(searchQuery);
    } else {
      setShowDropdown(false);
      setSearchResults([]);
      debouncedSearch.cancel();
    }
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  const addToStocks = async (stock) => {
    const stocksWatchlist = allWatchlists.find(w => w.name?.toLowerCase() === "stocks");
    if (!stocksWatchlist) {
      toast.error("Stocks watchlist not found");
      return;
    }
    const res = await addStockToWatchlist(stocksWatchlist.name || "Stocks", stock["1. symbol"], stock["2. name"]);
    if (res?.error) toast.error(res.error);
    else toast.success(`${(stock["1. symbol"] || '').split('.')[0]} added`);
  };

  return (
    <div className="relative" ref={containerRef}>
      <Input
        placeholder="Search NSE/BSE stocks..."
        className="pl-10"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => searchQuery.trim() && setShowDropdown(true)}
      />
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      {loading && <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />}
      {showDropdown && (
        <div className="absolute z-20 left-0 right-0 mt-2 bg-white dark:bg-gray-800 border rounded-xl shadow-xl overflow-hidden max-h-96 overflow-y-auto">
          {searchResults.length > 0 ? (
            searchResults.slice(0, 8).map((stock) => (
              <div key={stock["1. symbol"]} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0 flex items-center justify-between">
                <div className="cursor-pointer flex-1" onClick={() => onSelect?.(stock["1. symbol"]) }>
                  <div className="font-medium">{(stock["1. symbol"] || '').split('.')[0]}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{stock["2. name"]}</div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => addToStocks(stock)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-gray-500">{loading ? "Searching..." : "No stocks found."}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default StockSearch;
