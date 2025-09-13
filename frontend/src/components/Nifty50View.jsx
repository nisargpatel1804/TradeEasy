import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { Input } from '@/ui/input';
import { toast } from 'react-hot-toast';
import { motion } from 'framer-motion';
import { 
  RefreshCw, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { fetchData } from '@/services/api';
import Navbar from '@/components/Navbar';
import '../assets/css/StockMarketView.css';

const Nifty50View = () => {
  const [stocksData, setStocksData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [marketOpen, setMarketOpen] = useState(false);

  // Fetch Nifty 50 data
  const fetchNifty50Data = async (sort_by = 'name', sort_order = 'asc') => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetchData(`/markets/nifty50?sort_by=${sort_by}&sort_order=${sort_order}`);
      
      if (response && !response.error) {
        setStocksData(response.stocks || []);
        setMarketOpen(response.market_open || false);
        setLastUpdated(new Date().toLocaleTimeString());
        setSortBy(sort_by);
        setSortOrder(sort_order);
      } else {
        setError(response?.error || 'Failed to fetch data');
      }
    } catch (err) {
      setError('Failed to fetch Nifty 50 data');
      console.error('Error fetching Nifty 50 data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial data fetch
  useEffect(() => {
    fetchNifty50Data();
    
    // Auto-refresh only when market is open
    const interval = setInterval(() => {
      if (marketOpen) {
        fetchNifty50Data(sortBy, sortOrder);
      }
    }, 10000); // Refresh every 10 seconds when market is open
    
    return () => clearInterval(interval);
  }, [marketOpen, sortBy, sortOrder]);

  // Handle refresh
  const handleRefresh = async () => {
    toast.promise(fetchNifty50Data(sortBy, sortOrder), {
      loading: 'Refreshing Nifty 50 data...',
      success: 'Data refreshed successfully!',
      error: 'Failed to refresh data'
    });
  };

  // Handle sorting
  const handleSort = (newSortBy) => {
    let newSortOrder = 'asc';
    
    if (newSortBy === sortBy) {
      // Toggle order if same column
      newSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else if (newSortBy === 'gainers' || newSortBy === 'losers') {
      // For gainers/losers, first click shows highest first
      newSortOrder = 'desc';
    }
    
    fetchNifty50Data(newSortBy, newSortOrder);
  };

  // Filter stocks based on search
  const filteredStocks = stocksData.filter(stock => 
    stock.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    stock.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format price change display
  const formatPriceChange = (change, percent_change) => {
    const changeValue = parseFloat(change) || 0;
    const percentValue = parseFloat(percent_change) || 0;
    const isPositive = changeValue >= 0;
    
    return (
      <div className={`flex items-center ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
        <span className="ml-1">
          ₹{Math.abs(changeValue).toFixed(2)} ({Math.abs(percentValue).toFixed(2)}%)
        </span>
      </div>
    );
  };

  // Get sort icon
  const getSortIcon = (column) => {
    if (sortBy !== column) return <ArrowUpDown size={16} className="ml-1" />;
    return sortOrder === 'asc' ? 
      <ArrowUp size={16} className="ml-1" /> : 
      <ArrowDown size={16} className="ml-1" />;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="container mx-auto p-4">
        <Card className="w-full">
        <CardHeader className="space-y-4">
          <div className="flex justify-between items-center">
            <CardTitle className="text-2xl font-bold">
              Nifty 50 Stocks
              {marketOpen && (
                <span className="ml-2 text-sm bg-green-100 text-green-800 px-2 py-1 rounded-full">
                  Market Open
                </span>
              )}
            </CardTitle>
            <div className="flex items-center space-x-2">
              {lastUpdated && (
                <span className="text-sm text-gray-500">
                  Last updated: {lastUpdated}
                </span>
              )}
              <Button
                onClick={handleRefresh}
                disabled={isLoading}
                variant="outline"
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Search and Sort Controls */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center space-x-2 flex-1 min-w-[200px]">
              <Search size={18} />
              <Input
                type="text"
                placeholder="Search stocks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>
            
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={sortBy === 'gainers' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSort('gainers')}
                className="flex items-center"
              >
                <TrendingUp size={16} className="mr-1" />
                Gainers
                {getSortIcon('gainers')}
              </Button>
              
              <Button
                variant={sortBy === 'losers' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleSort('losers')}
                className="flex items-center"
              >
                <TrendingDown size={16} className="mr-1" />
                Losers
                {getSortIcon('losers')}
              </Button>
            </div>
          </div>

          {error && (
            <div className="error-message bg-red-50 border border-red-200 rounded p-3">
              Error: {error}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {/* Table Header */}
          <div className="grid grid-cols-4 gap-4 p-3 bg-gray-50 rounded-t-lg font-medium border-b">
            <button
              onClick={() => handleSort('name')}
              className="text-left flex items-center hover:text-blue-600"
            >
              Name
              {getSortIcon('name')}
            </button>
            <button
              onClick={() => handleSort('price')}
              className="text-right flex items-center justify-end hover:text-blue-600"
            >
              Price
              {getSortIcon('price')}
            </button>
            <button
              onClick={() => handleSort('change')}
              className="text-right flex items-center justify-end hover:text-blue-600"
            >
              Change
              {getSortIcon('change')}
            </button>
            <button
              onClick={() => handleSort('percent_change')}
              className="text-right flex items-center justify-end hover:text-blue-600"
            >
              % Change
              {getSortIcon('percent_change')}
            </button>
          </div>

          {/* Table Body */}
          <div className="divide-y">
            {isLoading ? (
              // Loading skeletons
              Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="grid grid-cols-4 gap-4 p-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                  <Skeleton className="h-4 w-20 ml-auto" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                </div>
              ))
            ) : filteredStocks.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchQuery ? 'No stocks match your search' : 'No data available'}
              </div>
            ) : (
              filteredStocks.map((stock, index) => (
                <motion.div
                  key={stock.symbol}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="grid grid-cols-4 gap-4 p-3 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <div className="font-medium">{stock.name}</div>
                    <div className="text-sm text-gray-500">{stock.symbol}</div>
                  </div>
                  <div className="text-right font-medium">
                    ₹{parseFloat(stock.price || 0).toFixed(2)}
                  </div>
                  <div className="text-right">
                    ₹{parseFloat(stock.change || 0).toFixed(2)}
                  </div>
                  <div className="text-right">
                    {formatPriceChange(stock.change, stock.percent_change)}
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Summary */}
          {!isLoading && filteredStocks.length > 0 && (
            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              Showing {filteredStocks.length} of {stocksData.length} stocks
              {searchQuery && ` (filtered by "${searchQuery}")`}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
};

export default Nifty50View;
