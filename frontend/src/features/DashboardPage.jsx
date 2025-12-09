import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { useToast } from "../assets/ui/use-toast.js";
import { Activity, Briefcase, Box, RefreshCw, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import TradeForm from "./TradeForm.jsx";
import PortfolioPage from "./PortfolioPage.jsx";
import PerformancePage from "./PerformancePage.jsx";

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

const DashboardPage = () => {
    const { profileData } = useDataContext();
    const { toast } = useToast();

    const [portfolioSummary, setPortfolioSummary] = useState(null);
    const [holdings, setHoldings] = useState([]);
    const [orders, setOrders] = useState(INITIAL_ORDER_STATE);
    const [loading, setLoading] = useState({ portfolio: true, orders: true });
    const [tradeContext, setTradeContext] = useState(null);
    const [orderRange, setOrderRange] = useState(ORDER_RANGE_FILTERS[0].key);
    const [niftyMovers, setNiftyMovers] = useState({ gainers: [], losers: [] });
    const [isLoadingMovers, setIsLoadingMovers] = useState(true);
    const [moversError, setMoversError] = useState(null);

    useEffect(() => {
        const fetchPortfolio = async () => {
            setLoading((prev) => ({ ...prev, portfolio: true }));
            try {
                const response = await api.fetchPortfolio();
                if (response?.success !== false) {
                    setPortfolioSummary(response?.summary || null);
                    setHoldings(response?.holdings || []);
                }
            } catch (error) {
                toast({ title: "Could not load portfolio", description: error.message || "Try again later.", variant: "destructive" });
            } finally {
                setLoading((prev) => ({ ...prev, portfolio: false }));
            }
        };

        const fetchOrders = async () => {
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
                toast({ title: "Could not load orders", description: error.message || "Please retry later.", variant: "destructive" });
            } finally {
                setLoading((prev) => ({ ...prev, orders: false }));
            }
        };

        fetchPortfolio();
        fetchOrders();
        
        // Auto-refresh every 30 seconds
        const interval = setInterval(() => {
            fetchPortfolio();
            fetchOrders();
        }, 30000);
        
        return () => clearInterval(interval);
    }, [toast]);

    const fetchNiftyMovers = useCallback(async () => {
        setIsLoadingMovers(true);
        setMoversError(null);
        try {
            const response = await api.fetchMarketStocks("nifty50");
            if (!response?.success) {
                throw new Error(response?.message || "Failed to load market movers");
            }

            const stocks = Array.isArray(response.stocks) ? response.stocks : [];
            const fallbackTop = (direction) => {
                const filtered = stocks
                    .filter((stock) => direction === "gainers" ? Number(stock.change) > 0 : Number(stock.change) < 0)
                    .sort((a, b) => direction === "gainers"
                        ? Number(b.percent_change) - Number(a.percent_change)
                        : Number(a.percent_change) - Number(b.percent_change));
                return filtered.slice(0, 4);
            };

            const gainers = Array.isArray(response.gainers) && response.gainers.length > 0 ? response.gainers.slice(0, 4) : fallbackTop("gainers");
            const losers = Array.isArray(response.losers) && response.losers.length > 0 ? response.losers.slice(0, 4) : fallbackTop("losers");

            setNiftyMovers({ gainers, losers });
        } catch (error) {
            setMoversError(error.message);
        } finally {
            setIsLoadingMovers(false);
        }
    }, []);

    useEffect(() => {
        fetchNiftyMovers();
        const interval = setInterval(fetchNiftyMovers, 60000);
        return () => clearInterval(interval);
    }, [fetchNiftyMovers]);

    const openTradeModal = (stock, action) => {
        setTradeContext({ stock, action });
    };

    const closeTradeModal = () => setTradeContext(null);

    const welcomeName = profileData?.username || "Trader";

    return (
        <div className="mx-auto max-w-6xl space-y-6 px-2 pb-10 pt-4 sm:px-4 lg:px-8">
            <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dashboard Overview</p>
                <h1 className="text-2xl font-bold text-slate-900">Welcome back, {welcomeName}</h1>
            </div>

            <Tabs defaultValue="home" variant="underline" className="space-y-4">
                <div className="flex items-center gap-3">
                    <Button
                        asChild
                        variant="outline"
                        size="icon"
                        className="h-10 w-10 shrink-0 rounded-full border-slate-200"
                        aria-label="Back to dashboard"
                    >
                        <Link to="/dashboard">
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <TabsList className="flex-1 justify-start overflow-x-auto border-b border-slate-200 pb-2">
                        <TabsTrigger value="home">Home</TabsTrigger>
                        <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
                        <TabsTrigger value="performance">Performance</TabsTrigger>
                        <TabsTrigger value="orders">Orders</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="home" className="border-none bg-transparent p-0 shadow-none">
                    <div className="space-y-6">
                        <PortfolioStrip summary={portfolioSummary} isLoading={loading.portfolio} />
                        <MarketMoversSection
                            movers={niftyMovers}
                            isLoading={isLoadingMovers}
                            error={moversError}
                            onRefresh={fetchNiftyMovers}
                            onTrade={openTradeModal}
                        />
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
                <DialogContent className="w-[95vw] max-w-3xl border-none bg-transparent p-0 shadow-none sm:w-full" aria-describedby="trade-dialog-description">
                    <div className="p-4 sm:p-6">
                        <DialogHeader className="sr-only">
                            <DialogTitle>{tradeContext?.action === "SELL" ? "Sell" : "Buy"} {tradeContext?.stock?.symbol}</DialogTitle>
                            <DialogDescription id="trade-dialog-description">Place {tradeContext?.action?.toLowerCase()} order for {tradeContext?.stock?.symbol}</DialogDescription>
                        </DialogHeader>
                        <TradeForm
                            symbol={tradeContext?.stock?.symbol}
                            action={tradeContext?.action}
                            onClose={closeTradeModal}
                            onTradeSuccess={closeTradeModal}
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const PortfolioStrip = ({ summary, isLoading }) => {
    const investedAmount = Number(summary?.total_investment) || 0;
    const totalPnl = Number(summary?.total_pnl) || 0;
    const todaysPnl = Number(summary?.unrealized_pnl) || 0;
    const currentValue = investedAmount + totalPnl;
    const currentDelta = currentValue - investedAmount;
    const todaysPercent = investedAmount > 0 ? (todaysPnl / investedAmount) * 100 : 0;
    const totalPercent = investedAmount > 0 ? (totalPnl / investedAmount) * 100 : 0;

    const items = [
        {
            label: "Current Value",
            value: currentValue,
            icon: Wallet,
            color: currentDelta > 0 ? "text-emerald-600" : currentDelta < 0 ? "text-red-500" : "text-slate-900",
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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {items.map((_, index) => (
                    <Skeleton key={index} className="h-28 rounded-3xl" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {items.map((item) => (
                <Card key={item.label} className="rounded-3xl border border-slate-100 shadow-sm">
                    <CardContent className="flex flex-col gap-2 p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <item.icon className="h-4 w-4 text-amber-500" />
                            {item.label}
                        </div>
                        <div>
                            <p className={`text-2xl font-bold ${item.color}`}>
                                {formatCurrency(item.value)}
                            </p>
                            {typeof item.percent === "number" && Number.isFinite(item.percent) && (
                                <p className={`text-sm font-semibold ${item.color}`}>
                                    {formatPercent(item.percent)}
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
    const tabs = [
        { key: "gainers", label: "Top Gainers" },
        { key: "losers", label: "Top Losers" },
    ];

    const stocks = movers?.[activeTab] || [];
    const showSkeleton = isLoading && stocks.length === 0;
    const showErrorState = error && stocks.length === 0;

    return (
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <CardTitle className="text-xl font-semibold text-slate-900">Market Movers</CardTitle>
                    <p className="text-sm text-slate-500">Live Nifty 50 gainers and laggards. Refresh every minute or on demand.</p>
                </div>
                <div className="flex flex-col items-stretch gap-3 sm:items-end">
                    <div className="flex rounded-full border border-slate-200 p-1 text-sm">
                        {tabs.map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                className={`rounded-full px-4 py-1 font-semibold ${activeTab === tab.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                                onClick={() => setActiveTab(tab.key)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        onClick={onRefresh}
                        disabled={isLoading}
                    >
                        <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {error && stocks.length > 0 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        {error}. Showing last successful data.
                    </div>
                )}
                {showSkeleton ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {[...Array(4)].map((_, index) => (
                            <Skeleton key={index} className="h-40 rounded-3xl" />
                        ))}
                    </div>
                ) : showErrorState ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
                        {error || 'Could not load market movers. Please try again.'}
                    </div>
                ) : stocks.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {stocks.map((stock) => (
                            <MarketMoverCard key={stock.symbol} stock={stock} onTrade={onTrade} />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
                        No {activeTab === 'gainers' ? 'gainers' : 'losers'} in the Nifty 50 right now.
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const MarketMoverCard = ({ stock, onTrade }) => {
    const navigate = useNavigate();
    const price = Number(stock.ltp) || 0;
    const change = Number(stock.change) || 0;
    const percent = Number(stock.percent_change) || 0;
    const isPositive = change >= 0;
    const displaySymbol = stock.symbol?.split('.')[0] || stock.symbol || "";

    const goToStock = () => {
        if (!displaySymbol) {
            return;
        }
        navigate(`/stock/${displaySymbol}`);
    };

    return (
        <div
            className="flex h-full flex-col justify-between rounded-3xl border border-slate-100 bg-slate-50 p-4"
            role="button"
            tabIndex={0}
            onClick={goToStock}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    goToStock();
                }
            }}
        >
            <div>
                <div className="flex items-center justify-between">
                    <p className="text-lg font-semibold text-slate-900">{displaySymbol}</p>
                </div>
                <p className="mt-3 text-2xl font-bold">₹{price.toFixed(2)}</p>
                <p className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {isPositive ? '+' : ''}{change.toFixed(2)}
                    <span className="ml-1 text-xs">
                        ({isPositive ? '+' : ''}{percent.toFixed(2)}%)
                    </span>
                </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                    variant="soft"
                    size="sm"
                    className="rounded-full border border-emerald-100 bg-emerald-50/80 text-emerald-600 hover:bg-emerald-100"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade(stock, 'BUY');
                    }}
                >
                    <TrendingUp className="h-4 w-4" />
                    Buy
                </Button>
                <Button
                    variant="soft"
                    size="sm"
                    className="rounded-full border border-red-100 bg-red-50/80 text-red-600 hover:bg-red-100"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTrade(stock, 'SELL');
                    }}
                >
                    <TrendingDown className="h-4 w-4" />
                    Sell
                </Button>
            </div>
        </div>
    );
};

const PortfolioHoldings = ({ holdings, isLoading }) => {
    if (isLoading) {
        return <Skeleton className="h-64 rounded-3xl" />;
    }

    if (!holdings.length) {
        return <EmptyState message="No holdings yet. Start investing to build your portfolio." />;
    }

    return (
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex items-center justify-between">
                <CardTitle>Portfolio Holdings</CardTitle>
                <Button asChild variant="outline" size="sm">
                    <Link to="/portfolio">View Details</Link>
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Avg. Price</TableHead>
                            <TableHead className="text-right">LTP</TableHead>
                            <TableHead className="text-right">P&L</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {holdings.slice(0, 6).map((holding) => {
                            const pnl = Number(holding.unrealized_pnl) || 0;
                            const isPositive = pnl >= 0;
                            return (
                                <TableRow key={holding.symbol}>
                                    <TableCell className="font-semibold">{holding.symbol}</TableCell>
                                    <TableCell className="text-right">{holding.quantity}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(holding.average_price)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(holding.ltp)}</TableCell>
                                    <TableCell className={`text-right font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {formatCurrency(pnl)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};

const PositionsPanel = ({ holdings, isLoading }) => {
    if (isLoading) {
        return <Skeleton className="h-56 rounded-3xl" />;
    }

    if (!holdings.length) {
        return <EmptyState message="No open positions right now." />;
    }

    return (
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader>
                <CardTitle>Open Positions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
                {holdings.slice(0, 6).map((holding) => {
                    const pnl = Number(holding.unrealized_pnl) || 0;
                    const isPositive = pnl >= 0;
                    return (
                        <div key={holding.symbol} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">{holding.symbol}</p>
                                    <p className="text-xs text-slate-500">{holding.product_type}</p>
                                </div>
                                <span className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                                    {isPositive ? '+' : ''}{formatCurrency(pnl)}
                                </span>
                            </div>
                            <div className="mt-3 grid grid-cols-3 text-xs text-slate-500">
                                <div>
                                    <p>Qty</p>
                                    <p className="font-semibold text-slate-900">{holding.quantity}</p>
                                </div>
                                <div>
                                    <p>Avg</p>
                                    <p className="font-semibold text-slate-900">{formatCurrency(holding.average_price)}</p>
                                </div>
                                <div>
                                    <p>LTP</p>
                                    <p className="font-semibold text-slate-900">{formatCurrency(holding.ltp)}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
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

    const rangeLabel = ORDER_RANGE_FILTERS.find((filter) => filter.key === range)?.label || "";

    if (isLoading) {
        return <Skeleton className="h-64 rounded-3xl" />;
    }

    return (
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                    <CardTitle>Orders</CardTitle>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        Showing {rangeLabel || 'selected range'}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex rounded-full border border-slate-200 p-1 text-xs font-semibold">
                        {ORDER_RANGE_FILTERS.map((filter) => (
                            <button
                                key={filter.key}
                                type="button"
                                className={`rounded-full px-3 py-1 ${range === filter.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                                onClick={() => onRangeChange?.(filter.key)}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="pending" className="space-y-4" variant="soft">
                    <TabsList className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 text-sm md:grid-cols-4">
                        {ORDER_TABS.map((tab) => (
                            <TabsTrigger key={tab.key} value={tab.key} className="rounded-xl px-3 py-2 font-semibold">
                                {tab.label}
                                <span className="ml-2 rounded-full bg-white/80 px-2 py-0.5 text-xs text-slate-500">
                                    {filteredOrders?.[tab.key]?.length || 0}
                                </span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {ORDER_TABS.map((tab) => (
                        <TabsContent key={tab.key} value={tab.key} className="border-none bg-transparent p-0 shadow-none">
                            {(filteredOrders?.[tab.key] || []).length ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Symbol</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="text-right">Quantity</TableHead>
                                            <TableHead className="text-right">Price</TableHead>
                                            <TableHead className="text-right">Date</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {(filteredOrders?.[tab.key] || []).slice(0, 5).map((order) => (
                                            <TableRow key={order.id}>
                                                <TableCell className="font-semibold">{order.symbol}</TableCell>
                                                <TableCell>{order.status}</TableCell>
                                                <TableCell className="text-right">{order.quantity}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(order.price)}</TableCell>
                                                <TableCell className="text-right text-xs text-slate-500">
                                                    {new Date(order.date).toLocaleString()}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
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

const EmptyState = ({ message }) => (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
        {message}
    </div>
);

const EmptyOrdersState = ({ status }) => (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500">
        <Box className="h-10 w-10 text-slate-300" />
        <p>No {status.toLowerCase()} orders found.</p>
    </div>
);

const formatCurrency = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "₹0.00";
    }
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatPercent = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "0.00%";
    }
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${Math.abs(value).toFixed(2)}%`;
};


export default DashboardPage;

