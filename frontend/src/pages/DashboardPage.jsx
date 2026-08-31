import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.jsx";
import { Button } from "../components/ui/button.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.jsx";
import { Skeleton } from "../components/ui/skeleton.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog.jsx";
import { Activity, Briefcase, Box, RefreshCw, TrendingDown, TrendingUp, Wallet, ArrowLeft, PieChart } from "lucide-react";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import priceUpdateService from "../services/priceUpdateService.js";
import { MarketCache } from "../lib/cache.js";
import TradeForm from "../components/TradeForm.jsx";
import PortfolioPage from "./PortfolioPage.jsx";
import PerformancePage from "./PerformancePage.jsx";
import { seedPriceMapFromHoldings } from "../lib/symbolUtils.js";
import usePortfolioSummary from "../lib/usePortfolioSummary.js";

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
const MOVERS_SKELETON_COUNT = 10;
const HOLDINGS_PAGE_SIZE = 5;
const DASHBOARD_CACHE_VERSION = 1;
const DASHBOARD_PORTFOLIO_CACHE_KEY = `te:dashboard:portfolio:v${DASHBOARD_CACHE_VERSION}`;
const DASHBOARD_ORDERS_CACHE_KEY = `te:dashboard:orders:v${DASHBOARD_CACHE_VERSION}`;
const DASHBOARD_TABS = ["home", "portfolio", "performance", "orders"];

const getIstDateKey = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return formatter.format(new Date());
};

const isAfterMarketHours = (status) => {
    if (!status) return false;
    return Boolean(status?.is_holiday) || !Boolean(status?.is_market_open);
};

