import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { TrendingUp, TrendingDown, Wallet, Briefcase, PlusCircle, MinusCircle } from "lucide-react";

const PortfolioPage = () => {
  const [portfolioData, setPortfolioData] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await api.fetchPortfolio();
        if (data.success) {
          setPortfolioData(data);
          // Pre-populate live prices with LTP from holdings
          const initialPrices = data.holdings.reduce((acc, holding) => {
            acc[holding.symbol] = { ltp: holding.ltp };
            return acc;
          }, {});
          setLivePrices(initialPrices);
        } else {
          throw new Error(data.message || "Failed to fetch portfolio.");
        }
      } catch (err) {
        setError(err.message);
        toast.error(`Error: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadPortfolio();
  }, []);

  useEffect(() => {
    const onPriceUpdate = (data) => {
        setLivePrices(currentPrices => ({
            ...currentPrices,
            ...data.allPrices
        }));
    };

    const unsubscribe = priceUpdateService.subscribe(onPriceUpdate);
    return () => unsubscribe();
  }, []);

  const processedPortfolio = useMemo(() => {
    if (!portfolioData) return null;

    const holdingsWithLiveData = portfolioData.holdings.map(holding => {
      const livePrice = livePrices[holding.symbol]?.ltp || holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      return { ...holding, ltp: livePrice, market_value, unrealized_pnl };
    });

    const current_holdings_value = holdingsWithLiveData.reduce((sum, h) => sum + h.market_value, 0);
    const unrealized_pnl = current_holdings_value - portfolioData.summary.total_investment;
    const total_portfolio_value = portfolioData.summary.cash_balance + current_holdings_value;
    const total_pnl = unrealized_pnl + portfolioData.summary.realized_pnl;

    return {
      summary: { ...portfolioData.summary, holdings_value: current_holdings_value, unrealized_pnl, total_portfolio_value, total_pnl },
      holdings: holdingsWithLiveData,
    };
  }, [portfolioData, livePrices]);
  
  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPnlColor = (value) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-700 dark:text-gray-300';
  };

  const SummaryCard = ({ title, value, icon: Icon, colorClass = 'text-gray-900 dark:text-white' }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${colorClass.replace('text-', 'text-muted-')}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colorClass}`}>{formatCurrency(value)}</div>
      </CardContent>
    </Card>
  );

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }
  
  if (!processedPortfolio) {
    return <div className="p-8 text-center">No portfolio data available.</div>;
  }

  const { summary, holdings } = processedPortfolio;

  return (
    <motion.div 
      className="p-4 sm:p-6 lg:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="text-3xl font-bold mb-6">My Portfolio</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <SummaryCard title="Total Value" value={summary.total_portfolio_value} icon={Wallet} colorClass="text-blue-600" />
        <SummaryCard title="Holdings Value" value={summary.holdings_value} icon={Briefcase} />
        <SummaryCard title="Unrealized P/L" value={summary.unrealized_pnl} icon={summary.unrealized_pnl >= 0 ? TrendingUp : TrendingDown} colorClass={getPnlColor(summary.unrealized_pnl)} />
        <SummaryCard title="Cash Balance" value={summary.cash_balance} icon={Wallet} colorClass="text-green-600" />
      </div>

       <div className="grid gap-4 md:grid-cols-3 mb-6">
          <SummaryCard title="Total Investment" value={summary.total_investment} icon={PlusCircle} />
          <SummaryCard title="Realized P/L" value={summary.realized_pnl} icon={summary.realized_pnl >= 0 ? PlusCircle : MinusCircle} colorClass={getPnlColor(summary.realized_pnl)} />
          <SummaryCard title="Total P/L" value={summary.total_pnl} icon={summary.total_pnl >= 0 ? TrendingUp : TrendingDown} colorClass={getPnlColor(summary.total_pnl)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Holdings ({holdings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Avg. Price</TableHead>
                <TableHead className="text-right">LTP</TableHead>
                <TableHead className="text-right">Market Value</TableHead>
                <TableHead className="text-right">Unrealized P/L</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holdings.length > 0 ? (
                holdings.map(holding => (
                  <TableRow key={holding.symbol}>
                    <TableCell className="font-medium">{holding.symbol}</TableCell>
                    <TableCell className="text-right">{holding.quantity}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.average_price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.ltp)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(holding.market_value)}</TableCell>
                    <TableCell className={`text-right font-medium ${getPnlColor(holding.unrealized_pnl)}`}>
                      {formatCurrency(holding.unrealized_pnl)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">You have no holdings yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default PortfolioPage;

