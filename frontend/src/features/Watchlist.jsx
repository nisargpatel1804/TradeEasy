import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";

import { useDataContext } from "../context/DataContext.jsx";
import { useSocket } from "../context/SocketContext.jsx";

import { Button } from "../assets/ui/button.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../assets/ui/dropdown-menu.jsx";
import { PlusCircle, Trash2, Loader2, AlertTriangle, ArrowUpDown, ChevronUp, ChevronDown, ArrowLeft } from "lucide-react";

import TradeForm from "./TradeForm.jsx";
import { Card, CardContent } from "../assets/ui/card.jsx";
import StockSearch from "./StockSearch.jsx";

const Watchlist = () => {
    const navigate = useNavigate();
    const {
        watchlistsData,
        isLoadingWatchlists,
        livePrices,
        createWatchlist,
        addStockToWatchlist,
        removeStockFromWatchlist,
    } = useDataContext();
    const { connectionStatus } = useSocket();

    const [activeWatchlistName, setActiveWatchlistName] = useState("");
    const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' });
    const [showTradeModal, setShowTradeModal] = useState(false);
    const [isTradeSubmitting, setIsTradeSubmitting] = useState(false);
    const [tradeCloseRequested, setTradeCloseRequested] = useState(false);
    const [selectedStock, setSelectedStock] = useState(null);
    const [tradeAction, setTradeAction] = useState('BUY');
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [newWatchlistName, setNewWatchlistName] = useState("");
    const [isSavingWatchlist, setIsSavingWatchlist] = useState(false);

    const watchlists = watchlistsData?.watchlists ?? [];

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

    const stocks = activeWatchlist?.stocks || [];

    useEffect(() => {
        if (!Array.isArray(watchlists) || watchlists.length === 0) {
            setActiveWatchlistName("");
            return;
        }

        const activeExists = watchlists.some(w => w.name === activeWatchlistName);
        if (!activeExists) {
            const nextActive = pickActiveWatchlist(watchlists, activeWatchlistName);
            setActiveWatchlistName(nextActive?.name || "");
        }
    }, [activeWatchlistName, pickActiveWatchlist, watchlists]);

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

    const isLoading = isLoadingWatchlists && !watchlistsData;

    // --- Handlers ---
    const handleTradeClick = (stock, action) => {
        setSelectedStock(stock);
        setTradeAction(action);
        setShowTradeModal(true);
    };
    
    const handleRemoveStock = async (watchlistName, symbol) => {
        const toastId = toast.loading(`Removing ${symbol}...`);
        try {
            await removeStockFromWatchlist(watchlistName, symbol);
            toast.success(`${symbol} removed.`, { id: toastId });
        } catch (error) {
            toast.error(error.message || "Failed to remove stock.", { id: toastId });
            return;
        }
    };
    
    const handleSelectWatchlist = (name) => {
        setActiveWatchlistName(name);
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
        try {
            const exchange = (stock.exchange || (stock.symbol?.includes('.') ? stock.symbol.split('.').pop() : '') || '').toUpperCase();
            await addStockToWatchlist(targetWatchlist.name, {
                symbol: stock.symbol,
                name: stock.name,
                scripcode: stock.scripcode,
                exchange,
            });
            toast.success(`${stock.symbol} added to ${targetWatchlist.name}`, { id: toastId });
        } catch (error) {
            const friendlyMessage = error?.status === 409
                ? `'${stock.symbol}' is already in ${targetWatchlist.name}.`
                : (error?.message || `Failed to add ${stock.symbol}`);
            toast.error(friendlyMessage, { id: toastId });
            return false;
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
            const response = await createWatchlist(trimmedName);
            const createdWatchlist = response?.watchlist;
            toast.success(`'${trimmedName}' created.`, { id: toastId });
            setNewWatchlistName("");
            setIsCreateDialogOpen(false);
            setActiveWatchlistName(createdWatchlist?.name || trimmedName);
        } catch (error) {
            toast.error(error.message || "Failed to create watchlist.", { id: toastId });
        } finally {
            setIsSavingWatchlist(false);
        }
    };

    return (
        <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => navigate(-1)}
                        className="mt-0.5 h-9 w-9 rounded-full"
                        aria-label="Go back"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <div>
                        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Watchlist</h1>
                        <p className="text-sm text-slate-500">Your curated list of stocks to track.</p>
                    </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <StockSearch
                        activeWatchlist={activeWatchlist}
                        onAddStock={handleAddStock}
                        onResultClick={handleAddStock}
                        placeholder="Search to add stocks..."
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
                <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
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
            
            <Card className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
                <CardContent className="p-0">
                    <div className="hidden md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead
                                        aria-sort={getAriaSortValue('name')}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => handleSort('name')}
                                            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900 focus:outline-none"
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
                                            className="flex w-full items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900 focus:outline-none"
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
                                            className="flex w-full items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-900 focus:outline-none"
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
                                        <TableCell colSpan={5} className="py-12 text-center text-gray-500">
                                            Your watchlist is empty. Add stocks using the search bar.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="space-y-3 p-4 md:hidden">
                        {isLoading ? (
                            [...Array(4)].map((_, index) => <CompactStockCardSkeleton key={index} />)
                        ) : stocksWithLiveData.length > 0 ? (
                            stocksWithLiveData.map((stock) => (
                                <CompactStockCard
                                    key={stock.symbol}
                                    stock={stock}
                                    onTrade={handleTradeClick}
                                    onRemove={() => handleRemoveStock(activeWatchlistName, stock.symbol)}
                                />
                            ))
                        ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                                Your watchlist is empty. Add stocks using the search bar.
                            </div>
                        )}
                    </div>
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

            <Dialog
                open={showTradeModal}
                onOpenChange={(open) => {
                    if (open) {
                        setShowTradeModal(true);
                        return;
                    }
                    if (isTradeSubmitting) {
                        setTradeCloseRequested(true);
                        return;
                    }
                    setShowTradeModal(false);
                    setIsTradeSubmitting(false);
                    setTradeCloseRequested(false);
                }}
            >
                <DialogContent
                    className="w-[95vw] max-w-xl border-none bg-transparent p-0 shadow-none sm:w-full max-h-[90vh] overflow-y-auto"
                    aria-describedby={undefined}
                >
                    <div className="p-3 sm:p-4">
                        <DialogHeader className="sr-only">
                            <DialogTitle>{tradeAction === 'BUY' ? 'Buy' : 'Sell'} {selectedStock?.symbol}</DialogTitle>
                            <DialogDescription id="trade-dialog-description">
                                {tradeAction === 'BUY' ? 'Place a buy order for' : 'Place a sell order for'} {selectedStock?.name || selectedStock?.symbol}
                            </DialogDescription>
                        </DialogHeader>
                        <TradeForm
                            symbol={selectedStock?.symbol}
                            action={tradeAction}
                            onTradeSuccess={() => {
                                setShowTradeModal(false);
                            }}
                            onClose={() => setShowTradeModal(false)}
                            onLoadingChange={setIsTradeSubmitting}
                            closeRequested={tradeCloseRequested}
                            onCloseRequestHandled={() => setTradeCloseRequested(false)}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// --- Sub-components ---

