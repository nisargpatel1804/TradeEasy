import { useEffect, useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import priceUpdateService from "../services/priceUpdateService.js";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { TrendingUp, TrendingDown, Wallet, Briefcase, ArrowUpDown, ArrowLeft } from "lucide-react";
import { cn } from "../utils/cn.js";
import { mergePriceMapWithVariants, pickLivePriceForSymbol, seedPriceMapFromHoldings } from "../utils/symbolUtils.js";
import { Button } from "../assets/ui/button.jsx";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import ModifyExitPlanForm from "./ModifyExitPlanForm.jsx";
import usePortfolioSummary from "../hooks/usePortfolioSummary.js";

const PortfolioPage = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const [portfolioData, setPortfolioData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [sortBy, setSortBy] = useState("symbol"); // symbol, pnl, value, quantity
  const [sortOrder, setSortOrder] = useState("asc"); // asc, desc
  const [exitLoadingSymbol, setExitLoadingSymbol] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [isModifyDialogOpen, setIsModifyDialogOpen] = useState(false);
  const [exitCandidate, setExitCandidate] = useState(null);
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  const { getPortfolio, livePrices: sharedLivePrices } = useDataContext();

  const isMarketOpen = !!marketStatus?.is_market_open && !marketStatus?.is_holiday;

  const loadPortfolio = useCallback(async ({ showLoader = false, force = false } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);
      const result = await getPortfolio(force);
      const data = result?.data;
      if (data?.success) {
        setPortfolioData(data);
        const initialPrices = seedPriceMapFromHoldings([
          ...(data.cnc_holdings || []),
          ...(data.mis_holdings || []),
        ]);
        priceUpdateService.seedPrices(initialPrices);
      } else {
        throw new Error(data?.message || "Failed to fetch portfolio.");
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getPortfolio]);

  useEffect(() => {
    loadPortfolio({ showLoader: true, force: false });
  }, [loadPortfolio]);

  useEffect(() => {
    const onPortfolioReset = () => {
      loadPortfolio({ showLoader: !portfolioData, force: true });
    };

    window.addEventListener('te:portfolio-reset', onPortfolioReset);
    return () => window.removeEventListener('te:portfolio-reset', onPortfolioReset);
  }, [loadPortfolio, portfolioData]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await api.getMarketStatus();
        setMarketStatus(status);
      } catch {
      }
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 60000);
    return () => clearInterval(id);
  }, []);

  const basePriceMap = useMemo(() => {
    return seedPriceMapFromHoldings([
      ...(portfolioData?.cnc_holdings || []),
      ...(portfolioData?.mis_holdings || []),
    ]);
  }, [portfolioData]);

  const effectiveLivePrices = useMemo(() => {
    return mergePriceMapWithVariants(basePriceMap, sharedLivePrices || {});
  }, [basePriceMap, sharedLivePrices]);

  const openModifyDialog = (holding) => {
    setSelectedHolding(holding);
    setIsModifyDialogOpen(true);
  };

  const closeModifyDialog = () => {
    setIsModifyDialogOpen(false);
    setSelectedHolding(null);
  };

  const executeExitPosition = async (holding) => {
    if (!holding?.symbol || holding.quantity <= 0) {
      return;
    }

    const toastId = toast.loading(`Exiting ${holding.symbol}...`);
    setExitLoadingSymbol(holding.symbol);
    try {
      const payload = {
        symbol: holding.symbol,
        quantity: holding.quantity,
        action: 'SELL',
        product_type: holding.product_type || 'CNC',
        order_type: 'MARKET',
        allow_short: false,
      };

      const result = await api.placeTrade(payload);
      if (result.success) {
        toast.success(result.message || `Exit order placed for ${holding.symbol}.`, { id: toastId });
        const orderId = result.order_id || result.orderId || result.id;
        window.dispatchEvent(new CustomEvent('te:trade-success', {
          detail: {
            orderId,
            optimisticOrder: {
              id: orderId || `${holding.symbol}-${Date.now()}`,
              symbol: holding.symbol,
              transaction_type: 'SELL',
              quantity: holding.quantity,
              price: Number(holding.ltp) || 0,
              status: 'EXECUTED',
              date: new Date().toISOString(),
            },
          },
        }));
        await loadPortfolio();
      } else {
        throw new Error(result.message || 'Failed to exit position.');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to exit position.', { id: toastId });
    } finally {
      setExitLoadingSymbol(null);
    }
  };

  const requestExitPosition = (holding, event) => {
    event?.stopPropagation();
    if (!holding?.symbol || holding.quantity <= 0) {
      return;
    }
    setExitCandidate(holding);
    setIsExitDialogOpen(true);
  };

  const handleDetailsClick = (holding, event) => {
    event?.stopPropagation();
    if (!holding?.symbol) {
      return;
    }
    navigate(`/stock/${holding.symbol}`);
  };

  const processedHoldings = useMemo(() => {
    if (!portfolioData) return null;

    // Combine all holdings
    const allHoldings = [
      ...(portfolioData.cnc_holdings || []).map(h => ({ ...h, product_type: 'CNC' })),
      ...(portfolioData.mis_holdings || []).map(h => ({ ...h, product_type: 'MIS' }))
    ];

    // Update with live prices and calculate metrics
    const holdingsWithLiveData = allHoldings.map(holding => {
      const livePriceData = pickLivePriceForSymbol(effectiveLivePrices, holding.symbol, holding.exchange);
      const livePrice = livePriceData?.ltp ?? holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      const unrealized_pnl_pct = (unrealized_pnl / holding.investment_value) * 100;
      
      return { 
        ...holding, 
        ltp: livePrice, 
        market_value, 
        unrealized_pnl,
        unrealized_pnl_pct
      };
    });

    // Sort holdings
    let sortedHoldings = [...holdingsWithLiveData];
    switch (sortBy) {
      case "pnl":
        sortedHoldings.sort((a, b) => sortOrder === "asc" 
          ? a.unrealized_pnl - b.unrealized_pnl 
          : b.unrealized_pnl - a.unrealized_pnl);
        break;
      case "value":
        sortedHoldings.sort((a, b) => sortOrder === "asc" 
          ? a.market_value - b.market_value 
          : b.market_value - a.market_value);
        break;
      case "quantity":
        sortedHoldings.sort((a, b) => sortOrder === "asc" 
          ? a.quantity - b.quantity 
          : b.quantity - a.quantity);
        break;
      case "symbol":
      default:
        sortedHoldings.sort((a, b) => sortOrder === "asc" 
          ? a.symbol.localeCompare(b.symbol) 
          : b.symbol.localeCompare(a.symbol));
        break;
    }

    return {
      holdings: sortedHoldings,
    };
  }, [effectiveLivePrices, portfolioData, sortBy, sortOrder]);

  const canonicalSummary = usePortfolioSummary({
    baseSummary: portfolioData?.summary,
    holdings: [
      ...(portfolioData?.cnc_holdings || []),
      ...(portfolioData?.mis_holdings || []),
    ],
    shortPositions: portfolioData?.short_positions || [],
    livePriceMap: effectiveLivePrices,
    marketStatus,
  });
  
  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPnlColor = (value) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-700 dark:text-gray-300';
  };

  const handleHoldingClick = (symbol) => {
    // Navigate to stock detail or order history page
    navigate(`/stock/${symbol}`);
  };

  const handleSortChange = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const pageShellClasses = cn(
    "mx-auto max-w-7xl space-y-3 pb-4 pt-2",
    isEmbedded ? "" : "px-2 sm:px-3 lg:px-4"
  );

  if (isLoading) {
    return (
      <div className={pageShellClasses}>
        {!isEmbedded && (
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, idx) => (
            <Skeleton key={idx} className="h-24 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return <div className={pageShellClasses}><div className="rounded-3xl border border-red-200 bg-red-50/50 p-10 text-center text-red-600">{error}</div></div>;
  }
  
  if (!processedHoldings) {
    return <div className={pageShellClasses}><div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-slate-500">No holdings data available.</div></div>;
  }

  const { holdings } = processedHoldings;
  const summary = {
    current_value: Number(canonicalSummary?.currentValue) || 0,
    invested_value: Number(canonicalSummary?.investedAmount) || 0,
    total_returns: Number(canonicalSummary?.totalPnl) || 0,
    total_returns_pct: Number(canonicalSummary?.totalPnlPct) || 0,
    oneDayReturn: Number(canonicalSummary?.todaysPnl) || 0,
    oneDayReturnPct: Number(canonicalSummary?.todaysPnlPct) || 0,
  };

  return (
    <>
      <motion.div 
        className={pageShellClasses}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {!isEmbedded && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-full border-slate-200"
                onClick={() => navigate(-1)}
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Portfolio</h1>
                <p className="text-xs font-medium text-slate-500">
                  Track holdings, value, and returns in one view.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isRefreshing && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                  Refreshing
                </span>
              )}
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
                  isMarketOpen
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-600"
                )}
              >
                {isMarketOpen ? "Market Open" : (marketStatus?.is_holiday ? "Market Holiday" : "Market Closed")}
              </span>
            </div>
          </div>
        )}

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current Value</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900/5 text-slate-900">
              <Wallet className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xl font-bold text-slate-900">{formatCurrency(summary.current_value)}</div>
            <p className="mt-1 text-xs text-slate-500">Market value</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invested Value</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900/5 text-slate-900">
              <Briefcase className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xl font-bold text-slate-900">{formatCurrency(summary.invested_value)}</div>
            <p className="mt-1 text-xs text-slate-500">Cost basis</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Returns</CardTitle>
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-2xl",
              summary.total_returns >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
            )}>
              {summary.total_returns >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("text-xl font-bold", getPnlColor(summary.total_returns))}>
              {formatCurrency(summary.total_returns)}
            </div>
            <p className={cn("mt-1 text-xs font-semibold", getPnlColor(summary.total_returns))}>
              {summary.total_returns >= 0 ? '+' : ''}{summary.total_returns_pct.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">1 Day Return</CardTitle>
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-2xl",
              summary.oneDayReturn >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
            )}>
              {summary.oneDayReturn >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("text-xl font-bold", getPnlColor(summary.oneDayReturn))}>
              {formatCurrency(summary.oneDayReturn)}
            </div>
            <p className={cn("mt-1 text-xs font-semibold", getPnlColor(summary.oneDayReturn))}>
              {summary.oneDayReturn >= 0 ? '+' : ''}{summary.oneDayReturnPct.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Holdings Table */}
      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold text-slate-900">Holdings</CardTitle>
              <p className="text-xs font-medium text-slate-500">All positions across CNC and MIS ({holdings.length})</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sort</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="h-9 w-[140px] rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="symbol">Symbol</SelectItem>
                  <SelectItem value="pnl">P&L</SelectItem>
                  <SelectItem value="value">Value</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full"
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                aria-label="Toggle sort order"
              >
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {holdings.length > 0 ? (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-500" onClick={() => handleSortChange("symbol")}>
                    Symbol {sortBy === "symbol" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</TableHead>
                  <TableHead className="cursor-pointer text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500" onClick={() => handleSortChange("quantity")}>
                    Qty {sortBy === "quantity" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Avg</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">LTP</TableHead>
                  <TableHead className="cursor-pointer text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500" onClick={() => handleSortChange("value")}>
                    Value {sortBy === "value" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500" onClick={() => handleSortChange("pnl")}>
                    P&L {sortBy === "pnl" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding, idx) => (
                  <TableRow 
                    key={`${holding.symbol}-${holding.product_type}-${idx}`}
                    className="group cursor-pointer hover:bg-slate-50"
                    onClick={() => handleHoldingClick(holding.symbol)}
                  >
                    <TableCell className="font-medium">{holding.symbol}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          holding.product_type === 'MIS'
                            ? "bg-amber-500/15 text-amber-800"
                            : "bg-slate-900/5 text-slate-700"
                        )}
                      >
                        {holding.product_type}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{holding.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.average_price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.ltp)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.market_value)}</TableCell>
                    <TableCell className={`text-right font-medium ${getPnlColor(holding.unrealized_pnl)}`}>
                      {formatCurrency(holding.unrealized_pnl)}
                      <div className="text-xs">
                        ({holding.unrealized_pnl >= 0 ? '+' : ''}{holding.unrealized_pnl_pct.toFixed(2)}%)
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-full"
                          onClick={() => openModifyDialog(holding)}
                          title="Set / update stoploss & target"
                        >
                          Modify
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="rounded-full"
                          isLoading={exitLoadingSymbol === holding.symbol}
                          onClick={(e) => requestExitPosition(holding, e)}
                        >
                          Exit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full"
                          onClick={(e) => handleDetailsClick(holding, e)}
                        >
                          Details
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            <div className="md:hidden space-y-2">
              {holdings.map((holding, idx) => (
                <div
                  key={`${holding.symbol}-${holding.product_type}-${idx}-mobile`}
                  className="w-full cursor-pointer rounded-3xl border border-slate-100 bg-white p-4 text-left shadow-sm"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleHoldingClick(holding.symbol)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleHoldingClick(holding.symbol);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{holding.symbol}</p>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            holding.product_type === 'MIS'
                              ? "bg-amber-500/15 text-amber-800"
                              : "bg-slate-900/5 text-slate-700"
                          )}
                        >
                          {holding.product_type}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        Qty {holding.quantity} · Avg {formatCurrency(holding.average_price)} · LTP {formatCurrency(holding.ltp)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{formatCurrency(holding.market_value)}</p>
                      <p className={cn("text-xs font-semibold", getPnlColor(holding.unrealized_pnl))}>
                        {formatCurrency(holding.unrealized_pnl)} ({holding.unrealized_pnl >= 0 ? '+' : ''}{holding.unrealized_pnl_pct.toFixed(2)}%)
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => openModifyDialog(holding)}
                      title="Set / update stoploss & target"
                    >
                      Modify
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="rounded-full"
                      isLoading={exitLoadingSymbol === holding.symbol}
                      onClick={(e) => requestExitPosition(holding, e)}
                    >
                      Exit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={(e) => handleDetailsClick(holding, e)}
                    >
                      Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center text-sm font-medium text-slate-600">
              No holdings found.
            </div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      <Dialog
      open={isModifyDialogOpen && Boolean(selectedHolding)}
      onOpenChange={(open) => {
        setIsModifyDialogOpen(open);
        if (!open) {
          setSelectedHolding(null);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Modify Stoploss & Target - {selectedHolding?.symbol}
          </DialogTitle>
          <DialogDescription>
            Update only the stoploss and target for the existing exit plan.
          </DialogDescription>
        </DialogHeader>
        {selectedHolding && (
          <ModifyExitPlanForm
            holding={selectedHolding}
            onClose={closeModifyDialog}
            onSuccess={() => loadPortfolio()}
          />
        )}
      </DialogContent>
    </Dialog>

    <Dialog
      open={isExitDialogOpen && Boolean(exitCandidate)}
      onOpenChange={(open) => {
        setIsExitDialogOpen(open);
        if (!open) {
          setExitCandidate(null);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Exit</DialogTitle>
          <DialogDescription>
            Place a market sell order to exit {exitCandidate?.symbol} for {exitCandidate?.quantity} qty?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsExitDialogOpen(false);
              setExitCandidate(null);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            isLoading={exitLoadingSymbol === exitCandidate?.symbol}
            onClick={async () => {
              if (!exitCandidate) {
                return;
              }
              await executeExitPosition(exitCandidate);
              setIsExitDialogOpen(false);
              setExitCandidate(null);
            }}
          >
            Confirm Exit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default PortfolioPage;
