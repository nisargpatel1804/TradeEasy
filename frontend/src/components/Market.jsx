import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Skeleton } from '@/ui/skeleton';
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
import { getNifty50Stocks, getTopGainers, getTopLosers } from '@/services/api';
import Navbar from '@/components/Navbar';
import '../assets/css/StockMarketView.css';

const Market = () => {
  const navigate = useNavigate();
  const [niftyData, setNiftyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'symbol', direction: 'asc' }); // Default A-Z sorting

  // Handle sorting logic
  const handleSort = (sortKey) => {
    let direction = 'asc';
    
    if (sortConfig.key === sortKey) {
      // If clicking the same key, toggle direction
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    } else {
      // New sort key - set default direction based on key type
      if (sortKey === 'gainers' || sortKey === 'losers') {
        direction = 'desc'; // Highest first for gainers/losers
      } else {
        direction = 'asc'; // A-Z for symbol, lowest first for others
      }
    }
    
    setSortConfig({ key: sortKey, direction });
  };

  // Check if market is open (for refresh intervals)
  const isMarketOpen = () => {
    const now = new Date();
    const istTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    const day = istTime.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = istTime.getHours();
    const minute = istTime.getMinutes();
    
    // Check if it's a weekday (Monday=1 to Friday=5)
    if (day === 0 || day === 6) return false;
    
    // Market hours: 9:15 AM to 3:30 PM IST
    const currentMinutes = hour * 60 + minute;
    const marketOpen = 9 * 60 + 15; // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM
    
    return currentMinutes >= marketOpen && currentMinutes <= marketClose;
  };

  // Fetch Nifty 50 data
  const fetchNiftyData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getNifty50Stocks();
      
      if (data.error) {
        setError(data.error);
        return;
      }
      
      setNiftyData(data);
      setLastUpdated(new Date());
      
    } catch (err) {
      console.error('Error fetching Nifty 50 data:', err);
      setError('Failed to fetch market data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNiftyData();
    
    // Optimize refresh interval based on market status
    const marketOpen = isMarketOpen();
    const refreshInterval = marketOpen ? 30000 : 300000; // 30s when open, 5min when closed
    
    const interval = setInterval(fetchNiftyData, refreshInterval);
    
    return () => clearInterval(interval);
  }, []);

  // Filter and sort stocks based on search query and sort configuration
  const getFilteredAndSortedStocks = () => {
    if (!niftyData?.stocks) return [];
    
    let stocks = [...niftyData.stocks];
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      stocks = stocks.filter(stock => 
        stock.symbol.toLowerCase().includes(query) ||
        stock.name.toLowerCase().includes(query)
      );
    }
    
    // Apply sorting
    stocks.sort((a, b) => {
      let comparison = 0;
      
      switch (sortConfig.key) {
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case 'gainers':
          // Only show gainers and sort by percent_change
          if (a.percent_change <= 0 && b.percent_change <= 0) comparison = 0;
          else if (a.percent_change <= 0) comparison = 1;
          else if (b.percent_change <= 0) comparison = -1;
          else comparison = a.percent_change - b.percent_change;
          break;
        case 'losers':
          // Only show losers and sort by percent_change
          if (a.percent_change >= 0 && b.percent_change >= 0) comparison = 0;
          else if (a.percent_change >= 0) comparison = 1;
          else if (b.percent_change >= 0) comparison = -1;
          else comparison = a.percent_change - b.percent_change;
          break;
        case 'price':
          comparison = a.price - b.price;
          break;
        case 'change':
          comparison = a.percent_change - b.percent_change;
          break;
        default:
          comparison = a.symbol.localeCompare(b.symbol);
      }
      
      return sortConfig.direction === 'desc' ? -comparison : comparison;
    });
    
    // Filter out stocks that don't match the sort criteria
    if (sortConfig.key === 'gainers') {
      stocks = stocks.filter(stock => stock.percent_change > 0);
    } else if (sortConfig.key === 'losers') {
      stocks = stocks.filter(stock => stock.percent_change < 0);
    }
    
    return stocks;
  };

  const handleStockClick = (symbol) => {
    navigate(`/stock/overview/${symbol}`);
  };

  const formatNumber = (value, decimals = 2) => {
    if (value === undefined || value === null || isNaN(value)) return 'N/A';
    return Number(value).toFixed(decimals);
  };

  const filteredStocks = getFilteredAndSortedStocks();

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
                    onClick={fetchNiftyData}
                    disabled={loading}
                    variant="outline"
                    size="sm"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </div>

              {/* Search and Sort Controls */}
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
                    { id: 'symbol', label: 'A-Z', icon: Activity },
                    { id: 'gainers', label: 'Gainers', icon: TrendingUp },
                    { id: 'losers', label: 'Losers', icon: TrendingDown }
                  ].map(({ id, label, icon: Icon }) => (
                    <Button
                      key={id}
                      variant={sortConfig.key === id ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => handleSort(id)}
                      className={`flex items-center gap-2 ${
                        sortConfig.key === id 
                          ? 'bg-white shadow-sm' 
                          : 'hover:bg-white/50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {sortConfig.key === id && (
                        <span className="text-xs">
                          {sortConfig.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent>
              {loading && !niftyData ? (
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
                  <div className="text-red-500 mb-2">Error loading market data</div>
                  <p className="text-gray-600 mb-4">{error}</p>
                  <Button onClick={fetchNiftyData} variant="outline">
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-5 gap-4 px-4 py-3 bg-gray-50 rounded-lg text-sm font-medium text-gray-700">
                    <div>Stock</div>
                    <div className="text-right">Price (₹)</div>
                    <div className="text-right">Change (₹)</div>
                    <div className="text-right">Change (%)</div>
                    <div className="text-right">Action</div>
                  </div>

                  {/* Stock List */}
                  <AnimatePresence>
                    {filteredStocks.length > 0 ? (
                      filteredStocks.map((stock, index) => {
                        const isPositive = stock.percent_change >= 0;
                        const changeColor = isPositive ? 'text-green-600' : 'text-red-600';
                        const bgColor = isPositive ? 'bg-green-50' : 'bg-red-50';
                        
                        return (
                          <motion.div
                            key={stock.symbol}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: index * 0.02 }}
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
                            
                            <div className="text-right">
                              <div className="font-semibold stock-price">
                                ₹{formatNumber(stock.price)}
                              </div>
                            </div>
                            
                            <div className={`text-right font-semibold stock-change ${changeColor}`}>
                              {isPositive ? '+' : ''}₹{formatNumber(stock.change)}
                            </div>
                            
                            <div className={`text-right font-semibold stock-percentage ${changeColor}`}>
                              {isPositive ? '+' : ''}{formatNumber(stock.percent_change)}%
                            </div>
                            
                            <div className="text-right">
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
                        {searchQuery ? 'No stocks match your search' : 'No stocks available'}
                      </div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Summary Stats */}
              {niftyData && !loading && (
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
                        <p className="text-xl font-bold text-blue-900">{niftyData.total_count}</p>
                      </div>
                      <Activity className="h-8 w-8 text-blue-500" />
                    </div>
                  </div>
                  
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-green-600 font-medium">Gainers</p>
                        <p className="text-xl font-bold text-green-900">{niftyData.gainers?.length || 0}</p>
                      </div>
                      <ArrowUpCircle className="h-8 w-8 text-green-500" />
                    </div>
                  </div>
                  
                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-red-600 font-medium">Losers</p>
                        <p className="text-xl font-bold text-red-900">{niftyData.losers?.length || 0}</p>
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
