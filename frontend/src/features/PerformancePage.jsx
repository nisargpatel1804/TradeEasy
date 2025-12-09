import { useEffect, useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { TrendingUp, TrendingDown, Receipt } from "lucide-react";
import { cn } from "../utils/cn.js";
import { mergePriceMapWithVariants, pickLivePriceForSymbol, seedPriceMapFromHoldings } from "../utils/symbolUtils.js";
import { Button } from "../assets/ui/button.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import TradeForm from "./TradeForm.jsx";

const PerformancePage = ({ isEmbedded = false }) => {
  const [portfolioData, setPortfolioData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [exitLoadingSymbol, setExitLoadingSymbol] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [tradeModalAction, setTradeModalAction] = useState("SELL");
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const navigate = useNavigate();

  const loadData = useCallback(async ({ showLoader = false } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      }
      setError(null);
      
      const portfolioResponse = await api.fetchPortfolio();
      if (portfolioResponse.success) {
        setPortfolioData(portfolioResponse);
        const initialPrices = seedPriceMapFromHoldings([
          ...(portfolioResponse.cnc_holdings || []),
          ...(portfolioResponse.mis_holdings || []),
        ]);
        setLivePrices(initialPrices);
      }
      
      const ordersResponse = await api.fetchOrders();
      if (ordersResponse.success) {
        setOrders(ordersResponse.executed || []);
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
    loadData({ showLoader: true });
    const interval = setInterval(() => loadData(), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Subscribe to live price updates
  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        if (update?.type === 'reset') {
          return {};
        }
        if (update?.type === 'snapshot' && update?.allPrices) {
          return mergePriceMapWithVariants(currentPrices, update.allPrices);
        }
        if (update?.changedPrices) {
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
        await loadData();
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

  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPnlColor = (value) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-700 dark:text-gray-300';
  };

  // Calculate P&L for each trade
  const tradesWithPnL = orders.map(order => {
    // For simplicity, P&L calculation would need buy and sell pairs
    // This is a simplified version - in production, you'd match buy/sell pairs
    const pnl = 0; // Placeholder - needs proper calculation
    return {
      ...order,
      pnl
    };
  });

  // Calculate total stats with live prices
  const totalCharges = 0; // As per requirements, charges are 0 for now
  const realizedPnL = portfolioData?.summary?.realized_pnl || 0;
  
  const holdingsWithLiveData = useMemo(() => {
    if (!portfolioData) {
      return [];
    }

    const baseHoldings = [
      ...(portfolioData.cnc_holdings || []).map((holding) => ({ ...holding, product_type: 'CNC' })),
      ...(portfolioData.mis_holdings || []).map((holding) => ({ ...holding, product_type: 'MIS' })),
    ];

    return baseHoldings.map((holding) => {
      const liveData = pickLivePriceForSymbol(livePrices, holding.symbol, holding.exchange);
      const ltp = liveData?.ltp ?? holding.ltp;
      const marketValue = ltp * holding.quantity;
      const pnl = marketValue - holding.investment_value;
      const pnlPct = holding.investment_value > 0 ? (pnl / holding.investment_value) * 100 : 0;
      return {
        ...holding,
        ltp,
        marketValue,
        pnl,
        pnlPct,
      };
    });
  }, [portfolioData, livePrices]);

  const unrealizedPnL = useMemo(() => {
    if (!holdingsWithLiveData.length) {
      return 0;
    }
    return holdingsWithLiveData.reduce((sum, holding) => sum + holding.pnl, 0);
  }, [holdingsWithLiveData]);
  
  const totalPnL = realizedPnL + unrealizedPnL;

  const pageShellClasses = cn(
    "space-y-6",
    isEmbedded ? "" : "mx-auto max-w-6xl px-2 pb-10 pt-4 sm:px-4 lg:px-8"
  );

  if (isLoading) {
    return (
      <div className={pageShellClasses}>
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, idx) => (
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

  return (
    <>
      <motion.div 
        className={pageShellClasses}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        {!isEmbedded && <h1 className="text-3xl font-bold text-slate-900">Performance</h1>}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Realized P&L</CardTitle>
            {realizedPnL >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(realizedPnL)}`}>
              {formatCurrency(realizedPnL)}
            </div>
            <p className="text-xs text-gray-500 mt-1">From closed positions</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
            {unrealizedPnL >= 0 ? <TrendingUp className="h-4 w-4 text-green-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getPnlColor(unrealizedPnL)}`}>
              {formatCurrency(unrealizedPnL)}
            </div>
            <p className="text-xs text-gray-500 mt-1">From open positions</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Charges</CardTitle>
            <Receipt className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-700">
              {formatCurrency(totalCharges)}
            </div>
            <p className="text-xs text-gray-500 mt-1">Trading fees & taxes</p>
          </CardContent>
        </Card>
      </div>

      {/* Total P&L Card */}
      <Card className="mb-6 rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg font-medium">Total P&L</CardTitle>
          {totalPnL >= 0 ? <TrendingUp className="h-5 w-5 text-green-600" /> : <TrendingDown className="h-5 w-5 text-red-600" />}
        </CardHeader>
        <CardContent>
          <div className={`text-4xl font-bold ${getPnlColor(totalPnL)}`}>
            {formatCurrency(totalPnL)}
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Realized: {formatCurrency(realizedPnL)} + Unrealized: {formatCurrency(unrealizedPnL)}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6 rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-lg font-medium">Performance Stocks</CardTitle>
            <p className="text-xs text-gray-500">Live positions with quick actions</p>
          </div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {holdingsWithLiveData.length} active
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          {holdingsWithLiveData.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              No open positions available.
            </div>
          ) : (
            holdingsWithLiveData.map((holding) => (
              <div
                key={`${holding.symbol}-${holding.product_type}`}
                className="rounded-2xl border border-slate-100 bg-white/90 p-4 shadow-sm"
              >
                <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{holding.product_type}</p>
                    <p className="text-xl font-semibold text-slate-900">{holding.symbol}</p>
                    <p className="text-sm text-slate-500">{holding.quantity} shares @ {formatCurrency(holding.average_price)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">LTP</p>
                    <p className="text-2xl font-bold text-slate-900">{formatCurrency(holding.ltp)}</p>
                    <p className={`text-sm font-semibold ${getPnlColor(holding.pnl)}`}>
                      {formatCurrency(holding.pnl)} ({holding.pnl >= 0 ? '+' : ''}{holding.pnlPct.toFixed(2)}%)
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => openTradeModal(holding, 'SELL')}>
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
                    <Button size="sm" variant="ghost" onClick={(e) => handleDetailsClick(holding, e)}>
                      Details
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Exited Trades Table */}
      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader>
          <CardTitle>Completed Trades ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, idx) => (
                  <TableRow key={order.id || idx}>
                    <TableCell className="text-sm">
                      {new Date(order.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-medium">{order.symbol}</TableCell>
                    <TableCell>
                      <span className={`font-semibold ${order.action === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                        {order.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{order.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(order.price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(order.quantity * order.price)}</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded ${order.product_type === 'MIS' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>
                        {order.product_type || 'CNC'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-800 capitalize">
                        {order.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No completed trades yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Note */}
      <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50/70 p-6 text-blue-800">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Realized P&L is calculated from positions that have been completely exited (bought and sold).
          Unrealized P&L shows the current profit/loss on your open positions based on live market prices.
        </p>
      </div>
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
        <>
          <DialogHeader>
            <DialogTitle>
              {tradeModalAction === 'SELL' ? 'Modify Exit Plan' : 'Update Order'} - {selectedHolding?.symbol}
            </DialogTitle>
            <DialogDescription>
              Fine-tune stop loss, targets, or switch product type without leaving the performance dashboard.
            </DialogDescription>
          </DialogHeader>
          {selectedHolding && (
            <TradeForm
              symbol={selectedHolding.symbol}
              action={tradeModalAction}
              onTradeSuccess={() => {
                closeTradeModal();
                loadData();
              }}
              onClose={closeTradeModal}
            />
          )}
        </>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default PerformancePage;
