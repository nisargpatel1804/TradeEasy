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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../assets/ui/dropdown-menu.jsx";
import { Search, Plus, PlusCircle, Trash2, Loader2, AlertTriangle, ArrowUpDown, ChevronUp, ChevronDown } from "lucide-react";

import TradeForm from "./TradeForm.jsx";
import { Card, CardContent } from "../assets/ui/card.jsx";

const Watchlist = () => {
    const navigate = useNavigate();
    const { watchlistsData, getWatchlists } = useDataContext();
    const { connectionStatus } = useSocket();

    const [watchlists, setWatchlists] = useState([]);
    const [activeWatchlistName, setActiveWatchlistName] = useState("");
    const activeWatchlistNameRef = useRef("");
    const [stocks, setStocks] = useState([]);
    const [livePrices, setLivePrices] = useState({});
    const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' });
    const [isLoading, setIsLoading] = useState(true);
    const [showTradeModal, setShowTradeModal] = useState(false);
    const [selectedStock, setSelectedStock] = useState(null);
    const [tradeAction, setTradeAction] = useState('BUY');
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newWatchlistName, setNewWatchlistName] = useState("");
    const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);

    const handleSort = useCallback((column) => {
        setSortConfig(prev => {
            if (prev.column === column) {
                return {
                    column,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc',
                };
            }
            return { column, direction: 'asc' };
        });
    }, []);

    const renderSortIcon = useCallback((column) => {
        if (sortConfig.column !== column) {
            return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />;
        }
        return sortConfig.direction === 'asc'
            ? <ChevronUp className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
            : <ChevronDown className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />;
    }, [sortConfig]);

    const getAriaSortValue = useCallback((column) => {
        if (sortConfig.column !== column) {
            return 'none';
        }
        return sortConfig.direction === 'asc' ? 'ascending' : 'descending';
    }, [sortConfig]);

    const pickActiveWatchlist = useCallback((list, preferredName) => {
        if (!Array.isArray(list) || list.length === 0) {
            return null;
        }
        if (preferredName) {
            const exactMatch = list.find(w => w.name === preferredName);
            if (exactMatch) {
                return exactMatch;
            }
        }
        const defaultWatchlist = list.find(w => !w.is_deletable);
        return defaultWatchlist || list[0];
    }, []);

    const activeWatchlist = useMemo(
        () => pickActiveWatchlist(watchlists, activeWatchlistName),
        [pickActiveWatchlist, watchlists, activeWatchlistName]
    );

    useEffect(() => {
        activeWatchlistNameRef.current = activeWatchlistName;
    }, [activeWatchlistName]);

    useEffect(() => {
        setStocks(activeWatchlist?.stocks || []);
    }, [activeWatchlist]);

    // --- Data Fetching and Initialization ---
    useEffect(() => {
        const initialize = async () => {
            setIsLoading(true);
            try {
                const data = watchlistsData || await getWatchlists(true);
                const resolvedWatchlists = Array.isArray(data?.watchlists) ? data.watchlists : [];
                setWatchlists(resolvedWatchlists);

                const nextActive = pickActiveWatchlist(resolvedWatchlists, activeWatchlistNameRef.current);
                setActiveWatchlistName(nextActive?.name || "");
            } catch (error) {
                toast.error("Failed to load watchlists.");
            } finally {
                setIsLoading(false);
            }
        };
        initialize();
    }, [getWatchlists, pickActiveWatchlist, watchlistsData]);

    const applyWatchlistUpdate = useCallback((updatedWatchlist) => {
        if (!updatedWatchlist?.name) {
            return;
        }

        setWatchlists(prev => {
            const exists = prev.some(w => w.name === updatedWatchlist.name);
            const next = exists
                ? prev.map(w => (w.name === updatedWatchlist.name ? updatedWatchlist : w))
                : [...prev, updatedWatchlist];
            return next;
        });

        if (updatedWatchlist.name === activeWatchlistNameRef.current) {
            setStocks(updatedWatchlist.stocks || []);
        }
    }, []);

    const syncWatchlists = useCallback(async (preferredName) => {
        try {
            const data = await getWatchlists(true);
            const resolvedWatchlists = Array.isArray(data?.watchlists) ? data.watchlists : [];
            setWatchlists(resolvedWatchlists);

            const nextActive = pickActiveWatchlist(
                resolvedWatchlists,
                preferredName || activeWatchlistNameRef.current
            );
            setActiveWatchlistName(nextActive?.name || "");
            return nextActive;
        } catch (error) {
            console.error('Failed to refresh watchlists:', error);
            throw error;
        }
    }, [getWatchlists, pickActiveWatchlist]);

    // --- Real-time Price Updates ---
    useEffect(() => {
        const unsubscribe = priceUpdateService.subscribe(update => {
            setLivePrices(prev => {
                if (update?.type === 'snapshot' || update?.type === 'reset') {
                    return update?.allPrices || {};
                }

                if (update?.changedPrices && Object.keys(update.changedPrices).length > 0) {
                    return {
                        ...prev,
                        ...update.changedPrices,
                    };
                }

                return prev;
            });
        });
        return () => unsubscribe();
    }, []);

    // --- Memoized Stock List with Live Data ---
    const stocksWithLiveData = useMemo(() => {
        if (!Array.isArray(stocks)) {
            return [];
        }

        const enriched = stocks
            .map((stock, index) => {
                if (!stock || !stock.symbol) {
                    return null;
                }

                const liveData = livePrices[stock.symbol];
                const merged = liveData ? { ...stock, ...liveData } : { ...stock };
                
                // Fallback to previous_close if ltp is 0 or missing
                if (!merged.ltp || merged.ltp === 0) {
                    merged.ltp = merged.previous_close || 0;
                    merged.price_source = 'previous_close';
                }
                
                return { ...merged, originalIndex: index };
            })
            .filter(Boolean);

        if (!sortConfig.column) {
            return enriched;
        }

        const directionMultiplier = sortConfig.direction === 'asc' ? 1 : -1;

        const toNumber = (value) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };

        const sorted = [...enriched].sort((a, b) => {
            switch (sortConfig.column) {
                case 'name': {
                    const nameA = (a.name || a.symbol || '').toString().toLowerCase();
                    const nameB = (b.name || b.symbol || '').toString().toLowerCase();
                    if (nameA < nameB) return -1 * directionMultiplier;
                    if (nameA > nameB) return 1 * directionMultiplier;
                    break;
                }
                case 'ltp': {
                    const priceA = toNumber(a.ltp ?? a.price);
                    const priceB = toNumber(b.ltp ?? b.price);
                    if (priceA !== priceB) {
                        return (priceA - priceB) * directionMultiplier;
                    }
                    break;
                }
                case 'percent_change': {
                    const pctA = toNumber(a.percent_change ?? a.percentChange);
                    const pctB = toNumber(b.percent_change ?? b.percentChange);
                    if (pctA !== pctB) {
                        return (pctA - pctB) * directionMultiplier;
                    }
                    break;
                }
                default:
                    break;
            }

            return (a.originalIndex - b.originalIndex);
        });

        return sorted;
    }, [stocks, livePrices, sortConfig]);

    // --- Initial Snapshot Fallback ---
    useEffect(() => {
        if (!Array.isArray(stocks) || stocks.length === 0) {
            return;
        }

        const symbolsNeedingSnapshot = Array.from(new Set(
            stocks
                .map(stock => stock?.symbol)
                .filter(Boolean)
                .filter(symbol => !priceUpdateService.getLatestPrice(symbol))
        ));

        if (symbolsNeedingSnapshot.length === 0) {
            return;
        }

        let isActive = true;

        const fetchInitialSnapshot = async () => {
            try {
                const response = await api.batchGetStockData(symbolsNeedingSnapshot);
                const batchData = response?.data || {};
                const priceMap = {};

                symbolsNeedingSnapshot.forEach(fullSymbol => {
                    const baseSymbol = fullSymbol.includes('.') ? fullSymbol.split('.')[0] : fullSymbol;
                    const apiPayload = batchData?.[baseSymbol];
                    if (!apiPayload || apiPayload.error) {
                        return;
                    }

                    priceMap[fullSymbol] = {
                        symbol: fullSymbol,
                        ltp: apiPayload.ltp,
                        change: apiPayload.change,
                        percent_change: apiPayload.percent_change,
                        volume: apiPayload.volume,
                        price_source: apiPayload.price_source || 'ltp',
                        last_updated: apiPayload.last_updated,
                        entityType: 'stock',
                    };
                });

                if (isActive && Object.keys(priceMap).length > 0) {
                    priceUpdateService.seedPrices(priceMap);
                }
            } catch (error) {
                console.error('Failed to fetch initial watchlist prices:', error);
            }
        };

        fetchInitialSnapshot();

        return () => {
            isActive = false;
        };
    }, [stocks]);

    // --- Handlers ---
    const handleTradeClick = (stock, action) => {
        setSelectedStock(stock);
        setTradeAction(action);
        setShowTradeModal(true);
    };
    
    const handleRemoveStock = async (watchlistName, symbol) => {
        const toastId = toast.loading(`Removing ${symbol}...`);
        let watchlistNameForSync = watchlistName;
        try {
            const response = await api.removeStockFromWatchlist(watchlistName, symbol);
            const updatedWatchlist = response?.watchlist;
            if (updatedWatchlist) {
                applyWatchlistUpdate(updatedWatchlist);
                watchlistNameForSync = updatedWatchlist.name;
            }

            toast.success(`${symbol} removed.`, { id: toastId });
        } catch (error) {
            toast.error(error.message || "Failed to remove stock.", { id: toastId });
            return;
        }

        try {
            await syncWatchlists(watchlistNameForSync);
        } catch (refreshError) {
            console.error('Failed to refresh watchlists after removing stock:', refreshError);
        }
    };
    
    const handleSelectWatchlist = (name) => {
        setActiveWatchlistName(name);
        const newActiveWl = watchlists.find(w => w.name === name);
        if (newActiveWl) {
            setStocks(newActiveWl.stocks || []);
        }
    };

    const handleAddStock = async (stock) => {
        const targetWatchlist = activeWatchlist;
        if (!targetWatchlist) {
            toast.error("Select a watchlist before adding stocks.");
            return false;
        }

        const existingSymbols = new Set(
            (targetWatchlist.stocks || [])
                .map(item => item?.symbol?.toUpperCase())
                .filter(Boolean)
        );

        if (existingSymbols.has(stock.symbol.toUpperCase())) {
            toast(`'${stock.symbol}' is already in ${targetWatchlist.name}.`, { icon: 'ℹ️' });
            return false;
        }

        const toastId = toast.loading(`Adding ${stock.symbol}...`);
        let watchlistNameForSync = targetWatchlist.name;
        try {
            const payload = await api.addStockToWatchlist(targetWatchlist.name, {
                symbol: stock.symbol,
                name: stock.name,
                scripcode: stock.scripcode
            });

            const updatedWatchlist = payload?.watchlist;
            if (updatedWatchlist) {
                applyWatchlistUpdate(updatedWatchlist);
                watchlistNameForSync = updatedWatchlist.name;
            }

            toast.success(`${stock.symbol} added to ${targetWatchlist.name}`, { id: toastId });
        } catch (error) {
            const friendlyMessage = error?.status === 409
                ? `'${stock.symbol}' is already in ${targetWatchlist.name}.`
                : (error?.message || `Failed to add ${stock.symbol}`);
            toast.error(friendlyMessage, { id: toastId });
            return false;
        }

        try {
            await syncWatchlists(watchlistNameForSync);
        } catch (refreshError) {
            console.error('Failed to refresh watchlists after adding stock:', refreshError);
        }
        return true;
    };

    const handleCreateWatchlist = async (event) => {
        if (event?.preventDefault) {
            event.preventDefault();
        }

        const trimmedName = newWatchlistName.trim();
        if (!trimmedName) {
            toast.error("Watchlist name cannot be empty.");
            return;
        }

        const isDuplicate = watchlists.some(
            wl => wl.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (isDuplicate) {
            toast(`'${trimmedName}' already exists.`, { icon: 'ℹ️' });
            return;
        }

        const toastId = toast.loading(`Creating '${trimmedName}'...`);
        setIsSavingWatchlist(true);
        try {
            const response = await api.createWatchlist(trimmedName);
            const createdWatchlist = response?.watchlist;
            if (createdWatchlist) {
                applyWatchlistUpdate(createdWatchlist);
            }

            toast.success(`'${trimmedName}' created.`, { id: toastId });
            setNewWatchlistName("");
            setIsCreateDialogOpen(false);
            await syncWatchlists(createdWatchlist?.name || trimmedName);
        } catch (error) {
            toast.error(error.message || "Failed to create watchlist.", { id: toastId });
        } finally {
            setIsSavingWatchlist(false);
        }
    };

    return (
        <div className="p-4 md:p-8 max-w-7xl mx-auto">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Watchlist</h1>
                    <p className="text-gray-500">Your curated list of stocks to track.</p>
                </div>
                 <div className="flex items-center gap-4 w-full md:w-auto">
                    <StockSearch 
                        activeWatchlist={activeWatchlist}
                        onAddStock={handleAddStock}
                    />
                    <WatchlistSelector 
                        watchlists={watchlists}
                        active={activeWatchlistName}
                        onSelect={handleSelectWatchlist}
                        onCreate={() => setIsCreateDialogOpen(true)}
                    />
                </div>
            </header>

            {connectionStatus !== 'connected' && (
                <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                        <p className="font-semibold">
                            {connectionStatus === 'reconnecting'
                                ? 'Reconnecting to live market data…'
                                : 'Live market data is temporarily unavailable.'}
                        </p>
                        <p className="mt-1 text-amber-700">
                            {connectionStatus === 'reconnecting'
                                ? 'We are attempting to restore live price updates in the background. You can continue managing your watchlist.'
                                : 'Live price updates are paused. Recently added stocks will still appear with their last known prices.'}
                        </p>
                    </div>
                </div>
            )}
            
            <Card className="shadow-lg">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead
                                    aria-sort={getAriaSortValue('name')}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSort('name')}
                                        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900 focus:outline-none dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        <span>Symbol / Name</span>
                                        {renderSortIcon('name')}
                                    </button>
                                </TableHead>
                                <TableHead
                                    className="text-right"
                                    aria-sort={getAriaSortValue('ltp')}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSort('ltp')}
                                        className="flex items-center justify-end gap-1 w-full text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900 focus:outline-none dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        <span>LTP (₹)</span>
                                        {renderSortIcon('ltp')}
                                    </button>
                                </TableHead>
                                <TableHead className="text-right">Change (₹)</TableHead>
                                <TableHead
                                    className="text-right"
                                    aria-sort={getAriaSortValue('percent_change')}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSort('percent_change')}
                                        className="flex items-center justify-end gap-1 w-full text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900 focus:outline-none dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        <span>Change (%)</span>
                                        {renderSortIcon('percent_change')}
                                    </button>
                                </TableHead>
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

            <Dialog
                open={isCreateDialogOpen}
                onOpenChange={(open) => {
                    setIsCreateDialogOpen(open);
                    if (!open) {
                        setNewWatchlistName("");
                    }
                }}
            >
                <DialogContent>
                    <form onSubmit={handleCreateWatchlist} className="space-y-4">
                        <DialogHeader>
                            <DialogTitle>Create a new watchlist</DialogTitle>
                            <DialogDescription>
                                Organize stocks by grouping them into personalized watchlists.
                            </DialogDescription>
                        </DialogHeader>
                        <Input
                            placeholder="Watchlist name"
                            value={newWatchlistName}
                            onChange={(e) => setNewWatchlistName(e.target.value)}
                            autoFocus
                        />
                        <DialogFooter className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setIsCreateDialogOpen(false);
                                    setNewWatchlistName("");
                                }}
                                disabled={isSavingWatchlist}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isSavingWatchlist}>
                                {isSavingWatchlist && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Create
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={showTradeModal} onOpenChange={setShowTradeModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{tradeAction === 'BUY' ? 'Buy' : 'Sell'} {selectedStock?.symbol}</DialogTitle>
                        <DialogDescription>
                            {tradeAction === 'BUY' ? 'Place a buy order for' : 'Place a sell order for'} {selectedStock?.name || selectedStock?.symbol}
                        </DialogDescription>
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
    const toNumber = (value, fallback = 0) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const ltp = toNumber(stock.ltp ?? stock.price, 0);
    const change = toNumber(stock.change, 0);
    const percentChange = toNumber(stock.percent_change ?? stock.percentChange, 0);
    const isPositive = change >= 0;
    const priceSource = stock.price_source || 'ltp';
    const isFallbackPrice = priceSource !== 'ltp';

    return (
        <TableRow 
            className="cursor-pointer hover:bg-gray-50" 
            onClick={() => navigate(`/stock/${stock.symbol}`)}
        >
            <TableCell>
                <div className="font-medium text-gray-800">{stock.symbol}</div>
                <div className="text-sm text-gray-500 truncate max-w-xs">{stock.name}</div>
            </TableCell>
            <TableCell className="text-right">
                <div className="font-semibold">₹{ltp.toFixed(2)}</div>
                {isFallbackPrice && (
                    <div className="text-xs text-gray-400">Prev Close</div>
                )}
            </TableCell>
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
                    <Button size="icon" variant="ghost" className="hover:bg-red-50" onClick={onRemove} title="Remove from watchlist">
                        <Trash2 className="h-4 w-4 text-red-500 hover:text-red-700"/>
                    </Button>
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

const StockSearch = ({ activeWatchlist, onAddStock }) => {
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

    const isStockInWatchlist = (stock) => {
        if (!activeWatchlist?.stocks) return false;
        return activeWatchlist.stocks.some(s => 
            s.symbol === stock.symbol || s.scripcode === stock.scripcode
        );
    };

    const handleAddStock = async (e, stock) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (!activeWatchlist) {
            toast.error("Select a watchlist before adding stocks.");
            return;
        }

        // Check if stock is already in the watchlist
        if (isStockInWatchlist(stock)) {
            toast.error(`${stock.symbol} is already in ${activeWatchlist.name}`, {
                duration: 2000,
                icon: "ℹ️"
            });
            return;
        }

        const wasAdded = await onAddStock?.(stock);
        if (wasAdded) {
            setQuery("");
            setResults([]);
            setIsFocused(false);
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
                    results.map((stock) => {
                        const alreadyAdded = isStockInWatchlist(stock);
                        return (
                            <div 
                                key={stock.symbol} 
                                className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700 last:border-b-0 flex items-center justify-between group"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium">{stock.symbol}</div>
                                    <div className="text-sm text-gray-600 dark:text-gray-400 truncate">{stock.name}</div>
                                </div>
                                {alreadyAdded ? (
                                    <div className="text-xs text-green-600 dark:text-green-400 font-medium px-2">
                                        Added ✓
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={(e) => handleAddStock(e, stock)}
                                        className="shrink-0 ml-2 p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                        aria-label={`Add ${stock.symbol} to watchlist`}
                                    >
                                        <Plus className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        );
                    })
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

const WatchlistSelector = ({ watchlists, active, onSelect, onCreate }) => {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">{active || 'Select Watchlist'}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {watchlists.map(wl => (
                    <DropdownMenuItem key={wl.name} onSelect={() => onSelect?.(wl.name)}>
                        {wl.name}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onSelect={(event) => {
                        event.preventDefault();
                        if (onCreate) {
                            onCreate();
                        }
                    }}
                >
                    <PlusCircle className="mr-2 h-4 w-4" /> New watchlist
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export default Watchlist;

