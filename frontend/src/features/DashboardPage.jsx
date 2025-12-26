import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { Activity, Briefcase, Box, RefreshCw, TrendingDown, TrendingUp, Wallet, ArrowLeft, PieChart } from "lucide-react";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import priceUpdateService from "../services/priceUpdateService.js";
import TradeForm from "./TradeForm.jsx";
import PortfolioPage from "./PortfolioPage.jsx";
import PerformancePage from "./PerformancePage.jsx";
import { pickLivePriceForSymbol } from "../utils/symbolUtils.js";

const ORDER_TABS = [
    { key: "executed", label: "Executed" },
    { key: "pending", label: "Pending" },
    { key: "cancelled", label: "Cancelled" },
    { key: "rejected", label: "Rejected" },
];

const ORDER_RANGE_FILTERS = [
    { key: "1d", label: "1 Day" },
    { key: "all", label: "All Time" },
];

const INITIAL_ORDER_STATE = ORDER_TABS.reduce((acc, tab) => {
    acc[tab.key] = [];
    return acc;
}, {});

const MOVERS_PAGE_SIZE = 10;
const HOLDINGS_PAGE_SIZE = 5;

const DashboardPage = () => {
    const { profileData } = useDataContext();

    const [portfolioSummary, setPortfolioSummary] = useState(null);
    const [holdings, setHoldings] = useState([]);
    const [orders, setOrders] = useState(INITIAL_ORDER_STATE);
    const [loading, setLoading] = useState({ portfolio: true, orders: true });
    const [tradeContext, setTradeContext] = useState(null);
    const [orderRange, setOrderRange] = useState(ORDER_RANGE_FILTERS[0].key);
    
    // Market Mover State
    const [niftyStocks, setNiftyStocks] = useState([]);
    const [niftyMovers, setNiftyMovers] = useState({ gainers: [], losers: [] });
    const [isLoadingMovers, setIsLoadingMovers] = useState(true);
    const [moversError, setMoversError] = useState(null);
    const [isTradeSubmitting, setIsTradeSubmitting] = useState(false);
    const [tradeCloseRequested, setTradeCloseRequested] = useState(false);

    const [livePriceMap, setLivePriceMap] = useState({});
    const [marketStatus, setMarketStatus] = useState(null);

    // --- Data Fetching ---

    const fetchPortfolio = useCallback(async () => {
        setLoading((prev) => ({ ...prev, portfolio: true }));
        try {
            const response = await api.fetchPortfolio();
            if (response?.success !== false) {
                setPortfolioSummary(response?.summary || null);
                setHoldings(response?.holdings || []);
            }
        } catch (error) {
            console.error("Portfolio fetch error:", error);
            // Toast removed here to prevent spamming if auto-refresh fails
        } finally {
            setLoading((prev) => ({ ...prev, portfolio: false }));
        }
    }, []);

    const fetchOrders = useCallback(async () => {
        setLoading((prev) => ({ ...prev, orders: true }));
        try {
            const data = await api.fetchOrders();
            if (data?.success) {
                setOrders({
                    pending: data.pending || [],
                    executed: data.executed || [],
                    cancelled: data.cancelled || [],
                    rejected: data.rejected || [],
                });
            }
        } catch (error) {
            console.error("Order fetch error:", error);
        } finally {
            setLoading((prev) => ({ ...prev, orders: false }));
        }
    }, []);

    const fetchMarketStatus = useCallback(async () => {
        try {
            const status = await api.getMarketStatus();
            setMarketStatus(status);
        } catch {
            // Non-critical; keep last known
        }
    }, []);

    const computeMovers = useCallback((stocks = [], allPrices = {}) => {
        const merged = (Array.isArray(stocks) ? stocks : []).map((stock) => {
            const live = allPrices?.[stock.symbol];
            return live ? { ...stock, ...live } : stock;
        });

        const gainers = merged
            .filter((stock) => Number(stock.percent_change) > 0)
            .sort((a, b) => Number(b.percent_change) - Number(a.percent_change))
            .slice();

        const losers = merged
            .filter((stock) => Number(stock.percent_change) < 0)
            .sort((a, b) => Number(a.percent_change) - Number(b.percent_change))
            .slice();

        return { gainers, losers };
    }, []);

    const fetchNiftyMarket = useCallback(async () => {
        setIsLoadingMovers(true);
        setMoversError(null);
        try {
            const response = await api.fetchMarket();
            if (!response?.success) {
                throw new Error(response?.message || "Failed to load market movers");
            }

            const stocks = Array.isArray(response.stocks) ? response.stocks : [];
            setNiftyStocks(stocks);

            // Seed initial prices into the websocket-driven cache
            const seedMap = stocks.reduce((acc, stock) => {
                if (!stock?.symbol) return acc;
                acc[stock.symbol] = {
                    symbol: stock.symbol,
                    ltp: typeof stock.ltp === 'number' ? stock.ltp : (typeof stock.price === 'number' ? stock.price : 0),
                    change: Number(stock.change) || 0,
                    percent_change: Number(stock.percent_change) || 0,
                    entityType: 'stock',
                };
                return acc;
            }, {});
            
            if (priceUpdateService && typeof priceUpdateService.seedPrices === 'function') {
                priceUpdateService.seedPrices(seedMap);
            }

            setNiftyMovers(computeMovers(stocks, seedMap));
        } catch (error) {
            setMoversError(error.message);
        } finally {
            setIsLoadingMovers(false);
        }
    }, [computeMovers]);

    // Initial Load & Subscription
    useEffect(() => {
        fetchPortfolio();
        fetchOrders();
        fetchNiftyMarket();
        fetchMarketStatus();
        
        // Auto-refresh portfolio/orders every 30 seconds
        const interval = setInterval(() => {
            fetchPortfolio();
            fetchOrders();
        }, 30000);
        
        return () => clearInterval(interval);
    }, [fetchPortfolio, fetchOrders, fetchNiftyMarket, fetchMarketStatus]);

    useEffect(() => {
        fetchMarketStatus();
        const id = setInterval(fetchMarketStatus, 60000);
        return () => clearInterval(id);
    }, [fetchMarketStatus]);

    // Real-time Market Updates
    useEffect(() => {
        const unsubscribe = priceUpdateService.subscribe((update) => {
            setLivePriceMap((prev) => {
                let next = prev;

                if (update?.type === 'snapshot' && update?.allPrices && Object.keys(update.allPrices).length > 0) {
                    next = update.allPrices;
                } else if (update?.allPrices && Object.keys(update.allPrices).length > 0) {
                    next = update.allPrices;
                } else if (update?.changedPrices && Object.keys(update.changedPrices).length > 0) {
                    next = { ...prev, ...update.changedPrices };
                }

                setNiftyMovers(computeMovers(niftyStocks, next));
                return next;
            });
        });

        return () => unsubscribe();
    }, [computeMovers, niftyStocks]);

    const openTradeModal = (stock, action) => {
        setTradeContext({ stock, action });
    };

    const closeTradeModal = useCallback(() => {
        setTradeContext(null);
        setIsTradeSubmitting(false);
        setTradeCloseRequested(false);
    }, []);

    useEffect(() => {
        const handler = () => {
            fetchPortfolio();
            fetchOrders();
        };
        window.addEventListener('te:trade-success', handler);
        return () => window.removeEventListener('te:trade-success', handler);
    }, [fetchOrders, fetchPortfolio]);

    return (
        <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2">
            <Tabs defaultValue="home" className="space-y-3">
                <div className="flex items-center gap-2 overflow-x-auto">
                    <Button
                        asChild
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full border-slate-200"
                        aria-label="Back to dashboard"
                    >
                        <Link to="/dashboard">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <TabsList className="flex-1 justify-start gap-2 bg-transparent p-0">
                        <TabsTrigger 
                            value="home" 
                            className="whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Home
                        </TabsTrigger>
                        <TabsTrigger 
                            value="portfolio"
                            className="whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Portfolio
                        </TabsTrigger>
                        <TabsTrigger 
                            value="performance"
                            className="whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Performance
                        </TabsTrigger>
                        <TabsTrigger 
                            value="orders"
                            className="whitespace-nowrap rounded-full border border-transparent px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Orders
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="home" className="border-none bg-transparent p-0 shadow-none">
                    <div className="space-y-3">
                        <PortfolioStrip
                            summary={portfolioSummary}
                            holdings={holdings}
                            livePriceMap={livePriceMap}
                            marketStatus={marketStatus}
                            isLoading={loading.portfolio}
                        />
                        
                        <div className="grid gap-4 lg:grid-cols-3">
                            {/* Market Movers takes up 2 columns on large screens */}
                            <div className="lg:col-span-2">
                                <MarketMoversSection
                                    movers={niftyMovers}
                                    isLoading={isLoadingMovers}
                                    error={moversError}
                                    onRefresh={fetchNiftyMarket}
                                    onTrade={openTradeModal}
                                />
                            </div>
                            
                            {/* Portfolio Holdings Summary takes up 1 column */}
                            <div className="lg:col-span-1">
                                <PortfolioHoldings holdings={holdings} isLoading={loading.portfolio} />
                            </div>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="portfolio" className="border-none bg-transparent p-0 shadow-none">
                    <div className="-mx-2 sm:-mx-4 lg:-mx-6">
                        <PortfolioPage isEmbedded />
                    </div>
                </TabsContent>

                <TabsContent value="performance" className="border-none bg-transparent p-0 shadow-none">
                    <div className="-mx-2 sm:-mx-4 lg:-mx-6">
                        <PerformancePage isEmbedded />
                    </div>
                </TabsContent>

                <TabsContent value="orders" className="border-none bg-transparent p-0 shadow-none">
                    <OrdersPanel
                        orders={orders}
                        isLoading={loading.orders}
                        range={orderRange}
                        onRangeChange={setOrderRange}
                    />
                </TabsContent>
            </Tabs>

            <Dialog open={!!tradeContext} onOpenChange={(open) => !open && closeTradeModal()}>
                <DialogContent className="w-[95vw] max-w-xl border-none bg-transparent p-0 shadow-none sm:w-full max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
                    <div className="p-3 sm:p-4">
                        <DialogHeader className="sr-only">
                            <DialogTitle>{tradeContext?.action === "SELL" ? "Sell" : "Buy"} {tradeContext?.stock?.symbol}</DialogTitle>
                            <DialogDescription id="trade-dialog-description">Place {tradeContext?.action?.toLowerCase()} order for {tradeContext?.stock?.symbol}</DialogDescription>
                        </DialogHeader>
                        <TradeForm
                            symbol={tradeContext?.stock?.symbol}
                            action={tradeContext?.action}
                            onClose={closeTradeModal}
                            onTradeSuccess={() => {
                                closeTradeModal();
                                fetchPortfolio(); // Refresh portfolio after trade
                                fetchOrders();    // Refresh orders after trade
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const PortfolioStrip = ({ summary, holdings = [], livePriceMap = {}, marketStatus, isLoading }) => {
    const investedFromSummary = Number(summary?.total_investment) || 0;
    const realizedFromSummary = Number(summary?.realized_pnl) || 0;

    const { investedAmount, currentValue, totalPnl } = useMemo(() => {
        const list = Array.isArray(holdings) ? holdings : [];

        const investedFromHoldings = list.reduce((sum, holding) => {
            const investmentValue = Number(holding?.investment_value);
            if (Number.isFinite(investmentValue)) {
                return sum + investmentValue;
            }

            const qty = Number(holding?.quantity) || 0;
            const avg = Number(holding?.average_price) || 0;
            return sum + (avg * qty);
        }, 0);

        const invested = investedFromSummary > 0 ? investedFromSummary : investedFromHoldings;

        const current = list.reduce((sum, holding) => {
            const qty = Number(holding?.quantity) || 0;
            if (!holding?.symbol || qty === 0) {
                return sum;
            }
            const live = pickLivePriceForSymbol(livePriceMap, holding.symbol, holding.exchange);
            const ltp = Number(live?.ltp ?? live?.price ?? holding?.ltp) || 0;
            return sum + (ltp * qty);
        }, 0);

        // Preserve any non-holdings unrealized component (e.g., short positions) from the API summary.
        const summaryHoldingsValue = Number(summary?.holdings_value);
        const summaryInvestment = Number(summary?.total_investment);
        const summaryUnrealized = Number(summary?.unrealized_pnl);

        const apiHoldingsUnrealized =
            Number.isFinite(summaryHoldingsValue) && Number.isFinite(summaryInvestment)
                ? (summaryHoldingsValue - summaryInvestment)
                : 0;

        const apiNonHoldingUnrealized =
            Number.isFinite(summaryUnrealized)
                ? (summaryUnrealized - apiHoldingsUnrealized)
                : 0;

        const unrealized = (current - invested) + apiNonHoldingUnrealized;
        const total = realizedFromSummary + unrealized;

        return { investedAmount: invested, currentValue: current, totalPnl: total };
    }, [holdings, investedFromSummary, livePriceMap, realizedFromSummary, summary]);

    const currentDelta = currentValue - investedAmount;

    const todaysPnl = useMemo(() => {
        const isMarketOpen = Boolean(marketStatus?.is_market_open);
        const isHoliday = Boolean(marketStatus?.is_holiday);
        if (!isMarketOpen || isHoliday) {
            return 0;
        }
        const list = Array.isArray(holdings) ? holdings : [];
        return list.reduce((sum, holding) => {
            const qty = Number(holding?.quantity) || 0;
            if (!holding?.symbol || qty === 0) {
                return sum;
            }

            const live = pickLivePriceForSymbol(livePriceMap, holding.symbol, holding.exchange);
            const change = Number(live?.change ?? live?.net_change ?? 0) || 0;
            return sum + (change * qty);
        }, 0);
    }, [holdings, livePriceMap, marketStatus]);

    const todaysPercent = investedAmount > 0 ? (todaysPnl / investedAmount) * 100 : 0;
    const totalPercent = investedAmount > 0 ? (totalPnl / investedAmount) * 100 : 0;

    const items = [
        {
            label: "Current Value",
            value: currentValue,
            icon: Wallet,
            color: currentDelta > 0 ? "text-emerald-600" : currentDelta < 0 ? "text-red-600" : "text-slate-900",
        },
        {
            label: "Invested Amount",
            value: investedAmount,
            icon: Briefcase,
            color: "text-slate-900",
        },
        {
            label: "Today's P&L",
            value: todaysPnl,
            icon: Activity,
            color: todaysPnl > 0 ? "text-emerald-600" : todaysPnl < 0 ? "text-red-500" : "text-slate-900",
            percent: todaysPercent,
        },
        {
            label: "Total P&L",
            value: totalPnl,
            icon: totalPnl >= 0 ? TrendingUp : TrendingDown,
            color: totalPnl > 0 ? "text-emerald-600" : totalPnl < 0 ? "text-red-500" : "text-slate-900",
            percent: totalPercent,
        },
    ];

    if (isLoading) {
        return (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {items.map((_, index) => (
                    <Skeleton key={index} className="h-20 rounded-3xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
                <Card key={item.label} className="rounded-3xl border border-slate-100 shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-col gap-1.5 p-4">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <item.icon className="h-4 w-4 text-amber-500" />
                            {item.label}
                        </div>
                        <div>
                            <p className={`text-xl font-bold ${item.color}`}>
                                {formatCurrency(item.value)}
                            </p>
                            {typeof item.percent === "number" && Number.isFinite(item.percent) && (
                                <p className={`text-xs font-semibold ${item.color}`}>
                                    {item.percent > 0 ? '+' : ''}{item.percent.toFixed(2)}%
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const MarketMoversSection = ({ movers, isLoading, error, onRefresh, onTrade }) => {
    const [activeTab, setActiveTab] = useState("gainers");
    const [pageByTab, setPageByTab] = useState({ gainers: 1, losers: 1 });
    const tabs = [
        { key: "gainers", label: "Gainers" },
        { key: "losers", label: "Losers" },
    ];

    const stocks = movers?.[activeTab] || [];
    const totalPages = Math.max(1, Math.ceil(stocks.length / MOVERS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(pageByTab?.[activeTab] || 1, 1), totalPages);
    const pageStart = (currentPage - 1) * MOVERS_PAGE_SIZE;
    const pageStocks = stocks.slice(pageStart, pageStart + MOVERS_PAGE_SIZE);
    const fillerCount = Math.max(0, MOVERS_PAGE_SIZE - pageStocks.length);

    const showSkeleton = isLoading && stocks.length === 0;
    const showErrorState = error && stocks.length === 0;

    return (
        <Card className="h-full rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                    <CardTitle className="text-base font-semibold text-slate-900">Market Movers</CardTitle>
                    <p className="text-[11px] text-slate-500">Nifty 50 Real-time</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px]">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                className={`rounded-full px-2.5 py-0.5 font-semibold transition-colors ${activeTab === tab.key ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                onClick={() => {
                                    setActiveTab(tab.key);
                                    setPageByTab((prev) => ({ ...prev, [tab.key]: 1 }));
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                        onClick={onRefresh}
                        disabled={isLoading}
                        title="Refresh Market Data"
                    >
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {error && stocks.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {error}. Showing cached data.
                    </div>
                )}
                {showSkeleton ? (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                        {[...Array(MOVERS_PAGE_SIZE)].map((_, index) => (
                            <Skeleton key={index} className="h-[56px] rounded-2xl" />
                        ))}
                    </div>
                ) : showErrorState ? (
                    <div className="flex h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 text-slate-500">
                         <Activity className="mb-2 h-8 w-8 text-slate-300" />
                        <p className="text-sm">{error || 'Could not load data'}</p>
                    </div>
                ) : stocks.length > 0 ? (
                    <>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                            {pageStocks.map((stock) => (
                                <MarketMoverRow key={stock.symbol} stock={stock} onTrade={onTrade} />
                            ))}
                            {Array.from({ length: fillerCount }).map((_, index) => (
                                <div
                                    key={`mover-filler-${activeTab}-${currentPage}-${index}`}
                                    className="h-[56px] rounded-2xl border border-transparent"
                                    aria-hidden="true"
                                />
                            ))}
                        </div>
                        {totalPages > 1 && (
                            <div className="mt-3 flex items-center justify-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 rounded-full"
                                    onClick={() => setPageByTab((prev) => ({ ...prev, [activeTab]: Math.max(1, currentPage - 1) }))}
                                    disabled={currentPage <= 1}
                                    aria-label="Previous page"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </Button>
                                <span className="min-w-[56px] text-center text-[11px] font-semibold text-slate-600">
                                    {currentPage}/{totalPages}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 rounded-full"
                                    onClick={() => setPageByTab((prev) => ({ ...prev, [activeTab]: Math.min(totalPages, currentPage + 1) }))}
                                    disabled={currentPage >= totalPages}
                                    aria-label="Next page"
                                >
                                    <ArrowLeft className="h-4 w-4 rotate-180" />
                                </Button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                        No {activeTab} in Nifty 50 currently.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const MarketMoverRow = ({ stock, onTrade }) => {
    const navigate = useNavigate();
    const price = Number(stock.ltp) || 0;
    const change = Number(stock.change) || 0;
    const percent = Number(stock.percent_change) || 0;
    const isPositive = change >= 0;
    const displaySymbol = stock.symbol?.split('.')[0] || stock.symbol || "";

    const goToStock = () => {
        if (!displaySymbol) return;
        navigate(`/stock/${displaySymbol}`);
    };

    return (
        <div
            className="group/mover relative cursor-pointer rounded-2xl border border-slate-100 bg-white px-3 py-1.5 shadow-sm transition hover:shadow-md"
            role="button"
            tabIndex={0}
            onClick={goToStock}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && goToStock()}
        >
            <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{displaySymbol}</p>
                    <p className="truncate text-[11px] text-slate-500">{stock.name || "--"}</p>
                </div>
                <div className="text-right whitespace-nowrap">
                    <p className="text-sm font-semibold text-slate-900">₹{price.toLocaleString('en-IN')}</p>
                    <p className={`text-[11px] font-semibold ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
                        {isPositive ? "+" : "-"}{Math.abs(change).toFixed(2)}
                        <span className="ml-1">({isPositive ? "+" : "-"}{Math.abs(percent).toFixed(2)}%)</span>
                    </p>
                </div>
            </div>

            <div className="pointer-events-none absolute right-24 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1 shadow-md opacity-0 transition-opacity group-hover/mover:pointer-events-auto group-hover/mover:opacity-100">
                <button
                    type="button"
                    className="h-8 w-8 rounded-lg bg-emerald-600 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade(stock, "BUY");
                    }}
                    aria-label={`Buy ${displaySymbol}`}
                >
                    B
                </button>
                <button
                    type="button"
                    className="h-8 w-8 rounded-lg bg-red-600 text-[12px] font-bold text-white shadow-sm hover:bg-red-700"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade(stock, "SELL");
                    }}
                    aria-label={`Sell ${displaySymbol}`}
                >
                    S
                </button>
            </div>
        </div>
    );
};

const PortfolioHoldings = ({ holdings, isLoading }) => {
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [holdings]);

    if (isLoading) {
        return <Skeleton className="h-full min-h-[300px] rounded-3xl" />;
    }

    // Sort by value (Quantity * LTP) descending to show most impactful holdings
    const sortedHoldings = [...(holdings || [])].sort((a, b) => {
        const valA = (a.quantity || 0) * (a.ltp || 0);
        const valB = (b.quantity || 0) * (b.ltp || 0);
        return valB - valA;
    });

    const totalPages = Math.max(1, Math.ceil(sortedHoldings.length / HOLDINGS_PAGE_SIZE));
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * HOLDINGS_PAGE_SIZE;
    const pageHoldings = sortedHoldings.slice(start, start + HOLDINGS_PAGE_SIZE);

    return (
        <Card className="flex h-full flex-col rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-semibold text-slate-900">Top Holdings</CardTitle>
                <div className="flex items-center gap-2">
                    {sortedHoldings.length > HOLDINGS_PAGE_SIZE && (
                        <span className="text-[11px] font-semibold text-slate-500">{currentPage}/{totalPages}</span>
                    )}
                    <Button asChild variant="ghost" size="sm" className="h-8 rounded-full text-slate-500 hover:text-slate-900">
                        <Link to="/dashboard?tab=portfolio">View All</Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="flex-1">
                {!sortedHoldings.length ? (
                    <div className="flex h-full flex-col items-center justify-center space-y-3 py-8 text-center text-slate-500">
                        <div className="rounded-full bg-slate-100 p-3">
                            <PieChart className="h-6 w-6 text-slate-400" />
                        </div>
                        <div>
                            <p className="text-sm font-medium">No holdings yet</p>
                            <p className="text-xs">Start trading to build your portfolio</p>
                        </div>
                    </div>
                ) : (
                    <>
                    <div className="space-y-2">
                        {pageHoldings.map((holding) => {
                            const pnl = Number(holding.unrealized_pnl) || 0;
                            const isPositive = pnl >= 0;
                            const currentValue = (holding.quantity * holding.ltp);
                            
                            return (
                                <div key={holding.symbol} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/70 p-2 transition-colors hover:bg-white">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <p className="truncate text-[13px] font-bold text-slate-900">{holding.symbol}</p>
                                            <p className="text-[13px] font-semibold text-slate-900">{formatCurrency(currentValue)}</p>
                                        </div>
                                        <div className="mt-0.5 flex items-center justify-between text-xs">
                                            <span className="text-slate-500">{holding.quantity} qty @ {formatCurrency(holding.average_price)}</span>
                                            <span className={`font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                                                {isPositive ? '+' : ''}{formatCurrency(pnl)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {totalPages > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                disabled={currentPage <= 1}
                                aria-label="Previous holdings page"
                            >
                                <ArrowLeft className="h-4 w-4" />
                            </Button>
                            <span className="min-w-[56px] text-center text-[11px] font-semibold text-slate-600">
                                {currentPage}/{totalPages}
                            </span>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={currentPage >= totalPages}
                                aria-label="Next holdings page"
                            >
                                <ArrowLeft className="h-4 w-4 rotate-180" />
                            </Button>
                        </div>
                    )}
                    </>
                )}
            </CardContent>
        </Card>
    );
};

const OrdersPanel = ({ orders, isLoading, range = ORDER_RANGE_FILTERS[0].key, onRangeChange }) => {
    const filteredOrders = useMemo(() => {
        const now = Date.now();
        const threshold = now - 24 * 60 * 60 * 1000; // last 1 day

        return ORDER_TABS.reduce((acc, tab) => {
            const list = orders?.[tab.key] || [];
            if (range === "all") {
                acc[tab.key] = list;
            } else {
                acc[tab.key] = list.filter((order) => {
                    const timestamp = order?.date ? new Date(order.date).getTime() : NaN;
                    return Number.isFinite(timestamp) && timestamp >= threshold;
                });
            }
            return acc;
        }, {});
    }, [orders, range]);

    if (isLoading) {
        return <Skeleton className="h-64 rounded-3xl" />;
    }

    return (
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center justify-between">
                     <CardTitle className="text-lg font-semibold">Orders</CardTitle>
                     <div className="flex rounded-full border border-slate-200 p-1 lg:hidden">
                        {ORDER_RANGE_FILTERS.map((filter) => (
                            <button
                                key={filter.key}
                                type="button"
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${range === filter.key ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                                onClick={() => onRangeChange?.(filter.key)}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>
                
                <div className="hidden rounded-full border border-slate-200 p-1 lg:flex">
                    {ORDER_RANGE_FILTERS.map((filter) => (
                        <button
                            key={filter.key}
                            type="button"
                            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${range === filter.key ? 'bg-slate-900 text-white' : 'text-slate-500'}`}
                            onClick={() => onRangeChange?.(filter.key)}
                        >
                            {filter.label}
                        </button>
                    ))}
                </div>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="executed" className="space-y-4">
                    <TabsList className="grid w-full grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 md:grid-cols-4">
                        {ORDER_TABS.map((tab) => (
                            <TabsTrigger 
                                key={tab.key} 
                                value={tab.key} 
                                className="rounded-lg text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm"
                            >
                                {tab.label}
                                <span className="ml-1.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 group-data-[state=active]:bg-slate-100">
                                    {filteredOrders?.[tab.key]?.length || 0}
                                </span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {ORDER_TABS.map((tab) => (
                        <TabsContent key={tab.key} value={tab.key} className="mt-0 border-none p-0 focus-visible:ring-0">
                            {(filteredOrders?.[tab.key] || []).length ? (
                                <div className="overflow-hidden rounded-2xl border border-slate-100">
                                    <Table>
                                        <TableHeader className="bg-slate-50/50">
                                            <TableRow>
                                                <TableHead>Symbol</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Qty</TableHead>
                                                <TableHead className="text-right">Price</TableHead>
                                                <TableHead className="text-right">Time</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {(filteredOrders?.[tab.key] || []).slice(0, 5).map((order) => (
                                                <TableRow key={order.id} className="hover:bg-slate-50">
                                                    <TableCell className="font-bold text-slate-900">{order.symbol}</TableCell>
                                                    <TableCell>
                                                        <span className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${order.transaction_type === 'BUY' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                                            {order.transaction_type}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium">{order.quantity}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(order.price)}</TableCell>
                                                    <TableCell className="text-right text-xs text-slate-500">
                                                        {new Date(order.date).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            ) : (
                                <EmptyOrdersState status={tab.label} />
                            )}
                        </TabsContent>
                    ))}
                </Tabs>
            </CardContent>
        </Card>
    );
};

const EmptyOrdersState = ({ status }) => (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-sm text-slate-500">
        <Box className="h-8 w-8 text-slate-300" />
        <p>No {status.toLowerCase()} orders found in this period.</p>
    </div>
);

const formatCurrency = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "₹0.00";
    }
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default DashboardPage;