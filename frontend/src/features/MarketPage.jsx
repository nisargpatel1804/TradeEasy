import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../assets/ui/card.jsx';
import { Button } from '../assets/ui/button.jsx';
import { Input } from '../assets/ui/input.jsx';
import { Skeleton } from '../assets/ui/skeleton.jsx';
import { RefreshCw, Search, TrendingUp, TrendingDown, Activity, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import * as api from '../services/api.js';
import priceUpdateService from '../services/priceUpdateService.js';

const MarketPage = () => {
  const navigate = useNavigate();
  const [marketData, setMarketData] = useState({ stocks: [], gainers: 0, losers: 0, total_count: 0 });
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'gainers', 'losers'

  const fetchMarketData = async () => {
    // Only show full skeleton on initial load
    if (!marketData.stocks.length) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await api.fetchMarketStocks('nifty50');
      if (data.success) {
        setMarketData(data);
        // Set initial prices for the live update mechanism
        const initialPriceMap = data.stocks.reduce((acc, stock) => {
          acc[stock.symbol] = {
            price: stock.price,
            change: stock.change,
            percent_change: stock.percent_change,
          };
          return acc;
        }, {});
        setLivePrices(initialPriceMap);
      } else {
        throw new Error(data.message || 'Failed to fetch market data');
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Could not load market data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
  }, []);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        const mergePrices = (source) => {
          if (!source || Object.keys(source).length === 0) {
            return null;
          }

          const normalized = {};

          for (const [symbol, value] of Object.entries(source)) {
            if (!value) continue;

            const existing = currentPrices[symbol] || {};
            const mergedEntry = {
              ...existing,
              ...value,
            };

            if (typeof value.ltp === 'number') {
              mergedEntry.price = value.ltp;
            } else if (typeof value.price === 'number') {
              mergedEntry.price = value.price;
            }

            normalized[symbol] = mergedEntry;
          }

          return Object.keys(normalized).length > 0 ? normalized : null;
        };

        if (update?.type === 'reset') {
          return currentPrices;
        }

        if (update?.type === 'snapshot') {
          const mergedSnapshot = mergePrices(update?.allPrices);
          return mergedSnapshot ? { ...currentPrices, ...mergedSnapshot } : currentPrices;
        }

        const mergedChanges = mergePrices(update?.changedPrices);
        return mergedChanges ? { ...currentPrices, ...mergedChanges } : currentPrices;
      });
    });

    return () => unsubscribe();
  }, []);

  const processedStocks = useMemo(() => {
    let stocks = marketData.stocks.map(stock => {
      const liveData = livePrices[stock.symbol];
      return liveData ? { ...stock, ...liveData } : stock;
    });

    if (activeFilter === 'gainers') {
      stocks = stocks.filter(s => s.change > 0);
    } else if (activeFilter === 'losers') {
      stocks = stocks.filter(s => s.change < 0);
    }

    if (searchQuery) {
      const lowerCaseQuery = searchQuery.toLowerCase();
      stocks = stocks.filter(s =>
        s.symbol.toLowerCase().includes(lowerCaseQuery) ||
        s.name.toLowerCase().includes(lowerCaseQuery)
      );
    }

    // Sort based on filter
    if (activeFilter === 'gainers') {
      return stocks.sort((a, b) => b.percent_change - a.percent_change);
    }
    if (activeFilter === 'losers') {
      return stocks.sort((a, b) => a.percent_change - b.percent_change);
    }
    return stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [marketData.stocks, livePrices, activeFilter, searchQuery]);

  const formatNumber = (value) => {
    const num = parseFloat(value);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  };

  const getChangeColor = (change) => {
    const num = parseFloat(change);
    if (num > 0) return 'text-green-600';
    if (num < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const handleStockClick = (symbol) => {
    // Assuming a route like /stock/:symbol
    navigate(`/stock/${symbol.split('.')[0]}`);
  };

  const renderStockList = () => {
    if (isLoading) {
      return Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex-1 text-right space-y-2">
            <Skeleton className="h-4 w-16 ml-auto" />
            <Skeleton className="h-3 w-20 ml-auto" />
          </div>
        </div>
      ));
    }

    if (error) {
      return <div className="p-6 text-center text-red-500">{error}</div>;
    }

    return (
      <AnimatePresence>
        {processedStocks.map((stock, index) => (
          <motion.div
            key={stock.symbol}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, delay: index * 0.02 }}
            className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            onClick={() => handleStockClick(stock.symbol)}
          >
            <div className="flex-1 truncate">
              <p className="font-semibold text-sm">{stock.symbol}</p>
              <p className="text-xs text-gray-500 truncate">{stock.name}</p>
            </div>
            <div className="flex-1 text-right">
              <p className="font-semibold text-sm">₹{formatNumber(stock.price)}</p>
              <p className={`text-xs font-medium ${getChangeColor(stock.change)}`}>
                {stock.change > 0 ? '+' : ''}{formatNumber(stock.change)} ({stock.percent_change > 0 ? '+' : ''}{formatNumber(stock.percent_change)}%)
              </p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    );
  };

  return (
      <div className="p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col sm:flex-row justify-between sm:items-center mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Nifty 50 Movers</h1>
            <p className="text-sm text-gray-500">Live performance of Nifty 50 constituent stocks.</p>
          </div>
          <Button onClick={() => fetchMarketData()} disabled={isLoading} variant="outline">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Stocks</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{marketData.total_count || 0}</div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Gainers</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-green-600">{marketData.gainers || 0}</div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Losers</CardTitle>
                    <TrendingDown className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-red-600">{marketData.losers || 0}</div>
                </CardContent>
            </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search in Nifty 50..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button variant={activeFilter === 'all' ? 'default' : 'outline'} onClick={() => setActiveFilter('all')}>All</Button>
                <Button variant={activeFilter === 'gainers' ? 'default' : 'outline'} onClick={() => setActiveFilter('gainers')}>Gainers</Button>
                <Button variant={activeFilter === 'losers' ? 'default' : 'outline'} onClick={() => setActiveFilter('losers')}>Losers</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[60vh] overflow-y-auto">
              {renderStockList()}
            </div>
          </CardContent>
        </Card>
      </div>
  );
};

export default MarketPage;