const safeParseJson = (value) => {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const getOrderBucketFromStatus = (statusValue) => {
    const status = String(statusValue || '').toUpperCase();
    if (status === 'EXECUTED') return 'executed';
    if (status === 'CANCELLED') return 'cancelled';
    if (status === 'REJECTED') return 'rejected';
    return 'pending';
};

const DashboardPage = () => {
    const { profileData, livePrices } = useDataContext();
    const navigate = useNavigate();
    const location = useLocation();

    const [portfolioSummary, setPortfolioSummary] = useState(null);
    const [hasPortfolioSnapshot, setHasPortfolioSnapshot] = useState(false);
    const [holdings, setHoldings] = useState([]);
    const [orders, setOrders] = useState(INITIAL_ORDER_STATE);
    const [hasOrdersSnapshot, setHasOrdersSnapshot] = useState(false);
    const [loading, setLoading] = useState({ portfolio: true, orders: true });
    const [portfolioError, setPortfolioError] = useState(null);
    const [tradeContext, setTradeContext] = useState(null);
    const [orderRange, setOrderRange] = useState(ORDER_RANGE_FILTERS[0].key);
    const [activeTab, setActiveTab] = useState("home");
    const tabHistoryRef = useRef([]);
    
    // Market Mover State
    const [niftyStocks, setNiftyStocks] = useState([]);
    const [niftyMovers, setNiftyMovers] = useState({ gainers: [], losers: [] });
    const [isLoadingMovers, setIsLoadingMovers] = useState(true);
    const [moversError, setMoversError] = useState(null);
    const [isTradeSubmitting, setIsTradeSubmitting] = useState(false);
    const [tradeCloseRequested, setTradeCloseRequested] = useState(false);
    const [marketStatus, setMarketStatus] = useState(null);

    const resolveTabFromQuery = useCallback(() => {
        const params = new URLSearchParams(location.search || "");
        const raw = String(params.get("tab") || "").toLowerCase();
        return DASHBOARD_TABS.includes(raw) ? raw : "home";
    }, [location.search]);

    useEffect(() => {
        const nextTab = resolveTabFromQuery();
        setActiveTab(nextTab);
        tabHistoryRef.current = [];
    }, [resolveTabFromQuery]);

    const handleTabChange = useCallback((nextTab) => {
        setActiveTab((currentTab) => {
            if (currentTab !== nextTab) {
                tabHistoryRef.current = [...tabHistoryRef.current, currentTab].slice(-10);
            }
            return nextTab;
        });
    }, []);

    const handleDashboardBack = useCallback(() => {
        const history = tabHistoryRef.current;
        if (history.length > 0) {
            const previousTab = history[history.length - 1];
            tabHistoryRef.current = history.slice(0, -1);
            setActiveTab(previousTab);
            return;
        }

        if (activeTab !== "home") {
            setActiveTab("home");
            return;
        }

        navigate(-1);
    }, [activeTab, navigate]);

    // --- Data Fetching ---

    const fetchPortfolio = useCallback(async () => {
        setLoading((prev) => ({ ...prev, portfolio: true }));
        setPortfolioError(null);
        try {
            const response = await api.fetchPortfolio();
            if (response?.success) {
                setPortfolioSummary(response?.summary || null);
                const nextHoldings = response?.holdings || [];
                setHoldings(nextHoldings);
                const seeded = seedPriceMapFromHoldings(nextHoldings);
                priceUpdateService.seedPrices(seeded);
                setHasPortfolioSnapshot(true);
            } else {
                throw new Error(response?.message || "Failed to fetch portfolio");
            }
        } catch (error) {
            console.error("Portfolio fetch error:", error);
            setPortfolioError(error?.message || "Unable to load portfolio right now.");
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
                setHasOrdersSnapshot(true);
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
        }
    }, []);

    const computeMovers = useCallback((stocks = [], allPrices = {}) => {
        const merged = (Array.isArray(stocks) ? stocks : []).map((stock) => {
            const live = allPrices?.[stock.symbol];
            return live ? { ...stock, ...live } : stock;
        });

        // Business rule: unchanged constituents are grouped with gainers.
        const gainers = merged
            .filter((stock) => Number(stock.percent_change) >= 0)
            .sort((a, b) => Number(b.percent_change) - Number(a.percent_change))
            .slice();

        const losers = merged
            .filter((stock) => Number(stock.percent_change) < 0)
            .sort((a, b) => Number(a.percent_change) - Number(b.percent_change))
            .slice();

        return { gainers, losers };
    }, []);

    const fetchNiftyMarket = useCallback(async () => {
        const cacheHit = MarketCache.isValid();
        if (cacheHit) {
            const cached = MarketCache.get();
            const stocks = Array.isArray(cached.stocks) ? cached.stocks : [];
            setNiftyStocks(stocks);
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
            setIsLoadingMovers(false);
            // Market is closed — data is static; skip background revalidation
            if (cached.market_status !== 'OPEN') return;
            // Market is open — silently revalidate in background; no loading spinner
        } else {
            setIsLoadingMovers(true);
        }
        setMoversError(null);
        try {
            const response = await api.fetchMarket();
            if (!response?.success) {
                throw new Error(response?.message || "Failed to load market movers");
            }
            MarketCache.set(response, response?.market_status === 'OPEN');
            const stocks = Array.isArray(response.stocks) ? response.stocks : [];
            setNiftyStocks(stocks);
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
            if (!cacheHit) setMoversError(error.message);
        } finally {
            setIsLoadingMovers(false);
        }
    }, [computeMovers]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const todayIst = getIstDateKey();

        const portfolioCache = safeParseJson(window.localStorage.getItem(DASHBOARD_PORTFOLIO_CACHE_KEY));
        if (portfolioCache && portfolioCache.snapshotDate !== todayIst) {
            window.localStorage.removeItem(DASHBOARD_PORTFOLIO_CACHE_KEY);
        } else if (portfolioCache?.summary || Array.isArray(portfolioCache?.holdings)) {
            setPortfolioSummary(portfolioCache.summary || null);
            const cachedHoldings = Array.isArray(portfolioCache.holdings) ? portfolioCache.holdings : [];
            setHoldings(cachedHoldings);
            const seeded = seedPriceMapFromHoldings(cachedHoldings);
            priceUpdateService.seedPrices(seeded);
            setHasPortfolioSnapshot(true);
        }

        const ordersCache = safeParseJson(window.localStorage.getItem(DASHBOARD_ORDERS_CACHE_KEY));
        if (ordersCache && ordersCache.snapshotDate !== todayIst) {
            window.localStorage.removeItem(DASHBOARD_ORDERS_CACHE_KEY);
        } else if (ordersCache?.orders) {
            setOrders({
                pending: Array.isArray(ordersCache.orders.pending) ? ordersCache.orders.pending : [],
                executed: Array.isArray(ordersCache.orders.executed) ? ordersCache.orders.executed : [],
                cancelled: Array.isArray(ordersCache.orders.cancelled) ? ordersCache.orders.cancelled : [],
                rejected: Array.isArray(ordersCache.orders.rejected) ? ordersCache.orders.rejected : [],
            });
            setHasOrdersSnapshot(true);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !hasPortfolioSnapshot || !isAfterMarketHours(marketStatus)) {
            return;
        }

        const payload = {
            summary: portfolioSummary,
            holdings,
            snapshotDate: getIstDateKey(),
            savedAt: Date.now(),
        };
        window.localStorage.setItem(DASHBOARD_PORTFOLIO_CACHE_KEY, JSON.stringify(payload));
    }, [hasPortfolioSnapshot, holdings, marketStatus, portfolioSummary]);

    useEffect(() => {
        if (typeof window === 'undefined' || !hasOrdersSnapshot || !isAfterMarketHours(marketStatus)) {
            return;
        }

        const payload = {
            orders,
            snapshotDate: getIstDateKey(),
            savedAt: Date.now(),
        };
        window.localStorage.setItem(DASHBOARD_ORDERS_CACHE_KEY, JSON.stringify(payload));
    }, [hasOrdersSnapshot, marketStatus, orders]);

    useEffect(() => {
        fetchPortfolio();
        fetchOrders();
        fetchNiftyMarket();

        const interval = setInterval(() => {
            if (marketStatus?.is_market_open) {
                fetchPortfolio();
            }
            fetchOrders();
        }, 30000);
        
        return () => clearInterval(interval);
    }, [fetchPortfolio, fetchOrders, fetchNiftyMarket, marketStatus]);

    useEffect(() => {
        fetchMarketStatus();
        const id = setInterval(fetchMarketStatus, 60000);
        return () => clearInterval(id);
    }, [fetchMarketStatus]);

    // Recompute movers on every live tick from the shared DataContext feed.
    useEffect(() => {
        setNiftyMovers(computeMovers(niftyStocks, livePrices || {}));
    }, [computeMovers, livePrices, niftyStocks]);

    const canonicalSummary = usePortfolioSummary({
        baseSummary: portfolioSummary,
        holdings,
        livePriceMap: livePrices,
        marketStatus,
    });

    const openTradeModal = (stock, action) => {
        setTradeContext({ stock, action });
    };

    const closeTradeModal = useCallback(() => {
        setTradeContext(null);
        setIsTradeSubmitting(false);
        setTradeCloseRequested(false);
    }, []);

    useEffect(() => {
        const applyOptimisticUpdates = (detail) => {
            const optimisticOrder = detail?.optimisticOrder;
            if (!optimisticOrder) {
                return;
            }

            const bucket = getOrderBucketFromStatus(optimisticOrder.status);
            const optimisticId = optimisticOrder.id || optimisticOrder.orderId || `${optimisticOrder.symbol || 'order'}-${Date.now()}`;
            const normalizedOrder = {
                id: optimisticId,
                order_id: optimisticId,
                symbol: optimisticOrder.symbol,
                transaction_type: optimisticOrder.transaction_type,
                quantity: optimisticOrder.quantity,
                price: optimisticOrder.price,
                date: optimisticOrder.date || new Date().toISOString(),
            };

            setOrders((prev) => ({
                ...prev,
                [bucket]: [normalizedOrder, ...(prev?.[bucket] || []).filter((item) => String(item?.id || item?.order_id) !== String(optimisticId))],
            }));
            setHasOrdersSnapshot(true);
        };

        const handler = (event) => {
            applyOptimisticUpdates(event?.detail || {});
            fetchPortfolio();
            fetchOrders();
        };
        const resetHandler = () => {
            setPortfolioSummary(null);
            setHasPortfolioSnapshot(false);
            setHoldings([]);
            setOrders(INITIAL_ORDER_STATE);
            setHasOrdersSnapshot(false);
            if (typeof window !== 'undefined') {
                try {
                    window.localStorage.removeItem(DASHBOARD_PORTFOLIO_CACHE_KEY);
                    window.localStorage.removeItem(DASHBOARD_ORDERS_CACHE_KEY);
                    window.localStorage.setItem('te:portfolio-reset:at', String(Date.now()));
                } catch {
                }
            }
            if (MarketCache && typeof MarketCache.clear === 'function') {
                MarketCache.clear();
            }
            fetchPortfolio();
            fetchOrders();
        };
        window.addEventListener('te:trade-success', handler);
        window.addEventListener('te:portfolio-reset', resetHandler);
        return () => {
            window.removeEventListener('te:trade-success', handler);
            window.removeEventListener('te:portfolio-reset', resetHandler);
        };
    }, [fetchOrders, fetchPortfolio]);

    return (
        <div className="mx-auto max-w-7xl space-y-1 pb-1 pt-0">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-1">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0 rounded-full border-slate-200"
                        aria-label="Back to dashboard"
                        onClick={handleDashboardBack}
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <TabsList className="flex-1 justify-start gap-2 bg-transparent p-0">
                        <TabsTrigger 
                            value="home" 
                            className="whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Home
                        </TabsTrigger>
                        <TabsTrigger 
                            value="portfolio"
                            className="whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Portfolio
                        </TabsTrigger>
                        <TabsTrigger 
                            value="performance"
                            className="whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Performance
                        </TabsTrigger>
                        <TabsTrigger 
                            value="orders"
                            className="whitespace-nowrap rounded-full border border-transparent px-2.5 py-1 text-[13px] font-semibold text-slate-600 transition-colors data-[state=active]:border-slate-900 data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-none"
                        >
                            Orders
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="home" className="mt-0 border-none bg-transparent p-0 shadow-none">
                    <div className="space-y-2">
                        {portfolioError && !portfolioSummary && (
                            <Card className="rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm">
                                <CardContent className="flex items-center justify-between gap-3 p-3 text-sm text-amber-800">
                                    <span>{portfolioError}</span>
                                    <Button type="button" variant="outline" size="sm" className="h-8" onClick={fetchPortfolio}>
                                        Retry
                                    </Button>
                                </CardContent>
                            </Card>
                        )}
                        <PortfolioStrip
                            summary={canonicalSummary}
                            hasSnapshot={hasPortfolioSnapshot}
                        />
                        
                        <div className="grid gap-3 lg:grid-cols-3">
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
                                <PortfolioHoldings holdings={holdings} hasSnapshot={hasPortfolioSnapshot} />
                            </div>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="portfolio" className="mt-0 border-none bg-transparent p-0 shadow-none">
                    <div className="-mx-2 sm:-mx-4 lg:-mx-6">
                        <PortfolioPage isEmbedded />
                    </div>
                </TabsContent>

                <TabsContent value="performance" className="mt-0 border-none bg-transparent p-0 shadow-none">
                    <div className="-mx-2 sm:-mx-4 lg:-mx-6">
                        <PerformancePage isEmbedded />
                    </div>
                </TabsContent>

                <TabsContent value="orders" className="mt-0 border-none bg-transparent p-0 shadow-none">
                    <OrdersPanel
                        orders={orders}
                        isLoading={loading.orders}
                        hasSnapshot={hasOrdersSnapshot}
                        range={orderRange}
                        onRangeChange={setOrderRange}
                    />
                </TabsContent>
            </Tabs>

            <Dialog open={!!tradeContext} onOpenChange={(open) => !open && closeTradeModal()}>
                <DialogContent className="w-[95vw] max-w-xl border-none bg-transparent p-0 shadow-none sm:w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-3 sm:p-4">
                        <DialogHeader className="sr-only">
                            <DialogTitle>{tradeContext?.action === "SELL" ? "Sell" : "Buy"} {tradeContext?.stock?.symbol}</DialogTitle>
                            <DialogDescription>Place {tradeContext?.action?.toLowerCase()} order for {tradeContext?.stock?.symbol}</DialogDescription>
                        </DialogHeader>
                        <TradeForm
                            symbol={tradeContext?.stock?.symbol}
                            action={tradeContext?.action}
                            onClose={closeTradeModal}
                            onTradeSuccess={() => {
                                closeTradeModal();
                                fetchPortfolio();
                                fetchOrders();
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const PortfolioStrip = ({ summary, hasSnapshot = false }) => {
    const investedAmount = Number(summary?.investedAmount) || 0;
    const currentValue = Number(summary?.currentValue) || 0;
    const todaysPnl = Number(summary?.todaysPnl) || 0;
    const totalPnl = Number(summary?.totalPnl) || 0;
    const todaysPercent = Number(summary?.todaysPnlPct) || 0;
    const totalPercent = Number(summary?.totalPnlPct) || 0;
    const currentDelta = currentValue - investedAmount;

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

    if (!hasSnapshot) {
        return (
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                {items.map((_, index) => (
                    <Skeleton key={index} className="h-[104px] min-h-[104px] w-full rounded-3xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
                <Card key={item.label} className="min-h-[104px] rounded-3xl border border-slate-100 shadow-sm transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-col gap-1 p-3.5">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            <item.icon className="h-4 w-4 text-amber-500" />
                            {item.label}
                        </div>
                        <div>
                            <p className={`text-[1.35rem] font-bold leading-tight ${item.color}`}>
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

    const showSkeleton = isLoading;
    const showErrorState = error && stocks.length === 0;

    useEffect(() => {
        setPageByTab((prev) => ({
            ...prev,
            [activeTab]: Math.min(Math.max(prev?.[activeTab] || 1, 1), totalPages),
        }));
    }, [activeTab, totalPages]);

    return (
        <Card className="h-full rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1.5">
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
            <CardContent className="overflow-hidden pt-0 pb-3">
                {error && stocks.length > 0 && (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {error}. Showing cached data.
                    </div>
                )}
                {showSkeleton ? (
                    <div className="grid min-h-[304px] gap-1.5 sm:grid-cols-2">
                        {Array.from({ length: MOVERS_SKELETON_COUNT }).map((_, index) => (
                            <div key={`mover-skeleton-${index}`} className="h-[56px] rounded-2xl border border-slate-100 bg-white px-3 py-1.5">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="space-y-1.5">
                                        <Skeleton className="h-3.5 w-16 rounded-full" />
                                        <Skeleton className="h-3 w-24 rounded-full" />
                                    </div>
                                    <div className="space-y-1.5 text-right">
                                        <Skeleton className="ml-auto h-3.5 w-14 rounded-full" />
                                        <Skeleton className="ml-auto h-3 w-18 rounded-full" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : showErrorState ? (
                    <div className="flex h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 text-slate-500">
                         <Activity className="mb-2 h-8 w-8 text-slate-300" />
                        <p className="text-sm">{error || 'Could not load data'}</p>
                    </div>
                ) : stocks.length > 0 ? (
                    <>
                        <div className="grid min-h-[304px] gap-1.5 sm:grid-cols-2">
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
                            <div className="mt-2 flex items-center justify-center gap-2">
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
            className="group/mover relative overflow-hidden cursor-pointer rounded-2xl border border-slate-100 bg-white px-3 py-1.5 shadow-sm transition hover:shadow-md"
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

const PortfolioHoldings = ({ holdings, hasSnapshot = false }) => {
    const [page, setPage] = useState(1);

    const sortedHoldings = [...(holdings || [])].sort((a, b) => {
        const valA = (a.quantity || 0) * (a.ltp || 0);
        const valB = (b.quantity || 0) * (b.ltp || 0);
        return valB - valA;
    });

    const totalPages = Math.max(1, Math.ceil(sortedHoldings.length / HOLDINGS_PAGE_SIZE));

    useEffect(() => {
        setPage((prev) => Math.min(Math.max(prev, 1), totalPages));
    }, [totalPages]);

    if (!hasSnapshot) {
        return <Skeleton className="h-full min-h-[390px] w-full rounded-3xl" />;
    }

    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * HOLDINGS_PAGE_SIZE;
    const pageHoldings = sortedHoldings.slice(start, start + HOLDINGS_PAGE_SIZE);

    return (
        <Card className="flex h-full min-h-[390px] flex-col rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-1.5">
                <CardTitle className="text-lg font-semibold text-slate-900">Top Holdings</CardTitle>
                <div className="flex items-center gap-2">
                    <Button asChild variant="ghost" size="sm" className="h-8 rounded-full text-slate-500 hover:text-slate-900">
                        <Link to="/dashboard?tab=portfolio">View All</Link>
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="flex h-full flex-1 flex-col pt-0">
                {!sortedHoldings.length ? (
                    <div className="flex h-full flex-1 flex-col items-center justify-center space-y-2 py-6 text-center text-slate-500">
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
                    <div className="flex-1 space-y-1.5">
                        {pageHoldings.map((holding) => {
                            const pnl = Number(holding.unrealized_pnl) || 0;
                            const isPositive = pnl >= 0;
                            const currentValue = (holding.quantity * holding.ltp);
                            
                            return (
                                <div key={holding.symbol} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white/70 p-1.5 transition-colors hover:bg-white">
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
                        <div className="mt-auto pt-2 flex items-center justify-center gap-2">
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

const OrdersPanel = ({ orders, isLoading, hasSnapshot = false, range = ORDER_RANGE_FILTERS[0].key, onRangeChange }) => {
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

    if (!hasSnapshot) {
        return <Skeleton className="min-h-[420px] w-full rounded-3xl" />;
    }

    return (
        <Card className="min-h-[420px] rounded-3xl border border-slate-100 shadow-sm">
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
                {isLoading && (
                    <div className="mb-3 flex items-center gap-2">
                        <Skeleton className="h-2.5 w-24 rounded-full" />
                        <Skeleton className="h-2.5 w-14 rounded-full" />
                    </div>
                )}
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