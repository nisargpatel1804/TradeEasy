import { useEffect, useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { TrendingUp, TrendingDown, Wallet, Briefcase, ArrowUpDown } from "lucide-react";
import { cn } from "../utils/cn.js";
import { mergePriceMapWithVariants, pickLivePriceForSymbol, seedPriceMapFromHoldings } from "../utils/symbolUtils.js";
import { Button } from "../assets/ui/button.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import TradeForm from "./TradeForm.jsx";

const PortfolioPage = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const [portfolioData, setPortfolioData] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("symbol"); // symbol, pnl, value, quantity
  const [sortOrder, setSortOrder] = useState("asc"); // asc, desc
  const [exitLoadingSymbol, setExitLoadingSymbol] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [tradeModalAction, setTradeModalAction] = useState("SELL");
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);

  const loadPortfolio = useCallback(async ({ showLoader = false } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }
      setError(null);
      const data = await api.fetchPortfolio();
      if (data.success) {
        setPortfolioData(data);
        const initialPrices = seedPriceMapFromHoldings([
          ...(data.cnc_holdings || []),
          ...(data.mis_holdings || []),
        ]);
        setLivePrices(initialPrices);
      } else {
        throw new Error(data.message || "Failed to fetch portfolio.");
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadPortfolio({ showLoader: true });
  }, [loadPortfolio]);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        if (update?.type === 'reset') {
          return {};
        }

        if (update?.type === 'snapshot' && update?.allPrices) {
          return mergePriceMapWithVariants(currentPrices, update.allPrices);
        }

        if (update?.changedPrices && Object.keys(update.changedPrices).length > 0) {
          return mergePriceMapWithVariants(currentPrices, update.changedPrices);
        }

        return currentPrices;
      });
    });
    return () => unsubscribe();
  }, []);

  const openTradeModal = (holding, action = "SELL") => {
    setSelectedHolding(holding);
    setTradeModalAction(action);
    setIsTradeModalOpen(true);
  };

  const closeTradeModal = () => {
    setIsTradeModalOpen(false);
    setSelectedHolding(null);
  };

  const handleExitPosition = async (holding, event) => {
    event?.stopPropagation();
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
      const livePriceData = pickLivePriceForSymbol(livePrices, holding.symbol, holding.exchange);
      const livePrice = livePriceData?.ltp ?? holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      const unrealized_pnl_pct = (unrealized_pnl / holding.investment_value) * 100;
      
      // For 1-day return, we need the previous close price
      // For now, we'll calculate it as the change from average price
      // In a real scenario, you'd fetch yesterday's close
      const oneDayReturn = market_value - holding.investment_value; // Simplified
      const oneDayReturnPct = unrealized_pnl_pct; // Simplified
      
      return { 
        ...holding, 
        ltp: livePrice, 
        market_value, 
        unrealized_pnl,
        unrealized_pnl_pct,
        oneDayReturn,
        oneDayReturnPct
      };
    });

    // Calculate totals
    const current_value = holdingsWithLiveData.reduce((sum, h) => sum + h.market_value, 0);
    const invested_value = holdingsWithLiveData.reduce((sum, h) => sum + h.investment_value, 0);
    const total_returns = current_value - invested_value;
    const total_returns_pct = invested_value > 0 ? (total_returns / invested_value) * 100 : 0;
    const oneDayReturn = holdingsWithLiveData.reduce((sum, h) => sum + h.oneDayReturn, 0);
    const oneDayReturnPct = invested_value > 0 ? (oneDayReturn / invested_value) * 100 : 0;

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
      summary: {
        current_value,
        invested_value,
        total_returns,
        total_returns_pct,
        oneDayReturn,
        oneDayReturnPct
      }
    };
  }, [portfolioData, livePrices, sortBy, sortOrder]);
  
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
    "space-y-6",
    isEmbedded ? "" : "mx-auto max-w-6xl px-2 pb-10 pt-4 sm:px-4 lg:px-8"
  );

  if (isLoading) {
    return (
      <div className={pageShellClasses}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, idx) => (
            <Skeleton key={idx} className="h-28 rounded-3xl" />
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

  const { holdings, summary } = processedHoldings;

  return (
    <>
      <motion.div 
        className={pageShellClasses}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {!isEmbedded && <h1 className="text-3xl font-bold text-slate-900">Portfolio</h1>}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Value</CardTitle>
            <Wallet className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(summary.current_value)}</div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invested Value</CardTitle>
            <Briefcase className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.invested_value)}</div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Returns</CardTitle>
            {summary.total_returns >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(summary.total_returns)}`}>
              {formatCurrency(summary.total_returns)}
            </div>
            <p className={`text-sm ${getPnlColor(summary.total_returns)}`}>
              {summary.total_returns >= 0 ? '+' : ''}{summary.total_returns_pct.toFixed(2)}%
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">1 Day Return</CardTitle>
            {summary.oneDayReturn >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(summary.oneDayReturn)}`}>
              {formatCurrency(summary.oneDayReturn)}
            </div>
            <p className={`text-sm ${getPnlColor(summary.oneDayReturn)}`}>
              {summary.oneDayReturn >= 0 ? '+' : ''}{summary.oneDayReturnPct.toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Holdings Table */}
      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Holdings ({holdings.length})</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Sort by:</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="symbol">Symbol</SelectItem>
                  <SelectItem value="pnl">P&L</SelectItem>
                  <SelectItem value="value">Value</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                </SelectContent>
              </Select>
              <button
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                className="rounded-full border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              >
                <ArrowUpDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {holdings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer" onClick={() => handleSortChange("symbol")}>
                    Symbol {sortBy === "symbol" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => handleSortChange("quantity")}>
                    Qty {sortBy === "quantity" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right">Avg. Price</TableHead>
                  <TableHead className="text-right">LTP</TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => handleSortChange("value")}>
                    Market Value {sortBy === "value" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right cursor-pointer" onClick={() => handleSortChange("pnl")}>
                    P&L {sortBy === "pnl" && (sortOrder === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding, idx) => (
                  <TableRow 
                    key={`${holding.symbol}-${holding.product_type}-${idx}`}
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => handleHoldingClick(holding.symbol)}
                  >
                    <TableCell className="font-medium">{holding.symbol}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded ${holding.product_type === 'MIS' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>
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
                          onClick={() => openTradeModal(holding, 'SELL')}
                        >
                          Modify
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          isLoading={exitLoadingSymbol === holding.symbol}
                          onClick={(e) => handleExitPosition(holding, e)}
                        >
                          Exit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
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
          ) : (
            <div className="text-center py-12 text-gray-500">No holdings found.</div>
          )}
        </CardContent>
      </Card>
      </motion.div>

      <Dialog
      open={isTradeModalOpen && Boolean(selectedHolding)}
      onOpenChange={(open) => {
        setIsTradeModalOpen(open);
        if (!open) {
          setSelectedHolding(null);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {tradeModalAction === 'SELL' ? 'Modify Exit Plan' : 'Update Order'} - {selectedHolding?.symbol}
          </DialogTitle>
          <DialogDescription>
            Adjust targets, stop loss, or position sizing for {selectedHolding?.symbol} without leaving the portfolio view.
          </DialogDescription>
        </DialogHeader>
        {selectedHolding && (
          <TradeForm
            symbol={selectedHolding.symbol}
            action={tradeModalAction}
            onTradeSuccess={() => {
              closeTradeModal();
              loadPortfolio();
            }}
            onClose={closeTradeModal}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};

export default PortfolioPage;
