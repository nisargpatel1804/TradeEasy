import { useEffect, useState, useMemo } from "react";
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

const PortfolioPage = () => {
  const navigate = useNavigate();
  const [portfolioData, setPortfolioData] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState("symbol"); // symbol, pnl, value, quantity
  const [sortOrder, setSortOrder] = useState("asc"); // asc, desc

  useEffect(() => {
    const loadPortfolio = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await api.fetchPortfolio();
        if (data.success) {
          setPortfolioData(data);
          // Pre-populate live prices with LTP from all holdings
          const initialPrices = {};
          
          // CNC Holdings
          if (data.cnc_holdings) {
            data.cnc_holdings.forEach(holding => {
              initialPrices[holding.symbol] = { ltp: holding.ltp };
            });
          }
          
          // MIS Holdings
          if (data.mis_holdings) {
            data.mis_holdings.forEach(holding => {
              initialPrices[holding.symbol] = { ltp: holding.ltp };
            });
          }
          
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
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        if (update?.type === 'reset') {
          return {};
        }

        if (update?.type === 'snapshot') {
          if (update?.allPrices && Object.keys(update.allPrices).length > 0) {
            return { ...currentPrices, ...update.allPrices };
          }
          return currentPrices;
        }

        if (update?.changedPrices && Object.keys(update.changedPrices).length > 0) {
          return {
            ...currentPrices,
            ...update.changedPrices,
          };
        }

        return currentPrices;
      });
    });
    return () => unsubscribe();
  }, []);

  const processedHoldings = useMemo(() => {
    if (!portfolioData) return null;

    // Combine all holdings
    const allHoldings = [
      ...(portfolioData.cnc_holdings || []).map(h => ({ ...h, product_type: 'CNC' })),
      ...(portfolioData.mis_holdings || []).map(h => ({ ...h, product_type: 'MIS' }))
    ];

    // Update with live prices and calculate metrics
    const holdingsWithLiveData = allHoldings.map(holding => {
      const livePrice = livePrices[holding.symbol]?.ltp || holding.ltp;
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
  
  if (!processedHoldings) {
    return <div className="p-8 text-center">No holdings data available.</div>;
  }

  const { holdings, summary } = processedHoldings;

  return (
    <motion.div 
      className="p-4 sm:p-6 lg:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="text-3xl font-bold mb-6">Portfolio</h1>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Value</CardTitle>
            <Wallet className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(summary.current_value)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Invested Value</CardTitle>
            <Briefcase className="h-4 w-4 text-gray-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.invested_value)}</div>
          </CardContent>
        </Card>

        <Card>
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

        <Card>
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
      <Card>
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
                className="p-2 hover:bg-gray-100 rounded"
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
  );
};

export default PortfolioPage;
