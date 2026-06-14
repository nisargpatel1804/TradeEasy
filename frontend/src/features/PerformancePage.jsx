import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useDataContext } from "../context/DataContext.jsx";
import priceUpdateService from "../services/priceUpdateService.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { TrendingUp, TrendingDown, Receipt, ArrowLeft } from "lucide-react";
import { cn } from "../utils/cn.js";
import { Button } from "../assets/ui/button.jsx";
import { seedPriceMapFromHoldings } from "../utils/symbolUtils.js";
import usePortfolioSummary from "../hooks/usePortfolioSummary.js";

const PerformancePage = ({ isEmbedded = false }) => {
  const navigate = useNavigate();
  const [portfolioData, setPortfolioData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const lastTradeRefreshRef = useRef(0);
  const queuedTradeRefreshRef = useRef(null);
  const { getPortfolio, getExecutedOrders, livePrices } = useDataContext();

  const loadData = useCallback(async ({ showLoader = false, force = false } = {}) => {
    try {
      if (showLoader) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);

      const [pResp, oResp] = await Promise.allSettled([
        getPortfolio(force),
        getExecutedOrders(200, force),
      ]);

      const errors = [];

      if (pResp.status === 'fulfilled') {
        const val = pResp.value?.data;
        if (val?.success) {
          setPortfolioData(val);
          const seeded = seedPriceMapFromHoldings([
            ...(val.cnc_holdings || []),
            ...(val.mis_holdings || []),
          ]);
          priceUpdateService.seedPrices(seeded);
        } else {
          errors.push(val?.message || 'Portfolio fetch failed');
        }
      } else {
        errors.push(pResp.reason?.message || String(pResp.reason));
      }

      if (oResp.status === 'fulfilled') {
        const val = oResp.value?.data;
        if (val?.success) {
          setOrders(val.executed || []);
        } else {
          errors.push(val?.message || 'Orders fetch failed');
        }
      } else {
        errors.push(oResp.reason?.message || String(oResp.reason));
      }

      if (errors.length) {
        const msg = errors.join('; ');
        setError(msg);
        toast.error(`Error: ${msg}`);
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Error: ${err.message}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [getExecutedOrders, getPortfolio]);

  useEffect(() => {
    loadData({ showLoader: true, force: false });
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => loadData({ force: false }), 30000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (queuedTradeRefreshRef.current) {
        clearTimeout(queuedTradeRefreshRef.current);
      }
    };
  }, [loadData]);

  useEffect(() => {
    const onPortfolioReset = () => {
      loadData({ showLoader: false, force: true });
    };

    const onTradeSuccess = () => {
      const now = Date.now();
      if (now - lastTradeRefreshRef.current > 1500) {
        lastTradeRefreshRef.current = now;
        loadData({ force: true });
        return;
      }
      if (!queuedTradeRefreshRef.current) {
        queuedTradeRefreshRef.current = window.setTimeout(() => {
          queuedTradeRefreshRef.current = null;
          lastTradeRefreshRef.current = Date.now();
          loadData({ force: true });
        }, 1200);
      }
    };

    window.addEventListener('te:portfolio-reset', onPortfolioReset);
    window.addEventListener('te:trade-success', onTradeSuccess);
    return () => {
      window.removeEventListener('te:portfolio-reset', onPortfolioReset);
      window.removeEventListener('te:trade-success', onTradeSuccess);
    };
  }, [loadData]);

  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPnlColor = (value) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-700 dark:text-gray-300';
  };

  // Single source of truth: rely on backend /portfolio summary contract.
  const totalCharges = 0; // As per requirements, charges are 0 for now
  const canonicalSummary = usePortfolioSummary({
    baseSummary: portfolioData?.summary,
    holdings: [
      ...(portfolioData?.cnc_holdings || []),
      ...(portfolioData?.mis_holdings || []),
    ],
    shortPositions: portfolioData?.short_positions || [],
    livePriceMap: livePrices,
    marketStatus: portfolioData?.summary?.market_session
      ? { session: portfolioData.summary.market_session }
      : null,
  });

  const realizedPnL = Number(canonicalSummary?.realizedPnl) || 0;
  const unrealizedPnL = Number(canonicalSummary?.unrealizedPnl) || 0;
  const totalPnL = Number(canonicalSummary?.totalPnl) || 0;

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
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, idx) => (
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
                <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Performance</h1>
                <p className="text-xs font-medium text-slate-500">Realized, unrealized, and completed trades in one view.</p>
              </div>
            </div>
            {isRefreshing && (
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
                Refreshing
              </span>
            )}
          </div>
        )}

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Realized P&L</CardTitle>
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-2xl",
              realizedPnL >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
            )}>
              {realizedPnL >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("text-xl font-bold", getPnlColor(realizedPnL))}>{formatCurrency(realizedPnL)}</div>
            <p className="mt-1 text-xs text-slate-500">From closed positions</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unrealized P&L</CardTitle>
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-2xl",
              unrealizedPnL >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
            )}>
              {unrealizedPnL >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn("text-xl font-bold", getPnlColor(unrealizedPnL))}>{formatCurrency(unrealizedPnL)}</div>
            <p className="mt-1 text-xs text-slate-500">From open positions</p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-slate-500">Charges</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900/5 text-slate-900">
              <Receipt className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-xl font-bold text-slate-900">{formatCurrency(totalCharges)}</div>
            <p className="mt-1 text-xs text-slate-500">Trading fees & taxes</p>
          </CardContent>
        </Card>
      </div>

      {/* Total P&L Card */}
      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base font-semibold text-slate-900">Total P&L</CardTitle>
            <p className="text-xs font-medium text-slate-500">Realized + unrealized</p>
          </div>
          <div className={cn(
            "flex h-9 w-9 items-center justify-center rounded-2xl",
            totalPnL >= 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-600"
          )}>
            {totalPnL >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className={cn("text-3xl font-bold", getPnlColor(totalPnL))}>{formatCurrency(totalPnL)}</div>
          <p className="mt-2 text-xs text-slate-500">
            Realized {formatCurrency(realizedPnL)} · Unrealized {formatCurrency(unrealizedPnL)}
          </p>
        </CardContent>
      </Card>

      {/* Exited Trades Table */}
      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base font-semibold text-slate-900">Completed Trades</CardTitle>
          <p className="text-xs font-medium text-slate-500">Executed orders ({orders.length})</p>
        </CardHeader>
        <CardContent className="pt-0">
          {orders.length > 0 ? (
            <>
            <div className="hidden md:block overflow-x-auto">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Symbol</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Action</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qty</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Price</TableHead>
                  <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">Value</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, idx) => (
                  <TableRow key={order.id || idx}>
                    <TableCell className="text-sm">
                      {new Date(order.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </TableCell>
                    <TableCell className="font-medium">{order.symbol}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "font-semibold",
                        order.action === 'BUY' ? "text-emerald-700" : "text-red-600"
                      )}>
                        {order.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{order.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(order.price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(order.quantity * order.price)}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          order.product_type === 'MIS' ? "bg-amber-500/15 text-amber-800" : "bg-slate-900/5 text-slate-700"
                        )}
                      >
                        {order.product_type || 'CNC'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 capitalize">
                        {order.status_display || order.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            <div className="md:hidden space-y-2">
              {orders.map((order, idx) => (
                <div
                  key={order.id || `${order.symbol}-${idx}-mobile`}
                  className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{order.symbol}</p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {new Date(order.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn(
                        "text-sm font-semibold",
                        order.action === 'BUY' ? "text-emerald-700" : "text-red-600"
                      )}>
                        {order.action}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-500">Qty {order.quantity}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-50/80 p-3 text-xs">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Price</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(order.price)}</p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Value</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(order.quantity * order.price)}</p>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Type</p>
                      <span className={cn(
                        "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
                        order.product_type === 'MIS' ? "bg-amber-500/15 text-amber-800" : "bg-slate-900/5 text-slate-700"
                      )}>
                        {order.product_type || 'CNC'}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-500">Status</p>
                      <span className="inline-flex w-fit items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 capitalize">
                        {order.status_display || order.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          ) : (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center text-sm font-medium text-slate-600">
              No completed trades yet.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-3xl border border-slate-200 bg-white/70 p-4 text-slate-700 shadow-sm">
        <p className="text-xs font-medium text-slate-600">
          <strong>Note:</strong> Realized P&L is calculated from positions that have been completely exited (bought and sold).
          Unrealized P&L shows the current profit/loss on your open positions based on live market prices.
        </p>
      </div>
      </motion.div>
    </>
  );
};

export default PerformancePage;
