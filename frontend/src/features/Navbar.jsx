"use client"

import { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { searchStocks, addStockToWatchlist } from "@/services/api";
import { useDataContext } from "@/context/DataContext";
import { Input } from "@/assets/ui/input";
import { Avatar, AvatarFallback } from "@/assets/ui/avatar";
import { Button } from "@/assets/ui/button";
import { Search, TrendingUp, LogOut, User, BarChart3, Moon, Sun, Plus, Menu, Loader2 } from "lucide-react";
import { getClientId, isAuthenticatedSync, logout } from "@/services/auth";
import debounce from "lodash.debounce";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/assets/ui/dropdown-menu";
import { toast } from "react-hot-toast";

const Navbar = () => {
  const navigate = useNavigate();
  
  // --- Global State from Context ---
  // We get live indices data directly from the context.
  const { indicesData, getProfile, getWatchlists } = useDataContext();

  // --- Local Component State ---
  const [profile, setProfile] = useState({ name: "Client Name", clientId: "TR123456", email: "" });
  const [indices, setIndices] = useState([]); // Local state for Navbar's specific indices
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [allWatchlists, setAllWatchlists] = useState([]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchContainerRef = useRef(null);

  // --- Effects ---

  // Initialize dark mode from localStorage on component mount
  useEffect(() => {
    const savedDarkMode = localStorage.getItem("darkMode") === "true";
    setDarkMode(savedDarkMode);
    if (savedDarkMode) {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Consolidated "click outside" handler for closing the search dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
        setIsSearchExpanded(false);
        setSearchQuery("");
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Effect to update the Navbar's local indices state whenever the global context data changes
  useEffect(() => {
    if (indicesData && Array.isArray(indicesData)) {
      const navbarIndices = indicesData.filter(index =>
        ["Nifty 50", "SENSEX"].includes(index.name)
      );
      setIndices(navbarIndices);
    }
  }, [indicesData]); // This runs every time the live indicesData updates

  // Fetch non-real-time data (profile, watchlists) on component mount
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticatedSync()) {
        navigate("/login");
        return;
      }
      try {
        const profileData = await getProfile();
        if (profileData?.error) {
          navigate("/login");
          return;
        }
        if (profileData) {
          setProfile({
            name: profileData.email || "Client Name",
            clientId: getClientId() || "TR123456",
            email: profileData.email || "",
          });
        }
        const wlRes = await getWatchlists();
        if (!wlRes?.error) {
          setAllWatchlists(wlRes);
        }
      } catch (error) {
        if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
          navigate("/login");
        }
      }
    };
    fetchData();
  }, [navigate, getProfile, getWatchlists]);
  
  // Debounced search logic
  const debouncedSearch = useCallback(debounce(async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    try {
      const response = await searchStocks(query);
      // Handle both direct array response and object with bestMatches property
      const results = response?.bestMatches || response || [];
      setSearchResults(results);
    } catch (error) {
      console.warn('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, 300), []);
  
  useEffect(() => {
    if (searchQuery.trim()) {
      setShowSearchDropdown(true);
      debouncedSearch(searchQuery);
    } else {
      setShowSearchDropdown(false);
      setSearchResults([]);
      debouncedSearch.cancel();
    }
    return () => debouncedSearch.cancel();
  }, [searchQuery, debouncedSearch]);

  // --- Handlers & Helper Functions ---

  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem("darkMode", newDarkMode.toString());
    document.documentElement.classList.toggle("dark", newDarkMode);
  };

  const handleSelectStock = (symbol) => {
    const cleanSymbol = symbol.replace(/\.(NS|NSE|BO|BSE)$/i, '');
    setSearchQuery("");
    navigate(`/stock/overview/${cleanSymbol}`);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const formatNumber = (value, decimalPlaces = 2) => {
    return value !== undefined && !isNaN(value) ? Number.parseFloat(value).toFixed(decimalPlaces) : "N/A";
  };

  // --- Sub-components ---

  const AddWatchlistDropdown = ({ stock }) => {
    const [isAdding, setIsAdding] = useState(false);
    const handleAdd = async (e) => {
      e.stopPropagation();
      if (isAdding) return;

      const stocksWatchlist = allWatchlists.find(w => w.name?.toLowerCase() === "stocks");
      if (!stocksWatchlist) {
        toast.error("Stocks watchlist not found");
        return;
      }
      setIsAdding(true);
      const symbolNorm = stock["1. symbol"];
      const res = await addStockToWatchlist(stocksWatchlist.name || "Stocks", symbolNorm, stock["2. name"]);
      if (res?.error) {
        toast.error(res.error);
      } else {
        getWatchlists(true); // Force refresh watchlists
        toast.success(`${symbolNorm.split('.')[0]} added to watchlist`);
      }
      setIsAdding(false);
    };

    return (
      <Button variant="ghost" size="icon" className="flex-shrink-0" onClick={handleAdd} disabled={isAdding}>
        {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </Button>
    );
  };

  return (
    <>
      <motion.div
        className="fixed top-0 left-0 right-0 h-10 bg-gradient-to-b from-white to-transparent dark:from-gray-900 dark:to-transparent z-40 pointer-events-none"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
      />
      <motion.div
        className="fixed top-4 left-4 right-4 lg:left-16 lg:right-16 z-50"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl">
          {/* Market Indices Ticker */}
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl">
            <div className="px-6 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-8">
                  {indices.length > 0 ? (
                    indices.map((index, i) => (
                      <motion.div
                        key={index.name}
                        className="flex items-center gap-3 whitespace-nowrap"
                        initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: i * 0.1 }}
                      >
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{index.name}</span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          ₹{formatNumber(index.price)}
                        </span>
                        <motion.span
                          className={`text-sm font-semibold px-2 py-1 rounded-full ${
                            Number.parseFloat(index.change_intraday || index.change_daily || index.change) >= 0 
                              ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30" 
                              : "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30"
                          }`}
                          whileHover={{ scale: 1.05 }}
                        >
                          {Number.parseFloat(index.change_intraday || index.change_daily || index.change) >= 0 ? "+" : ""}
                          {formatNumber(index.change_intraday || index.change_daily || index.change)} ({formatNumber(index.percent_change_intraday || index.percent_change_daily || index.percent_change)}%)
                        </motion.span>
                      </motion.div>
                    ))
                  ) : (
                    <div className="flex items-center gap-8">
                      {[...Array(2)].map((_, i) => (
                        <div key={i} className="animate-pulse flex items-center gap-3">
                          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
                          <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded-full w-24"></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate("/indices")} className="bg-black text-white border-none hover:bg-gray-800 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Indices
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Header Section */}
          <header className="px-6 py-4" ref={searchContainerRef}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 lg:gap-8 flex-1">
                {/* Logo and Nav Links */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="bg-gradient-to-r from-black to-gray-700 p-2 rounded-xl">
                    <TrendingUp className="h-6 w-6 text-white" />
                  </div>
                  <span className="font-bold text-xl text-transparent bg-clip-text bg-gradient-to-r from-black to-gray-700 dark:from-gray-200 dark:to-gray-400">
                    TradeEasy
                  </span>
                </div>
                <nav className="hidden xl:flex items-center gap-6">
                  {['Dashboard', 'Watchlist', 'Portfolio', 'Performance', 'Markets'].map(item => (
                    <a key={item} onClick={() => navigate(`/${item.toLowerCase() === 'dashboard' ? '' : item.toLowerCase()}`)}
                      className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer">
                      {item}
                    </a>
                  ))}
                </nav>
                {/* Desktop Search Bar */}
                <div className="hidden xl:block relative w-80 lg:w-64">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Search NSE/BSE stocks..." className="pl-12" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    {searchLoading && <Loader2 className="h-4 w-4 animate-spin absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400" />}
                  <AnimatePresence>
                    {showSearchDropdown && (
                      <motion.div 
                        className="absolute left-0 right-0 mt-2 bg-white dark:bg-gray-800 border rounded-xl shadow-xl z-20 overflow-hidden max-h-96 overflow-y-auto"
                        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      >
                         {searchResults.length > 0 ? (
                            searchResults.slice(0, 7).map((stock) => (
                              <div key={stock["1. symbol"]} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0">
                                <div className="flex items-center justify-between">
                                  <div className="cursor-pointer flex-1" onClick={() => handleSelectStock(stock["1. symbol"])}>
                                    <div className="font-medium">{stock["1. symbol"].split('.')[0]}</div>
                                    <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{stock["2. name"]}</div>
                                  </div>
                                  <AddWatchlistDropdown stock={stock} />
                                </div>
                              </div>
                            ))
                          ) : !searchLoading && searchQuery && (
                            <div className="p-4 text-center text-sm text-gray-500">No stocks found.</div>
                          )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              
              {/* Profile & Mobile Controls */}
              <div className="flex items-center gap-2">
                 {/* Mobile Menu & Search Buttons */}
                 <div className="flex items-center gap-2 xl:hidden">
                    <Button variant="ghost" size="icon" onClick={() => setIsSearchExpanded(!isSearchExpanded)}><Search className="h-5 w-5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}><Menu className="h-5 w-5" /></Button>
                  </div>
                {/* Profile Dropdown */}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <motion.div className="cursor-pointer" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Avatar className="w-9 h-9">
                        <AvatarFallback className="bg-gray-100 dark:bg-gray-700"><User className="h-5 w-5" /></AvatarFallback>
                      </Avatar>
                    </motion.div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64 mr-4 mt-2">
                    <div className="px-4 py-3">
                      <p className="font-semibold truncate">{profile.email || profile.name}</p>
                      <p className="text-gray-500 text-xs">ID: {profile.clientId}</p>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate("/profile")}><User className="mr-2 h-4 w-4" /> Profile</DropdownMenuItem>
                    <DropdownMenuItem onClick={toggleDarkMode}>
                      {darkMode ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
                      {darkMode ? "Light Mode" : "Dark Mode"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-900/20">
                      <LogOut className="mr-2 h-4 w-4" /> Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
             {/* Mobile Search Expanded */}
            <AnimatePresence>
              {isSearchExpanded && (
                <motion.div className="xl:hidden pt-4" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input placeholder="Search NSE/BSE stocks..." className="pl-12" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    {searchLoading && <Loader2 className="h-4 w-4 animate-spin absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400" />}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          {/* Mobile Menu */}
          <AnimatePresence>
            {isMobileMenuOpen && (
              <motion.div
                className="xl:hidden border-t dark:border-gray-700"
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              >
                <div className="px-6 py-4 space-y-2">
                  {['Dashboard', 'Watchlist', 'Portfolio', 'Performance', 'Markets'].map(item => (
                    <a key={item} onClick={() => {
                        navigate(`/${item.toLowerCase() === 'dashboard' ? '' : item.toLowerCase()}`);
                        setIsMobileMenuOpen(false);
                      }}
                      className="block py-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                      {item}
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  );
};

export default Navbar;