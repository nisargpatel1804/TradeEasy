import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { TrendingUp, TrendingDown, DollarSign, Receipt } from "lucide-react";

const PerformancePage = () => {
  const [portfolioData, setPortfolioData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // Fetch portfolio data for P&L summary
        const portfolioResponse = await api.fetchPortfolio();
        if (portfolioResponse.success) {
          setPortfolioData(portfolioResponse);
        }
        
        // Fetch executed orders for trade history
        const ordersResponse = await api.fetchOrders();
        if (ordersResponse.success) {
          setOrders(ordersResponse.executed || []);
        }
      } catch (err) {
        setError(err.message);
        toast.error(`Error: ${err.message}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

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

  // Calculate total stats
  const totalCharges = 0; // As per requirements, charges are 0 for now
  const realizedPnL = portfolioData?.summary?.realized_pnl || 0;
  const unrealizedPnL = portfolioData?.summary?.unrealized_pnl || 0;
  const totalPnL = realizedPnL + unrealizedPnL;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }

  return (
    <motion.div 
      className="p-4 sm:p-6 lg:p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="text-3xl font-bold mb-6">Performance</h1>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
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

        <Card>
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

        <Card>
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
      <Card className="mb-6">
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

      {/* Exited Trades Table */}
      <Card>
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
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Realized P&L is calculated from positions that have been completely exited (bought and sold).
          Unrealized P&L shows the current profit/loss on your open positions based on live market prices.
        </p>
      </div>
    </motion.div>
  );
};

export default PerformancePage;
