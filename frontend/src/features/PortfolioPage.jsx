import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import priceUpdateService from "../services/priceUpdateService.js";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../assets/ui/table.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { TrendingUp, TrendingDown, Wallet, Briefcase, PlusCircle, MinusCircle, ArrowDownCircle, Info } from "lucide-react";

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
          // Pre-populate live prices with LTP from all holdings and short positions
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
          
          // Short Positions
          if (data.short_positions) {
            data.short_positions.forEach(position => {
              initialPrices[position.symbol] = { ltp: position.current_price };
            });
          }
          
          // Legacy holdings (for backward compatibility)
          if (data.holdings) {
            data.holdings.forEach(holding => {
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

  const processedPortfolio = useMemo(() => {
    if (!portfolioData) return null;

    // Process CNC holdings
    const cncHoldingsWithLiveData = (portfolioData.cnc_holdings || []).map(holding => {
      const livePrice = livePrices[holding.symbol]?.ltp || holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      return { ...holding, ltp: livePrice, market_value, unrealized_pnl, product_type: 'CNC' };
    });

    // Process MIS holdings
    const misHoldingsWithLiveData = (portfolioData.mis_holdings || []).map(holding => {
      const livePrice = livePrices[holding.symbol]?.ltp || holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      return { ...holding, ltp: livePrice, market_value, unrealized_pnl, product_type: 'MIS' };
    });

    // Process short positions
    const shortPositionsWithLiveData = (portfolioData.short_positions || []).map(position => {
      const livePrice = livePrices[position.symbol]?.ltp || position.current_price;
      const unrealized_pnl = (position.short_price - livePrice) * position.quantity;
      return { ...position, current_price: livePrice, unrealized_pnl };
    });

    // Legacy holdings (for backward compatibility)
    const legacyHoldingsWithLiveData = (portfolioData.holdings || []).map(holding => {
      const livePrice = livePrices[holding.symbol]?.ltp || holding.ltp;
      const market_value = livePrice * holding.quantity;
      const unrealized_pnl = market_value - holding.investment_value;
      return { ...holding, ltp: livePrice, market_value, unrealized_pnl };
    });

    // Calculate totals
    const allHoldings = [...cncHoldingsWithLiveData, ...misHoldingsWithLiveData, ...legacyHoldingsWithLiveData];
    const current_holdings_value = allHoldings.reduce((sum, h) => sum + h.market_value, 0);
    const unrealized_pnl = current_holdings_value - portfolioData.summary.total_investment + 
                          shortPositionsWithLiveData.reduce((sum, sp) => sum + sp.unrealized_pnl, 0);
    const total_portfolio_value = portfolioData.summary.cash_balance + current_holdings_value;
    const total_pnl = unrealized_pnl + portfolioData.summary.realized_pnl;

    return {
      summary: { ...portfolioData.summary, holdings_value: current_holdings_value, unrealized_pnl, total_portfolio_value, total_pnl },
      cncHoldings: cncHoldingsWithLiveData,
      misHoldings: misHoldingsWithLiveData,
      shortPositions: shortPositionsWithLiveData,
      holdings: legacyHoldingsWithLiveData, // For backward compatibility
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

  const { summary, cncHoldings, misHoldings, shortPositions, holdings: legacyHoldings } = processedPortfolio;

  const HoldingsTable = ({ holdings, title, showProductType = false }) => (
    <Card>
      <CardHeader>
        <CardTitle>{title} ({holdings.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              {showProductType && <TableHead>Type</TableHead>}
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Avg. Price</TableHead>
              <TableHead className="text-right">LTP</TableHead>
              <TableHead className="text-right">Market Value</TableHead>
              <TableHead className="text-right">Unrealized P/L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.length > 0 ? (
              holdings.map((holding, idx) => (
                <TableRow key={`${holding.symbol}-${idx}`}>
                  <TableCell className="font-medium">{holding.symbol}</TableCell>
                  {showProductType && <TableCell><span className={`text-xs px-2 py-1 rounded ${holding.product_type === 'MIS' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>{holding.product_type}</span></TableCell>}
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
                <TableCell colSpan={showProductType ? 7 : 6} className="text-center">No holdings in this category.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  const ShortPositionsTable = ({ positions }) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowDownCircle className="h-5 w-5 text-orange-600" />
          Short Positions ({positions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Short Price</TableHead>
              <TableHead className="text-right">Current Price</TableHead>
              <TableHead className="text-right">Unrealized P/L</TableHead>
              <TableHead className="text-right">Short Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length > 0 ? (
              positions.map((position, idx) => (
                <TableRow key={`${position.symbol}-${idx}`}>
                  <TableCell className="font-medium">{position.symbol}</TableCell>
                  <TableCell className="text-right">{position.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(position.short_price)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(position.current_price)}</TableCell>
                  <TableCell className={`text-right font-medium ${getPnlColor(position.unrealized_pnl)}`}>
                    {formatCurrency(position.unrealized_pnl)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-600">
                    {new Date(position.short_date).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center">No short positions.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

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

      {/* Show tabs if we have new backend structure, otherwise show legacy view */}
      {(cncHoldings.length > 0 || misHoldings.length > 0 || shortPositions.length > 0) ? (
        <Tabs defaultValue="cnc" className="space-y-4">
          <TabsList>
            <TabsTrigger value="cnc">CNC Holdings ({cncHoldings.length})</TabsTrigger>
            <TabsTrigger value="mis">MIS Holdings ({misHoldings.length})</TabsTrigger>
            <TabsTrigger value="short">Short Positions ({shortPositions.length})</TabsTrigger>
          </TabsList>
          
          <TabsContent value="cnc">
            <HoldingsTable holdings={cncHoldings} title="CNC (Delivery) Holdings" />
          </TabsContent>
          
          <TabsContent value="mis">
            <HoldingsTable holdings={misHoldings} title="MIS (Intraday) Holdings" />
            {misHoldings.length > 0 && (
              <p className="text-sm text-orange-600 mt-2 flex items-center gap-1">
                <Info className="h-4 w-4" />
                MIS positions will auto square-off at 3:25 PM IST
              </p>
            )}
          </TabsContent>
          
          <TabsContent value="short">
            <ShortPositionsTable positions={shortPositions} />
            {shortPositions.length > 0 && (
              <p className="text-sm text-orange-600 mt-2 flex items-center gap-1">
                <Info className="h-4 w-4" />
                Short positions must be covered by 3:25 PM IST
              </p>
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <HoldingsTable holdings={legacyHoldings} title="Holdings" showProductType={true} />
      )}
    </motion.div>
  );
};

export default PortfolioPage;
