import { useEffect, useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";

import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useDataContext } from "../context/DataContext.jsx";

import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { BarChart, PieChart, TrendingUp, TrendingDown, ArrowRight } from "lucide-react";

const DashboardPage = () => {
    const { isAuthenticated } = useAuth();
    const { getWatchlists } = useDataContext();
    const navigate = useNavigate();

    const [portfolio, setPortfolio] = useState(null);
    const [watchlistStocks, setWatchlistStocks] = useState([]);
    const [livePrices, setLivePrices] = useState({});
    const [isLoading, setIsLoading] = useState({ portfolio: true, watchlist: true });
    
    // Fetch initial data
    useEffect(() => {
        if (!isAuthenticated) {
            navigate('/login');
            return;
        }

        const fetchData = async () => {
            try {
                // Fetch portfolio
                setIsLoading(prev => ({ ...prev, portfolio: true }));
                const portfolioData = await api.fetchPortfolio();
                if(portfolioData.success) setPortfolio(portfolioData);

            } catch (error) {
                toast.error("Failed to load portfolio.");
            } finally {
                setIsLoading(prev => ({ ...prev, portfolio: false }));
            }
            
            try {
                // Fetch watchlist
                setIsLoading(prev => ({ ...prev, watchlist: true }));
                const watchlistData = await getWatchlists();
                 if (watchlistData && watchlistData.watchlists) {
                    const defaultWatchlist = watchlistData.watchlists.find(w => !w.is_deletable) || watchlistData.watchlists[0];
                    if (defaultWatchlist) {
                        setWatchlistStocks(defaultWatchlist.stocks || []);
                    }
                }
            } catch (error) {
                toast.error("Failed to load watchlist.");
            } finally {
                setIsLoading(prev => ({ ...prev, watchlist: false }));
            }
        };

        fetchData();
    }, [isAuthenticated, navigate, getWatchlists]);
    
    // Subscribe to price updates
    useEffect(() => {
        const unsubscribe = priceUpdateService.subscribe(data => {
            setLivePrices(data.allPrices);
        });
        return () => unsubscribe();
    }, []);

    const watchlistWithLiveData = useMemo(() => {
        return watchlistStocks.map(stock => {
            if (!stock) return null;
            const liveData = livePrices[stock.symbol];
            return liveData ? { ...stock, ...liveData } : stock;
        }).filter(Boolean);
    }, [watchlistStocks, livePrices]);

    return (
        <div className="p-4 md:p-8 space-y-8">
             <header>
                <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                <p className="text-gray-500">Welcome back! Here&#39;s your market snapshot.</p>
            </header>

            <PortfolioSummary portfolio={portfolio} isLoading={isLoading.portfolio} />
            <WatchlistPreview stocks={watchlistWithLiveData.slice(0, 5)} isLoading={isLoading.watchlist} />
        </div>
    );
};


// --- Sub-components ---

const PortfolioSummary = ({ portfolio, isLoading }) => {
    const summary = portfolio?.summary;
    const formatCurrency = (val) => val?.toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) || '₹0.00';
    
    if (isLoading) return <PortfolioSummarySkeleton />;

    if (!summary) return null;

    const isPnlPositive = summary.total_pnl >= 0;

    return (
        <Card className="shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>Portfolio Overview</span>
                     <Link to="/portfolio">
                        <Button variant="ghost" size="sm">View All <ArrowRight className="w-4 h-4 ml-2"/></Button>
                    </Link>
                </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <SummaryCard title="Portfolio Value" value={formatCurrency(summary.total_portfolio_value)} icon={BarChart} />
                 <SummaryCard title="Total Investment" value={formatCurrency(summary.total_investment)} icon={PieChart} />
                 <SummaryCard 
                    title="Total P&L" 
                    value={formatCurrency(summary.total_pnl)} 
                    icon={isPnlPositive ? TrendingUp : TrendingDown}
                    valueClassName={isPnlPositive ? 'text-green-600' : 'text-red-600'}
                />
            </CardContent>
        </Card>
    );
};

const SummaryCard = ({ icon: Icon, title, value, valueClassName }) => (
    <div className="p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center text-gray-500">
             <Icon className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">{title}</span>
        </div>
        <p className={`text-2xl font-bold mt-1 ${valueClassName}`}>{value}</p>
    </div>
);


const WatchlistPreview = ({ stocks, isLoading }) => {
    if (isLoading) return <WatchlistPreviewSkeleton />;
    
    return (
         <Card className="shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>Watchlist Preview</span>
                     <Link to="/watchlist">
                        <Button variant="ghost" size="sm">View All <ArrowRight className="w-4 h-4 ml-2"/></Button>
                    </Link>
                </CardTitle>
            </CardHeader>
            <CardContent>
                 <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">LTP (₹)</TableHead>
                            <TableHead className="text-right">Change (%)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                         {stocks.length > 0 ? stocks.map(stock => {
                            const change = stock.percent_change || 0;
                            const isPositive = change >= 0;
                            return (
                                <TableRow key={stock.symbol}>
                                    <TableCell className="font-medium">{stock.symbol}</TableCell>
                                    <TableCell className="text-right font-semibold">₹{(stock.ltp || 0).toFixed(2)}</TableCell>
                                    <TableCell className={`text-right font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                        {isPositive ? '+' : ''}{change.toFixed(2)}%
                                    </TableCell>
                                </TableRow>
                            )
                         }) : (
                             <TableRow>
                                <TableCell colSpan={3} className="text-center py-8 text-gray-500">Your watchlist is empty.</TableCell>
                             </TableRow>
                         )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}

// --- Skeletons ---
const PortfolioSummarySkeleton = () => (
     <Card>
        <CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
        </CardContent>
    </Card>
);

const WatchlistPreviewSkeleton = () => (
    <Card>
        <CardHeader><Skeleton className="h-6 w-1/3" /></CardHeader>
        <CardContent>
            <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
            </div>
        </CardContent>
    </Card>
);

export default DashboardPage;

