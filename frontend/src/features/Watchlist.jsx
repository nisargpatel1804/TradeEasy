import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import debounce from "lodash.debounce";
import { motion, AnimatePresence } from "framer-motion";

import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { useDataContext } from "../context/DataContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";

import { Button } from "../assets/ui/button.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../assets/ui/dropdown-menu.jsx";
import { Search, Plus, Trash2, Loader2, TrendingUp, TrendingDown } from "lucide-react";

import TradeForm from "./TradeForm.jsx";
import { Card, CardContent } from "../assets/ui/card.jsx";

const Watchlist = () => {
    const navigate = useNavigate();
    const { watchlistsData, getWatchlists } = useDataContext();
    const { isConnected } = useSocket();

    const [activeWatchlistName, setActiveWatchlistName] = useState("");
    const [stocks, setStocks] = useState([]);
    const [livePrices, setLivePrices] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [showTradeModal, setShowTradeModal] = useState(false);
    const [selectedStock, setSelectedStock] = useState(null);
    const [tradeAction, setTradeAction] = useState('BUY');

    // --- Data Fetching and Initialization ---
    useEffect(() => {
        const initialize = async () => {
            setIsLoading(true);
            try {
                const data = watchlistsData || await getWatchlists(true);
                if (data && data.watchlists && data.watchlists.length > 0) {
                    const defaultWatchlist = data.watchlists.find(w => !w.is_deletable) || data.watchlists[0];
                    setActiveWatchlistName(defaultWatchlist.name);
                    setStocks(defaultWatchlist.stocks || []);
                } else {
                     setActiveWatchlistName("My Watchlist");
                     setStocks([]);
                }
            } catch (error) {
                toast.error("Failed to load watchlists.");
            } finally {
                setIsLoading(false);
            }
        };
        initialize();
    }, [getWatchlists, watchlistsData]);

    // --- Real-time Price Updates ---
    useEffect(() => {
        const unsubscribe = priceUpdateService.subscribe(data => {
            setLivePrices(data.allPrices);
        });
        return () => unsubscribe();
    }, []);

    // --- Memoized Stock List with Live Data ---
    const stocksWithLiveData = useMemo(() => {
        if (!Array.isArray(stocks)) return [];
        return stocks.map(stock => {
            if (!stock || !stock.symbol) return null;
            const liveData = livePrices[stock.symbol];
            return liveData ? { ...stock, ...liveData } : stock;
        }).filter(Boolean); // Filter out any null/invalid stock entries
    }, [stocks, livePrices]);

    // --- Handlers ---
    const handleTradeClick = (stock, action) => {
        setSelectedStock(stock);
        setTradeAction(action);
        setShowTradeModal(true);
    };
    
    const handleRemoveStock = async (watchlistName, symbol) => {
        const toastId = toast.loading(`Removing ${symbol}...`);
        try {
            await api.removeStockFromWatchlist(watchlistName, symbol);
            toast.success(`${symbol} removed.`, { id: toastId });
            const updatedWatchlists = await getWatchlists(true);
            const activeWl = updatedWatchlists.watchlists.find(w => w.name === activeWatchlistName);
            setStocks(activeWl ? activeWl.stocks : []);
        } catch (error) {
            toast.error(error.message || "Failed to remove stock.", { id: toastId });
        }
    };
    
    const handleSelectWatchlist = (name) => {
        const newActiveWl = watchlistsData.watchlists.find(w => w.name === name);
        if (newActiveWl) {
            setActiveWatchlistName(name);
            setStocks(newActiveWl.stocks || []);
        }
    };

    const handleAddSuccess = async () => {
        const updatedData = await getWatchlists(true);
         if (updatedData && updatedData.watchlists) {
            const activeWl = updatedData.watchlists.find(w => w.name === activeWatchlistName);
            if (activeWl) {
                setStocks(activeWl.stocks || []);
            }
        }
    }

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Watchlist</h1>
                    <p className="text-gray-500">Your curated list of stocks to track.</p>
                </div>
                 <div className="flex items-center gap-4 w-full md:w-auto">
                    <StockSearch onAddSuccess={handleAddSuccess} />
                     <WatchlistSelector 
                        watchlists={watchlistsData?.watchlists || []}
                        active={activeWatchlistName}
                        onSelect={handleSelectWatchlist}
                    />
                </div>
            </header>
            
            <Card className="shadow-lg">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Symbol</TableHead>
                                <TableHead className="text-right">LTP (₹)</TableHead>
                                <TableHead className="text-right">Change (₹)</TableHead>
                                <TableHead className="text-right">Change (%)</TableHead>
                                <TableHead className="text-center">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [...Array(5)].map((_, i) => <StockRowSkeleton key={i} />)
                            ) : stocksWithLiveData.length > 0 ? (
                                stocksWithLiveData.map(stock => (
                                    <StockRow 
                                        key={stock.symbol} 
                                        stock={stock} 
                                        onTrade={handleTradeClick}
                                        onRemove={() => handleRemoveStock(activeWatchlistName, stock.symbol)}
                                    />
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-12 text-gray-500">
                                        Your watchlist is empty. Add stocks using the search bar.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={showTradeModal} onOpenChange={setShowTradeModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{tradeAction === 'BUY' ? 'Buy' : 'Sell'} {selectedStock?.symbol}</DialogTitle>
                    </DialogHeader>
                    <TradeForm
                        symbol={selectedStock?.symbol}
                        onTradeSuccess={() => {
                            setShowTradeModal(false);
                        }}
                        onClose={() => setShowTradeModal(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};

// --- Sub-components ---

const StockRow = ({ stock, onTrade, onRemove }) => {
    const navigate = useNavigate();
    const ltp = stock.ltp || 0;
    const change = stock.change || 0;
    const percentChange = stock.percent_change || 0;
    const isPositive = change >= 0;

    return (
        <TableRow 
            className="cursor-pointer hover:bg-gray-50" 
            onClick={() => navigate(`/stock/${stock.symbol}`)}
        >
            <TableCell>
                <div className="font-medium text-gray-800">{stock.symbol}</div>
                <div className="text-sm text-gray-500 truncate max-w-xs">{stock.name}</div>
            </TableCell>
            <TableCell className="text-right font-semibold">₹{ltp.toFixed(2)}</TableCell>
            <TableCell className={`text-right font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {isPositive ? '+' : ''}{change.toFixed(2)}
            </TableCell>
            <TableCell className={`text-right font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {isPositive ? '+' : ''}{percentChange.toFixed(2)}%
            </TableCell>
            <TableCell className="text-center">
                 <div className="flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="text-green-600 border-green-600 hover:bg-green-50" onClick={() => onTrade(stock, 'BUY')}>Buy</Button>
                    <Button size="sm" variant="outline" className="text-red-600 border-red-600 hover:bg-red-50" onClick={() => onTrade(stock, 'SELL')}>Sell</Button>
                    <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4 text-gray-500 hover:text-red-600"/></Button>
                </div>
            </TableCell>
        </TableRow>
    );
};

const StockRowSkeleton = () => (
    <TableRow>
        <TableCell>
            <Skeleton className="h-5 w-20 mb-1" />
            <Skeleton className="h-4 w-40" />
        </TableCell>
        <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
        <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
        <TableCell><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
        <TableCell><Skeleton className="h-8 w-32 mx-auto" /></TableCell>
    </TableRow>
);

const StockSearch = ({ onAddSuccess }) => {
    const { watchlistsData } = useDataContext();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const searchRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (searchRef.current && !searchRef.current.contains(event.target)) {
                setIsFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const debouncedSearch = useCallback(debounce(async (searchQuery) => {
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
    }, 300), []);

    useEffect(() => {
        debouncedSearch(query);
    }, [query, debouncedSearch]);

    const handleAddStock = async (e, stock) => {
        e.stopPropagation();
        const defaultWatchlist = watchlistsData?.watchlists.find(w => !w.is_deletable);
        if (!defaultWatchlist) {
            toast.error("Your primary watchlist could not be found.");
            return;
        }
        const toastId = toast.loading(`Adding ${stock.symbol}...`);
        try {
            await api.addStockToWatchlist(defaultWatchlist.name, stock.symbol, stock.name, stock.scripcode);
            toast.success(`${stock.symbol} added to ${defaultWatchlist.name}`, { id: toastId });
            setQuery("");
            setResults([]);
            if(onAddSuccess) onAddSuccess();
        } catch (error) {
            toast.error(error.message || `Failed to add ${stock.symbol}`, { id: toastId });
        }
    };

    const showDropdown = isFocused && query.length > 0;

    return (
         <div className="relative w-full max-w-xs" ref={searchRef}>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                    placeholder="Search to add stocks..."
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
                        <div className="p-4 text-center text-sm text-gray-500">Searching...</div>
                    ) : results.length > 0 ? (
                    results.map((stock) => (
                        <div key={stock.symbol} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0 flex items-center justify-between">
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
}

const WatchlistSelector = ({ watchlists, active, onSelect }) => {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">{active || 'Select Watchlist'}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {watchlists.map(wl => (
                    <DropdownMenuItem key={wl.name} onSelect={() => onSelect(wl.name)}>
                        {wl.name}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default Watchlist;

