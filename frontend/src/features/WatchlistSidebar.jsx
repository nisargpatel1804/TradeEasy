import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, ChevronDown, Trash2, PlusCircle, ArrowUpDown, Expand, Edit2, Check, TrendingUp, TrendingDown } from "lucide-react";
import { useDataContext } from "../context/DataContext.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Input } from "../assets/ui/input.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../assets/ui/dropdown-menu.jsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { useToast } from "../assets/ui/use-toast.js";
import TradeForm from "./TradeForm.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import StockSearch from "./StockSearch.jsx";

const SORT_OPTIONS = [
  { value: "custom", label: "Latest Added" },
  { value: "alphabetical", label: "Alphabetical" },
  { value: "gain", label: "% Gain Today" },
  { value: "loss", label: "% Loss Today" },
];

const WatchlistSidebar = ({ onClose, isMobile = false }) => {
  const {
    watchlistsData,
    isLoadingWatchlists,
    livePrices,
    createWatchlist,
    renameWatchlist,
    deleteWatchlist,
    addStockToWatchlist,
    removeStockFromWatchlist,
  } = useDataContext();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [activeWatchlistName, setActiveWatchlistName] = useState("");
  const [isTradeSubmitting, setIsTradeSubmitting] = useState(false);
  const [tradeCloseRequested, setTradeCloseRequested] = useState(false);
  const [isMutatingWatchlist, setIsMutatingWatchlist] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [tradeContext, setTradeContext] = useState(null);
  const [sortMode, setSortMode] = useState("custom");
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameTarget, setRenameTarget] = useState(null);

  const watchlists = watchlistsData?.watchlists ?? [];
  const isWatchlistView = location.pathname.startsWith("/watchlist");

  // Ensure there is always a valid active watchlist
  useEffect(() => {
    if (!Array.isArray(watchlists) || watchlists.length === 0) {
      setActiveWatchlistName("");
      return;
    }

    const activeExists = watchlists.some((wl) => wl.name === activeWatchlistName);
    if (activeWatchlistName && activeExists) {
      return;
    }

    const defaultWatchlist = watchlists.find((wl) => !wl.is_deletable) || watchlists[0];
    setActiveWatchlistName(defaultWatchlist?.name || "");
  }, [watchlists, activeWatchlistName]);

  useEffect(() => {
    setSortMode("custom");
  }, [activeWatchlistName]);

  useEffect(() => {
    if (!isRenameDialogOpen) {
      setRenameTarget(null);
      setRenameValue("");
    }
  }, [isRenameDialogOpen]);

  const activeWatchlist = useMemo(
    () => watchlists.find((wl) => wl.name === activeWatchlistName) || null,
    [watchlists, activeWatchlistName]
  );

  const stocks = activeWatchlist?.stocks ?? [];

  // enrichedMap: symbol → merged stock+livePrice object.  Updates on every price tick
  // but does NOT re-sort — the sort step is separated below.
  const enrichedMap = useMemo(() => {
    const map = {};
    if (!Array.isArray(stocks)) return map;
    stocks.forEach((stock) => {
      if (!stock?.symbol) return;
      const live = livePrices[stock.symbol];
      const merged = live ? { ...stock, ...live } : { ...stock };
      const previousClose = Number(merged.previous_close ?? merged.price);
      if ((!merged.ltp || Number(merged.ltp) <= 0) && Number.isFinite(previousClose) && previousClose > 0) {
        merged.ltp = previousClose;
        merged.price_source = merged.price_source || 'previous_close';
      }
      map[stock.symbol] = merged;
    });
    return map;
  }, [stocks, livePrices]);

  // stockOrderMap must be declared before structuralOrder because structuralOrder
  // depends on it for the 'custom' sort.
  const stockOrderMap = useMemo(() => {
    if (!Array.isArray(stocks)) return {};
    return stocks.reduce((acc, item, index) => {
      if (item?.symbol) acc[item.symbol] = index;
      return acc;
    }, {});
  }, [stocks]);

  // structuralOrder: sorted symbol list for custom/alphabetical modes.
  // Does NOT depend on livePrices, so price ticks do NOT trigger a re-sort for
  // these modes.  Returns null to signal that a price-sensitive sort is active.
  const structuralOrder = useMemo(() => {
    if (!Array.isArray(stocks) || stocks.length === 0) return null;
    if (sortMode === 'custom') {
      return [...stocks]
        .sort((a, b) => (stockOrderMap[b.symbol] ?? -1) - (stockOrderMap[a.symbol] ?? -1))
        .map((s) => s.symbol);
    }
    if (sortMode === 'alphabetical') {
      return [...stocks]
        .sort((a, b) => {
          const nameA = (a.name || a.symbol || '').toUpperCase();
          const nameB = (b.name || b.symbol || '').toUpperCase();
          return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
        })
        .map((s) => s.symbol);
    }
    return null; // gain/loss sort needs live price data
  }, [stocks, sortMode, stockOrderMap]);

  // displayedStocks: O(n) map-lookup for structural sorts; O(n log n) sort only for
  // gain/loss modes where price order changes on every tick.
  const displayedStocks = useMemo(() => {
    if (structuralOrder !== null) {
      return structuralOrder.map((sym) => enrichedMap[sym]).filter(Boolean);
    }
    // price-based sort
    const all = stocks.map((s) => enrichedMap[s.symbol]).filter(Boolean);
    if (sortMode === 'gain') {
      return [...all].sort((a, b) => (Number(b.percent_change) || 0) - (Number(a.percent_change) || 0));
    }
    if (sortMode === 'loss') {
      return [...all].sort((a, b) => (Number(a.percent_change) || 0) - (Number(b.percent_change) || 0));
    }
    return all;
  }, [enrichedMap, structuralOrder, sortMode, stocks]);

  const formatPrice = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "--";
    }
    return value.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatPercent = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "--";
    }
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)}`;
  };

  const handleAddStock = async (stock) => {
    if (!activeWatchlist?.name) {
      toast({ title: "Select a watchlist first", variant: "destructive" });
      return false;
    }
    const exists = (activeWatchlist.stocks || []).some((item) => item?.symbol === stock.symbol);
    if (exists) {
      toast({ title: `${stock.symbol} already exists`, description: `${stock.symbol} is already part of ${activeWatchlist.name}.` });
      return false;
    }
    setIsMutatingWatchlist(true);
    try {
      const exchange = (stock.exchange || (stock.symbol?.includes(".") ? stock.symbol.split(".").pop() : "") || "").toUpperCase();
      await addStockToWatchlist(activeWatchlist.name, {
        symbol: stock.symbol,
        name: stock.name,
        scripcode: stock.scripcode,
        exchange,
      });
      toast({ title: `${stock.symbol} added`, description: `Added to ${activeWatchlist.name}.` });
      setActiveWatchlistName(activeWatchlist.name);
      return true;
    } catch (error) {
      if (error?.status === 409) {
        toast({ title: `${stock.symbol} is already in ${activeWatchlist.name}` });
      } else {
        toast({ title: "Unable to add stock", description: error.message || "Please try again.", variant: "destructive" });
      }
      return false;
    } finally {
      setIsMutatingWatchlist(false);
    }
  };

  const handleRemoveStock = async (symbol) => {
    if (!activeWatchlist?.name) {
      return;
    }
    setIsMutatingWatchlist(true);
    try {
      await removeStockFromWatchlist(activeWatchlist.name, symbol);
      toast({ title: `${symbol} removed`, description: `Removed from ${activeWatchlist.name}.` });
    } catch (error) {
      toast({ title: "Unable to remove", description: error.message || "Try again later.", variant: "destructive" });
    } finally {
      setIsMutatingWatchlist(false);
    }
  };

  const handleCreateWatchlist = async (event) => {
    event?.preventDefault();
    const trimmed = newWatchlistName.trim();
    if (!trimmed) {
      toast({ title: "Name required", description: "Enter a watchlist name.", variant: "destructive" });
      return;
    }
    setIsMutatingWatchlist(true);
    try {
      await createWatchlist(trimmed);
      toast({ title: `${trimmed} created` });
      setIsCreateDialogOpen(false);
      setNewWatchlistName("");
      setActiveWatchlistName(trimmed);
    } catch (error) {
      toast({ title: "Unable to create", description: error.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsMutatingWatchlist(false);
    }
  };

  const openRenameDialog = (watchlist) => {
    setRenameTarget(watchlist);
    setRenameValue(watchlist?.name || "");
    setIsRenameDialogOpen(true);
  };

  const handleRenameWatchlist = async (event) => {
    event?.preventDefault();
    const trimmed = renameValue.trim();
    if (!renameTarget?.name || !trimmed) {
      toast({ title: "Name required", description: "Enter a watchlist name.", variant: "destructive" });
      return;
    }
    setIsMutatingWatchlist(true);
    try {
      await renameWatchlist(renameTarget.name, trimmed);
      toast({ title: "Watchlist renamed", description: `${renameTarget.name} is now ${trimmed}.` });
      setIsRenameDialogOpen(false);
      setRenameTarget(null);
      setRenameValue("");
      setActiveWatchlistName(trimmed);
    } catch (error) {
      toast({ title: "Unable to rename", description: error.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsMutatingWatchlist(false);
    }
  };

  const handleDeleteWatchlist = async (name, isDeletable) => {
    if (!isDeletable) {
      toast({ title: "Default watchlist", description: "This watchlist cannot be deleted." });
      return;
    }
    setIsMutatingWatchlist(true);
    try {
      await deleteWatchlist(name);
      toast({ title: `${name} deleted` });
    } catch (error) {
      toast({ title: "Unable to delete", description: error.message || "Try again later.", variant: "destructive" });
    } finally {
      setIsMutatingWatchlist(false);
    }
  };

  const toggleStretchView = () => {
    const target = isWatchlistView ? "/dashboard" : "/watchlist";
    navigate(target);
    onClose?.();
  };

  const handleSortChange = (mode) => {
    setSortMode(mode);
  };

  const openTradeModal = (stock, action) => {
    if (!stock) {
      return;
    }
    setTradeContext({ stock, action });
  };

  const closeTradeModal = () => {
    setTradeContext(null);
    setIsTradeSubmitting(false);
    setTradeCloseRequested(false);
  };

  const handleRowClick = (symbol) => {
    if (!symbol) {
      return;
    }
    const cleanSymbol = symbol.includes(".") ? symbol.split(".")[0] : symbol;
    navigate(`/stock/${cleanSymbol}`);
    onClose?.();
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="space-y-3">
        <StockSearch
          activeWatchlist={activeWatchlist}
          onAddStock={handleAddStock}
          onResultClick={(stock) => handleRowClick(stock?.symbol)}
          placeholder="Search to Trade or Add to Watchlist"
          containerClassName="relative w-full"
          inputClassName="h-9 rounded-2xl border-slate-200 bg-slate-50 pl-10 text-sm"
          dropdownClassName="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-2xl border bg-white shadow-xl"
          showAddButton
        />

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex w-full items-center justify-between rounded-2xl border-slate-200 bg-white px-4 py-2 text-left text-sm font-semibold">
                <span className="truncate">{activeWatchlistName || "Watchlists"}</span>
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-80 rounded-2xl">
              <DropdownMenuLabel className="text-xs font-semibold text-slate-500">SELECT WATCHLIST</DropdownMenuLabel>
              {watchlists.map((watchlist) => {
                const isActive = watchlist.name === activeWatchlistName;
                return (
                  <DropdownMenuItem
                    key={watchlist.name}
                    className="flex items-center justify-between gap-2 px-3"
                    onSelect={(event) => {
                      event.preventDefault();
                      setActiveWatchlistName(watchlist.name);
                      onClose?.();
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`h-4 w-4 rounded-full border ${isActive ? "border-amber-500 bg-amber-500" : "border-slate-300"}`} />
                      <span className="text-sm font-medium">{watchlist.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openRenameDialog(watchlist);
                        }}
                        aria-label={`Rename ${watchlist.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="rounded-full p-1 text-slate-400 hover:bg-slate-100"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleDeleteWatchlist(watchlist.name, watchlist.is_deletable);
                        }}
                        aria-label={`Delete ${watchlist.name}`}
                      >
                        <Trash2 className={`h-4 w-4 ${watchlist.is_deletable ? "text-slate-400" : "text-slate-200"}`} />
                      </button>
                    </div>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setIsCreateDialogOpen(true);
                }}
                className="flex items-center gap-2 text-amber-600"
              >
                <PlusCircle className="h-4 w-4" /> Create New Watchlist
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="icon"
            className="rounded-2xl border-slate-200"
            onClick={toggleStretchView}
            aria-label={isWatchlistView ? "Collapse watchlist" : "Stretch watchlist"}
          >
            <Expand className={`h-4 w-4 ${isWatchlistView ? "rotate-180" : ""}`} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-2xl border-slate-200" aria-label="Sort watchlist stocks">
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48 rounded-2xl">
              <DropdownMenuLabel className="text-xs font-semibold text-slate-500">SORT STOCKS</DropdownMenuLabel>
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleSortChange(option.value);
                  }}
                  className="flex items-center justify-between"
                >
                  <span>{option.label}</span>
                  {sortMode === option.value && <Check className="h-4 w-4 text-amber-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="watchlist-scroll flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {isLoadingWatchlists ? (
          [...Array(4)].map((_, index) => <SidebarRowSkeleton key={index} />)
        ) : displayedStocks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
            No stocks in this watchlist yet. Use the search above to start adding.
          </div>
        ) : (
          displayedStocks.map((stock) => {
            const ltp = Number(stock.ltp ?? stock.price);
            const hasPrice = Number.isFinite(ltp) && ltp > 0;
            const change = hasPrice ? Number(stock.change) : Number.NaN;
            const percent = hasPrice ? Number(stock.percent_change ?? stock.percentChange) : Number.NaN;
            const isPositive = change >= 0;

            return (
              <div
                key={stock.symbol}
                className="group relative cursor-pointer rounded-2xl border border-slate-100 bg-white px-3 py-1.5 shadow-sm transition hover:shadow-md"
                onClick={() => handleRowClick(stock.symbol)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{stock.symbol?.split(".")[0]}</p>
                    <p className="truncate text-[11px] text-slate-500">{stock.name || "--"}</p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {hasPrice ? (
                      <>
                        <p className="text-sm font-semibold text-slate-900">₹{formatPrice(ltp)}</p>
                        <p className={`text-[11px] font-semibold ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{formatPrice(Math.abs(change))}
                          <span className="ml-1">({formatPercent(percent)}%)</span>
                        </p>
                      </>
                    ) : (
                      <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Updating...
                      </p>
                    )}
                  </div>
                </div>

                <div className="pointer-events-none absolute right-24 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                  <button
                    type="button"
                    className="h-8 w-8 rounded-lg bg-emerald-600 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTradeModal(stock, "BUY");
                    }}
                    aria-label={`Buy ${stock.symbol}`}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className="h-8 w-8 rounded-lg bg-red-600 text-[12px] font-bold text-white shadow-sm hover:bg-red-700"
                    onClick={(event) => {
                      event.stopPropagation();
                      openTradeModal(stock, "SELL");
                    }}
                    aria-label={`Sell ${stock.symbol}`}
                  >
                    S
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemoveStock(stock.symbol);
                    }}
                    aria-label={`Remove ${stock.symbol}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleCreateWatchlist} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create New Watchlist</DialogTitle>
              <DialogDescription>Group stocks together for easier tracking.</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="e.g. Sensex"
              value={newWatchlistName}
              onChange={(event) => setNewWatchlistName(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isMutatingWatchlist}>
                {isMutatingWatchlist && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent className="rounded-2xl">
          <form onSubmit={handleRenameWatchlist} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Rename Watchlist</DialogTitle>
              <DialogDescription>Give {renameTarget?.name || "this watchlist"} a new identity.</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="Enter new name"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsRenameDialogOpen(false)} disabled={isMutatingWatchlist}>
                Cancel
              </Button>
              <Button type="submit" disabled={isMutatingWatchlist}>
                {isMutatingWatchlist && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      <Dialog
        open={!!tradeContext}
        onOpenChange={(open) => {
          if (open) {
            return;
          }
          if (isTradeSubmitting) {
            setTradeCloseRequested(true);
            return;
          }
          closeTradeModal();
        }}
      >
        <DialogContent
          className="w-[95vw] max-w-xl border-none bg-transparent p-0 shadow-none sm:w-full max-h-[90vh] overflow-y-auto"
        >
          <div className="p-3 sm:p-4">
            <DialogHeader className="sr-only">
              <DialogTitle>
                {tradeContext?.action === "SELL" ? "Sell" : "Buy"} {tradeContext?.stock?.symbol}
              </DialogTitle>
              <DialogDescription id="trade-dialog-description">
                Place {tradeContext?.action?.toLowerCase()} order for {tradeContext?.stock?.symbol}
              </DialogDescription>
            </DialogHeader>
            <TradeForm
              symbol={tradeContext?.stock?.symbol}
              action={tradeContext?.action}
              onClose={closeTradeModal}
              onTradeSuccess={closeTradeModal}
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

const SidebarRowSkeleton = () => (
  <div className="animate-pulse rounded-2xl border border-slate-100 bg-white px-3 py-2">
    <div className="mb-1 h-3.5 w-1/3 rounded bg-slate-200" />
    <div className="h-3 w-1/2 rounded bg-slate-100" />
  </div>
);

export default WatchlistSidebar;