const sanitizeSymbol = (symbol) => {
    if (typeof symbol !== "string") {
        return "";
    }
    return symbol.includes(".") ? symbol.split(".")[0] : symbol;
};

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
    const cleanSymbol = sanitizeSymbol(stock.symbol);

    return (
        <TableRow 
            className="cursor-pointer hover:bg-slate-50"
            onClick={() => navigate(`/stock/${cleanSymbol || stock.symbol}`)}
        >
            <TableCell>
                <div className="font-medium text-slate-900">{stock.symbol}</div>
                <div className="text-sm text-slate-500 truncate max-w-xs">{stock.name}</div>
            </TableCell>
            <TableCell className="text-right">
                <div className="font-semibold">₹{ltp.toFixed(2)}</div>
                {isFallbackPrice && (
                    <div className="text-xs text-slate-400">Prev Close</div>
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
                    <Button
                        type="button"
                        size="icon"
                        className="h-8 w-8 rounded-lg bg-emerald-600 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700"
                        onClick={() => onTrade(stock, 'BUY')}
                        aria-label={`Buy ${cleanSymbol || stock.symbol}`}
                        title="Buy"
                    >
                        B
                    </Button>
                    <Button
                        type="button"
                        size="icon"
                        className="h-8 w-8 rounded-lg bg-red-600 text-[12px] font-bold text-white shadow-sm hover:bg-red-700"
                        onClick={() => onTrade(stock, 'SELL')}
                        aria-label={`Sell ${cleanSymbol || stock.symbol}`}
                        title="Sell"
                    >
                        S
                    </Button>
                    <Button size="icon" variant="ghost" className="hover:bg-red-50" onClick={onRemove} title="Remove from watchlist">
                        <Trash2 className="h-4 w-4 text-red-500 hover:text-red-700"/>
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
};

const CompactStockCard = ({ stock, onTrade, onRemove }) => {
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
    const cleanSymbol = sanitizeSymbol(stock.symbol) || stock.symbol;

    return (
        <div
            className="cursor-pointer rounded-3xl border border-slate-100 bg-white p-4 shadow-sm"
            onClick={() => navigate(`/stock/${cleanSymbol}`)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-lg font-semibold text-slate-900">{cleanSymbol}</p>
                    <p className="text-sm text-slate-500 truncate">{stock.name || "--"}</p>
                </div>
                <div className="text-right">
                    <p className="text-base font-semibold text-slate-900">₹{ltp.toFixed(2)}</p>
                    <p className={`text-sm font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? '+' : ''}{change.toFixed(2)} ({percentChange.toFixed(2)}%)
                    </p>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade?.(stock, 'BUY');
                    }}
                >
                    Buy
                </Button>
                <Button
                    size="sm"
                    className="bg-red-600 text-white hover:bg-red-700"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade?.(stock, 'SELL');
                    }}
                >
                    Sell
                </Button>
                <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto text-red-500 hover:text-red-600"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove?.();
                    }}
                >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Remove {cleanSymbol}</span>
                </Button>
            </div>
        </div>
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

const CompactStockCardSkeleton = () => (
    <div className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
            <div className="w-1/2 space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-32" />
            </div>
            <div className="w-20 space-y-2 text-right">
                <Skeleton className="ml-auto h-5 w-16" />
                <Skeleton className="ml-auto h-4 w-12" />
            </div>
        </div>
        <div className="mt-4 flex gap-3">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-10" />
        </div>
    </div>
);

const WatchlistSelector = ({ watchlists, active, onSelect, onCreate }) => {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="rounded-2xl">{active || 'Select Watchlist'}</Button>
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

