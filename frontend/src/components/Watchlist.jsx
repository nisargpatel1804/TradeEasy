import { useEffect, useState, useCallback } from "react";
import {
  createWatchlist,
  deleteWatchlist,
  fetchWatchlistStocks,
  addStockToWatchlist,
  removeStockFromWatchlist,
  searchStocks,
} from "@/services/api";
import { useDataContext } from "@/services/DataContext";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { toast } from "react-hot-toast";
import { Search, Plus, Trash2, ArrowUpCircle, ArrowDownCircle, TrendingUp, TrendingDown } from "lucide-react";
import debounce from "lodash.debounce";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/Navbar";
import "../assets/css/watchlist.css";

const Watchlist = () => {
  const [watchlists, setWatchlists] = useState([]);
  const [activeWatchlist, setActiveWatchlist] = useState(null);
  const [watchlistStocks, setWatchlistStocks] = useState([]);
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [showMovers, setShowMovers] = useState(false);
  const [moverType, setMoverType] = useState("gainers"); // "gainers" or "losers"
  const [marketLoading, setMarketLoading] = useState(true);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [loading, setLoading] = useState({ lists: true, stocks: false });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  
  // Get shared context data
  const { getIndices, getWatchlists } = useDataContext();

  // --- Layout helpers & page behaviour ---
  // Always start the page scrolled to top to avoid the search bar being hidden beneath the navbar on first load / refresh.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, []);

  // Separate virtual index tabs (Nifty 50, Sensex) from user-created watchlists (e.g. Main, custom).
  const indexWatchlists = watchlists.filter((w) => w.is_virtual);
  const customWatchlists = watchlists.filter((w) => !w.is_virtual);

  // Locate the default 'Main' watchlist (if present)
  const mainWatchlist = watchlists.find((w) => w.name?.toLowerCase() === "main");

  const loadWatchlists = useCallback(async () => {
    setLoading(prev => ({ ...prev, lists: true }));
    const res = await getWatchlists();
    if (!res.error) {
      // ensure default order Main > Nifty 50 > Sensex > others
      const defaultOrder = ["Main", "Nifty 50", "Sensex"];
      const sorted = [...res].sort((a,b)=>{
        const normalise = (n) => (n === "Nifty50" ? "Nifty 50" : n);
        const ai = defaultOrder.indexOf(normalise(a.name));
        const bi = defaultOrder.indexOf(normalise(b.name));
        if(ai === -1 && bi === -1) return 0;
        if(ai === -1) return 1;
        if(bi === -1) return -1;
        return ai - bi;
      });
      // --- Ensure Nifty 50 and Sensex virtual tabs exist ---
      const indexTabs = [
        { id: "idx_nifty50", name: "Nifty 50", is_deletable: false, is_virtual: true },
        { id: "idx_sensex", name: "Sensex", is_deletable: false, is_virtual: true },
      ];
      const existingNames = new Set(sorted.map(w=>w.name === "Nifty50" ? "Nifty 50" : w.name));
      const merged = [...sorted];
      indexTabs.forEach(tab => {
        if(!existingNames.has(tab.name)) merged.push(tab);
      });
      // Re-sort with preferred order now that we've merged
      const finalOrderedRaw = [...merged].sort((a,b)=>{
         const nameA = a.name === "Nifty50" ? "Nifty 50" : a.name;
         const nameB = b.name === "Nifty50" ? "Nifty 50" : b.name;
         const ai = defaultOrder.indexOf(nameA);
         const bi = defaultOrder.indexOf(nameB);
         if(ai === -1 && bi === -1) return 0;
         if(ai === -1) return 1;
         if(bi === -1) return -1;
         return ai - bi;
      });

      // Remove duplicates (same name, keep first occurrence)
      const seenNames = new Set();
      const finalOrdered = finalOrderedRaw.filter(w => {
        const norm = w.name?.toLowerCase();
        if (seenNames.has(norm)) return false;
        seenNames.add(norm);
        return true;
      });
      setWatchlists(finalOrdered);

      // default active to Main if exists, otherwise first
      const main = finalOrdered.find(w=>w.name === "Main");
      const desired = main || finalOrdered[0] || null;

      // update only if different to avoid unnecessary renders
      if(desired && (!activeWatchlist || activeWatchlist.id !== desired.id)) {
        setActiveWatchlist(desired);
      }
    } else {
      toast.error("Could not load watchlists.");
    }
    setLoading(prev => ({ ...prev, lists: false }));
  }, []);

  const loadMarketMovers = useCallback(async () => {
    // Keep the skeleton visible until either data arrives OR 8 s pass (whichever is first)
    setMarketLoading(true);

    let didFinish = false;

    const timeoutId = setTimeout(() => {
      if (!didFinish) {
        // Timed-out – allow UI to show an empty state so user sees something
        setMarketLoading(false);
      }
    }, 8000);

    try {
      const indices = await getIndices(false, true);

      if (indices && !indices.error) {
        // Extract Nifty50 gainers/losers; fall back gracefully if backend shape differs
        const nifty = indices.find(i =>
          i.name?.toLowerCase().includes("nifty") || i.symbol?.toLowerCase().includes("nifty")
        );

        setGainers(nifty?.gainers?.slice(0, 5) || []);
        setLosers(nifty?.losers?.slice(0, 5) || []);
      }
    } finally {
      didFinish = true;
      clearTimeout(timeoutId);
      setMarketLoading(false);
    }
  }, []);

  // Flag to prevent duplicate API calls in React's StrictMode
  const [hasLoadedMarketMovers, setHasLoadedMarketMovers] = useState(false);
  const [hasLoadedWatchlists, setHasLoadedWatchlists] = useState(false);

  // Load market movers once when component mounts (no continuous polling).
  useEffect(() => {
    if (!hasLoadedMarketMovers) {
      loadMarketMovers();
      setHasLoadedMarketMovers(true);
    }
  }, [loadMarketMovers, hasLoadedMarketMovers]);

  // Load user watchlists on initial render.
  useEffect(() => {
    if (!hasLoadedWatchlists) {
      loadWatchlists();
      setHasLoadedWatchlists(true);
    }
  }, [loadWatchlists, hasLoadedWatchlists]);

  useEffect(() => {
    const fetchStocks = async () => {
      if (activeWatchlist && !activeWatchlist.is_virtual) {
        // fetch real stocks
        setLoading(prev => ({ ...prev, stocks: true }));
        const res = await fetchWatchlistStocks(activeWatchlist.id);
        if (!res.error) {
          // The backend now returns full stock data
          setWatchlistStocks(res.stocks || []);
          
          // Set gainers and losers for Sensex and Nifty 50
          if (res.gainers && res.losers) {
            setGainers(res.gainers);
            setLosers(res.losers);
          }
        } else {
          setWatchlistStocks([]);
          setGainers([]);
          setLosers([]);
          toast.error(`Could not load stocks for ${activeWatchlist.name}`);
        }
        setLoading(prev => ({ ...prev, stocks: false }));
      } else {
        // Virtual index: clear detailed stock list (we rely on movers instead)
        setWatchlistStocks([]);
      }
    };
    fetchStocks();
  }, [activeWatchlist]);
  
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      const results = await searchStocks(query);
      // Filter to NSE/BSE suffixes only, mimic Navbar logic
      let filtered = [];
      if (Array.isArray(results)) {
        filtered = results.filter((s) => s["1. symbol"]?.match(/\.(NSE|BSE)$/));
      } else if (results?.bestMatches) {
        filtered = results.bestMatches.filter((s) => s["1. symbol"]?.match(/\.(NSE|BSE)$/));
      }
      // ---------------------------------------------
      // Remove duplicates (prefer NSE over BSE) and
      // exclude symbols already present in the current
      // active watchlist to avoid 409 errors when
      // attempting to add duplicates.
      // ---------------------------------------------
      const seen = new Set();
      const currentSymbols = new Set(watchlistStocks.map((stk) => stk.symbol.toUpperCase()));
      const deduped = [];
      for (const s of filtered) {
        const normalizeSymbol = (sym) => {
          let s = (sym || "").toUpperCase();
          if (s.endsWith(".NSE")) return s.replace(".NSE", ".NS");
          if (s.endsWith(".BSE")) return s.replace(".BSE", ".BO");
          return s;
        };

        const symbolNorm = normalizeSymbol(s["1. symbol"]);
        if (seen.has(symbolNorm)) continue; // skip NSE/BSE duplicate
        seen.add(symbolNorm);
        if (currentSymbols.has(symbolNorm)) continue; // skip already-added stock
        deduped.push(s);
      }
      setSearchResults(deduped);
    }, 300),
    [watchlistStocks]
  );

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const handleAddStock = async (stock) => {
    if (!mainWatchlist) {
      toast.error("Main watchlist not found.");
      return;
    }

    // Prevent adding duplicates that already exist in Main
    const mainSymbols = new Set(watchlistStocks.map((stk) => stk.symbol.toUpperCase()));
    if (mainSymbols.has(stock["1. symbol"].toUpperCase())) {
      toast.error("Stock already exists in Main.");
      return;
    }

    setSearchQuery("");
    setSearchResults([]);

    const res = await addStockToWatchlist(
      mainWatchlist.id,
      stock["1. symbol"],
      stock["2. name"]
    );

    if (!res.error) {
      toast.success(`${stock["1. symbol"]} added.`);

      // Optimistically update local state so UI reflects immediately
      setWatchlistStocks((prev) => [
        ...prev,
        {
          symbol: stock["1. symbol"],
          name: stock["2. name"],
          price: null,
          change: null,
          percent_change: null,
        },
      ]);

      // Emit global event so other components (e.g. Navbar) refresh
      window.dispatchEvent(
        new CustomEvent("watchlist-stock-added", {
          detail: {
            watchlistId: mainWatchlist.id,
            symbol: stock["1. symbol"],
            name: stock["2. name"],
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
    if (!activeWatchlist || activeWatchlist.is_virtual) return;
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

  /* ------------------------------------------------------------------
   * RENDER
   * ------------------------------------------------------------------ */

  return (
    <>
      <Navbar />

      <div className="container mx-auto mt-24 p-4 max-w-5xl">
        {/* Watchlist Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {watchlists.map((wl) => (
            <Button
              key={wl.id || wl.name}
              variant={activeWatchlist?.id === wl.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveWatchlist(wl)}
            >
              {wl.name}
            </Button>
          ))}
        </div>

        {/* Search bar */}
        <div className="mb-6">
          <Input
            placeholder="Search NSE / BSE stocks…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="mb-8 rounded-lg border border-gray-200 divide-y">
            {searchResults.map((s) => (
              <div
                key={s["1. symbol"]}
                className="flex items-center justify-between p-3 hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium">
                    {s["2. name"]}
                  </div>
                  <div className="text-xs text-gray-500">
                    {s["1. symbol"]}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleAddStock(s)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Stocks table */}
        <div className="rounded-lg border border-gray-200 divide-y">
          {loading.stocks ? (
            <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
          ) : watchlistStocks.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No stocks to display.</div>
          ) : (
            watchlistStocks.map((stk) => (
              <div
                key={stk.symbol}
                className="flex items-center justify-between p-3 hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{stk.name || stk.symbol}</div>
                  <div className="text-xs text-gray-500">{stk.symbol}</div>
                </div>
                {!activeWatchlist?.is_virtual && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleRemoveStock(stk.symbol)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default Watchlist;