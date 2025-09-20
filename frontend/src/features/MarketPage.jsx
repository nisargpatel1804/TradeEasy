import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/assets/ui/card';
import { Button } from '@/assets/ui/button';
import { Input } from '@/assets/ui/input';
import { Skeleton } from '@/assets/ui/skeleton';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { 
  RefreshCw, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpCircle,
  ArrowDownCircle,
  Activity,
  Info
} from 'lucide-react';
// ✅ Import the new API function for fetching market stocks
import { fetchMarketStocks } from '@/services/api'; 
import Navbar from '@/features/Navbar';

const Market = () => {
  const navigate = useNavigate();
  // ✅ Rename state for better reusability
  const [marketData, setMarketData] = useState({ stocks: [], total_count: 0, gainers_count: 0, losers_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  // ✅ 'filter' is a more accurate name for the state controlled by the buttons
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'gainers', 'losers'

  // This function remains the same, it's good local utility logic.
  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const day = istTime.getDay();
    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    
    if (day === 0 || day === 6) return false;
    
    const currentMinutes = hour * 60 + minute;
    const marketOpen = 9 * 60 + 15;
    const marketClose = 15 * 60 + 30;
    
    return currentMinutes >= marketOpen && currentMinutes <= marketClose;
  };

  // ✅ FIX: Fetch real market data using the new API service
  const fetchMarketData = async () => {
    try {
      // Don't set loading to true on background refreshes, only on the initial load.
      if (!marketData.stocks.length) {
        setLoading(true);
      }
      setError(null);
      
      const data = await fetchMarketStocks('nifty50');
      
      setMarketData(data);
      setLastUpdated(new Date());
      toast.success("Market data updated!");
      
    } catch (err) {
      console.error('Error fetching Nifty 50 data:', err);
      setError(err.message || 'Failed to fetch market data');
      toast.error(err.message || 'Failed to fetch market data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
    
    const marketOpen = isMarketOpen();
    // Refresh every minute when open, every 5 minutes when closed
    const refreshInterval = marketOpen ? 60000 : 300000; 
    
    const interval = setInterval(fetchMarketData, refreshInterval);
    
    return () => clearInterval(interval);
  }, []);

  // ✅ REFACTOR: Use `useMemo` for performance and simplify filtering/sorting logic.
  const filteredAndSortedStocks = useMemo(() => {
    if (!marketData?.stocks) return [];
    
    let stocks = [...marketData.stocks];
    
    // 1. Filter by active tab (Gainers / Losers / All)
    if (activeFilter === 'gainers') {
      stocks = stocks.filter(stock => stock.percent_change > 0);
    } else if (activeFilter === 'losers') {
      stocks = stocks.filter(stock => stock.percent_change < 0);
    }
    
    // 2. Filter by search query on the already filtered list
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      stocks = stocks.filter(stock => 
        stock.symbol.toLowerCase().includes(query) ||
        (stock.name && stock.name.toLowerCase().includes(query))
      );
    }
    
    // 3. Sort the final list
    stocks.sort((a, b) => {
      if (activeFilter === 'gainers') {
        return b.percent_change - a.percent_change; // Highest gainer first
      }
      if (activeFilter === 'losers') {
        return a.percent_change - b.percent_change; // Biggest loser first
      }
      return a.symbol.localeCompare(b.symbol); // Default A-Z sort
    });
    
    return stocks;
  }, [marketData, searchQuery, activeFilter]);

  const handleStockClick = (symbol) => {
    navigate(`/stock/overview/${symbol}`);
  };

  const formatNumber = (value, decimals = 2) => {
    if (value === undefined || value === null || isNaN(value)) return 'N/A';
    return Number(value).toFixed(decimals);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8 mt-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="shadow-lg">
            <CardHeader className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <Activity className="h-6 w-6 text-blue-600" />
                    Nifty 50 Market
                  </CardTitle>
                  <p className="text-gray-600 mt-1">
                    Real-time stock prices and market movers
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  {lastUpdated && (
                    <div className="flex items-center text-sm text-gray-500">
                      <Info className="h-4 w-4 mr-1" />
                      Updated: {lastUpdated.toLocaleTimeString()}
                    </div>
                  )}
                  <Button 
                    onClick={fetchMarketData}
                    disabled={loading}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Search and Filter Controls */}
              <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search stocks by name or symbol..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                
                <div className="flex bg-gray-100 rounded-lg p-1">
                  {[
                    { id: 'all', label: 'All Stocks', icon: Activity },
                    { id: 'gainers', label: 'Top Gainers', icon: TrendingUp },
                    { id: 'losers', label: 'Top Losers', icon: TrendingDown }
                  ].map(({ id, label, icon: Icon }) => (
                    <Button
                      key={id}
                      variant={activeFilter === id ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setActiveFilter(id)}
                      className={`flex items-center gap-2 ${
                        activeFilter === id 
                          ? 'bg-white shadow-sm' 
                          : 'hover:bg-white/50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-4">
                        <Skeleton className="h-10 w-10 rounded" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                      <div className="text-right space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <div className="text-red-500 mb-2 font-semibold">Error loading market data</div>
                  <p className="text-gray-600 mb-4">{error}</p>
                  <Button onClick={fetchMarketData} variant="outline">
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-5 gap-4 px-4 py-3 bg-gray-50 rounded-lg text-sm font-medium text-gray-700">
                    <div>Stock</div>
                    <div className="text-right">Price (₹)</div>
                    <div className="text-right">Change (₹)</div>
                    <div className="text-right">Change (%)</div>
                    <div className="text-right">Action</div>
                  </div>

                  <AnimatePresence>
                    {filteredAndSortedStocks.length > 0 ? (
                      filteredAndSortedStocks.map((stock, index) => {
                        const isPositive = stock.percent_change >= 0;
                        const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
                        const bgColor = isPositive ? 'bg-green-50' : 'bg-red-50';
                        
                        return (
                          <motion.div
                            key={stock.symbol}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: index * 0.02, duration: 0.2 }}
                            className={`grid grid-cols-5 gap-4 px-4 py-3 border rounded-lg hover:shadow-md transition-shadow cursor-pointer ${bgColor} border-l-4 ${isPositive ? 'border-l-green-500' : 'border-l-red-500'}`}
                            onClick={() => handleStockClick(stock.symbol)}
                          >
                            <div className="flex items-center">
                              <div>
                                <div className="font-semibold text-gray-900 stock-symbol">
                                  {stock.symbol}
                                </div>
                                <div className="text-sm text-gray-600 stock-name truncate">
                                  {stock.name}
                                </div>
                              </div>
                            </div>
                            
                            <div className="text-right self-center">
                              <div className="font-semibold stock-price">
                                ₹{formatNumber(stock.price)}
                              </div>
                            </div>
                            
                            <div className={`text-right font-semibold stock-change self-center ${changeColor}`}>
                              {isPositive ? '+' : ''}{formatNumber(stock.change)}
                            </div>
                            
                            <div className={`text-right font-semibold stock-percentage self-center ${changeColor}`}>
                              {isPositive ? '+' : ''}{formatNumber(stock.percent_change)}%
                            </div>
                            
                            <div className="text-right self-center">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStockClick(stock.symbol);
                                }}
                              >
                                View
                              </Button>
                            </div>
                          </motion.div>
                        );
                      })
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        {searchQuery ? 'No stocks match your search' : 'No stocks to display for this filter.'}
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {marketData.stocks.length > 0 && !loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-blue-600 font-medium">Total Stocks</p>
                        <p className="text-xl font-bold text-blue-900">{marketData.total_count}</p>
                      </div>
                      <Activity className="h-8 w-8 text-blue-500" />
                    </div>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-green-600 font-medium">Gainers</p>
                        <p className="text-xl font-bold text-green-900">{marketData.gainers_count}</p>
                      </div>
                      <ArrowUpCircle className="h-8 w-8 text-green-500" />
                    </div>
                  </div>
                  
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-red-600 font-medium">Losers</p>
                        <p className="text-xl font-bold text-red-900">{marketData.losers_count}</p>
                      </div>
                      <ArrowDownCircle className="h-8 w-8 text-red-500" />
                    </div>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
};

export default Market;