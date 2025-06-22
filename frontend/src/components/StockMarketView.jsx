import React, { useState, useEffect } from 'react';
import { useDataContext } from '@/services/DataContext';
import { BSE30_SYMBOLS, NSE50_SYMBOLS } from '@/services/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { Input } from '@/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/Tabs';
import { toast } from 'react-hot-toast';
import Navbar from '@/components/Navbar';
import { motion } from 'framer-motion';
import { RefreshCw, Search, TrendingUp, TrendingDown, SortAsc, SortDesc, Info } from 'lucide-react';
import '../assets/css/StockMarketView.css';

const StockMarketView = () => {
  const { 
    stocksData, 
    isLoadingStocks, 
    stocksError, 
    refreshStocksData,
    stocksLastUpdated
  } = useDataContext();
  
  // State for filtering and sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('symbol');
  const [sortDirection, setSortDirection] = useState('asc');
  const [visibleSymbols, setVisibleSymbols] = useState({ 
    bse: [...BSE30_SYMBOLS],
    nse: [...NSE50_SYMBOLS]
  });
  
  // Handle refresh
  const handleRefresh = async () => {
    toast.promise(refreshStocksData(), {
      loading: 'Refreshing stock data...',
      success: 'Stock data refreshed successfully!',
      error: 'Failed to refresh stock data'
    });
  };
  
  // Filter stocks based on search query
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setVisibleSymbols({
        bse: [...BSE30_SYMBOLS],
        nse: [...NSE50_SYMBOLS]
      });
      return;
    }
    
    const query = searchQuery.toLowerCase();
    
    setVisibleSymbols({
      bse: BSE30_SYMBOLS.filter(symbol => {
        const baseSymbol = symbol.split('.')[0].toLowerCase();
        return baseSymbol.includes(query);
      }),
      nse: NSE50_SYMBOLS.filter(symbol => {
        const baseSymbol = symbol.split('.')[0].toLowerCase();
        return baseSymbol.includes(query);
      })
    });
  }, [searchQuery]);
  
  // Sort stocks
  const sortStocks = (stocks) => {
    if (!stocks || !stocksData || !stocksData.data) return stocks;
    
    return [...stocks].sort((a, b) => {
      const stockA = stocksData.data[a];
      const stockB = stocksData.data[b];
      
      // Handle missing data
      if (!stockA && !stockB) return 0;
      if (!stockA) return 1;
      if (!stockB) return -1;
      
      let comparison = 0;
      switch (sortBy) {
        case 'symbol':
          comparison = a.localeCompare(b);
          break;
        case 'price':
          comparison = stockA.price - stockB.price;
          break;
        case 'change':
          comparison = stockA.price_change - stockB.price_change;
          break;
        case 'percent':
          comparison = stockA.percent_change - stockB.percent_change;
          break;
        default:
          comparison = a.localeCompare(b);
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };
  
  // Toggle sort direction
  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDirection('asc');
    }
  };
  
  // Format date for display
  const formatDateTime = (date) => {
    if (!date) return 'Never';
    
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  };
  
  // Format number with thousands separator
  const formatNumber = (value, decimalPlaces = 2) => {
    if (value === undefined || value === null || isNaN(value)) return 'N/A';
    return Number(value).toFixed(decimalPlaces);
  };
  
  // Render table header with sort indicators
  const renderTableHeader = () => (
    <div className="stock-table-header">
      <div 
        className="header-cell symbol-cell" 
        onClick={() => toggleSort('symbol')}
      >
        Symbol
        {sortBy === 'symbol' && (
          sortDirection === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />
        )}
      </div>
      <div 
        className="header-cell price-cell" 
        onClick={() => toggleSort('price')}
      >
        Price
        {sortBy === 'price' && (
          sortDirection === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />
        )}
      </div>
      <div 
        className="header-cell change-cell" 
        onClick={() => toggleSort('change')}
      >
        Change
        {sortBy === 'change' && (
          sortDirection === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />
        )}
      </div>
      <div 
        className="header-cell percent-cell" 
        onClick={() => toggleSort('percent')}
      >
        % Change
        {sortBy === 'percent' && (
          sortDirection === 'asc' ? <SortAsc size={14} /> : <SortDesc size={14} />
        )}
      </div>
    </div>
  );
  
  // Render a stock row
  const renderStockRow = (symbol) => {
    const stockData = stocksData?.data?.[symbol];
    
    if (!stockData) {
      return (
        <div key={symbol} className="stock-row">
          <div className="stock-cell symbol-cell">{symbol.split('.')[0]}</div>
          <div className="stock-cell price-cell">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="stock-cell change-cell">
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="stock-cell percent-cell">
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      );
    }
    
    const { price, price_change, percent_change } = stockData;
    const isPositive = price_change >= 0;
    
    return (
      <div key={symbol} className="stock-row">
        <div className="stock-cell symbol-cell">{symbol.split('.')[0]}</div>
        <div className="stock-cell price-cell">₹{formatNumber(price)}</div>
        <div className={`stock-cell change-cell ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{formatNumber(price_change)}
        </div>
        <div className={`stock-cell percent-cell ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}{formatNumber(percent_change)}%
        </div>
      </div>
    );
  };
  
  return (
    <div className="stock-market-view">
      <Navbar />
      
      <main className="stock-market-main">
        <motion.div
          className="stock-market-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="stock-market-card">
            <CardHeader className="stock-market-header">
              <div className="header-row">
                <CardTitle className="stock-market-title">
                  Market Overview
                </CardTitle>
                <div className="header-actions">
                  <div className="last-updated">
                    <Info size={14} />
                    <span>Last updated: {formatDateTime(stocksLastUpdated)}</span>
                    <span className="update-hint">(Press Ctrl+Shift+R to refresh)</span>
                  </div>
                  <Button 
                    onClick={handleRefresh} 
                    disabled={isLoadingStocks}
                    className="refresh-button"
                  >
                    <RefreshCw size={16} className={isLoadingStocks ? 'spin' : ''} />
                    <span>{isLoadingStocks ? 'Refreshing...' : 'Refresh'}</span>
                  </Button>
                </div>
              </div>
              
              <div className="search-container">
                <Search size={18} />
                <Input
                  type="text"
                  placeholder="Search stocks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
              
              {stocksError && (
                <div className="error-message">
                  Error loading stock data: {stocksError}
                </div>
              )}
            </CardHeader>
            
            <CardContent className="stock-market-content">
              <Tabs defaultValue="bse" className="stock-market-tabs">
                <TabsList>
                  <TabsTrigger value="bse">BSE 30 (Sensex)</TabsTrigger>
                  <TabsTrigger value="nse">NSE 50 (Nifty)</TabsTrigger>
                </TabsList>
                
                <TabsContent value="bse" className="tab-content">
                  {renderTableHeader()}
                  
                  <div className="stock-rows-container">
                    {isLoadingStocks && !stocksData ? (
                      // Show skeletons if initial loading
                      Array.from({ length: 10 }).map((_, index) => (
                        <div key={index} className="stock-row">
                          <div className="stock-cell symbol-cell">
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <div className="stock-cell price-cell">
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <div className="stock-cell change-cell">
                            <Skeleton className="h-4 w-12" />
                          </div>
                          <div className="stock-cell percent-cell">
                            <Skeleton className="h-4 w-12" />
                          </div>
                        </div>
                      ))
                    ) : (
                      // Show sorted and filtered stocks
                      sortStocks(visibleSymbols.bse).map(symbol => renderStockRow(symbol))
                    )}
                    
                    {/* Show message if no stocks match search */}
                    {visibleSymbols.bse.length === 0 && (
                      <div className="no-results">
                        No stocks match your search criteria
                      </div>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="nse" className="tab-content">
                  {renderTableHeader()}
                  
                  <div className="stock-rows-container">
                    {isLoadingStocks && !stocksData ? (
                      // Show skeletons if initial loading
                      Array.from({ length: 10 }).map((_, index) => (
                        <div key={index} className="stock-row">
                          <div className="stock-cell symbol-cell">
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <div className="stock-cell price-cell">
                            <Skeleton className="h-4 w-16" />
                          </div>
                          <div className="stock-cell change-cell">
                            <Skeleton className="h-4 w-12" />
                          </div>
                          <div className="stock-cell percent-cell">
                            <Skeleton className="h-4 w-12" />
                          </div>
                        </div>
                      ))
                    ) : (
                      // Show sorted and filtered stocks
                      sortStocks(visibleSymbols.nse).map(symbol => renderStockRow(symbol))
                    )}
                    
                    {/* Show message if no stocks match search */}
                    {visibleSymbols.nse.length === 0 && (
                      <div className="no-results">
                        No stocks match your search criteria
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              
              <div className="instructions">
                <p><strong>💡 Tips:</strong></p>
                <ul>
                  <li>Click column headers to sort by that column</li>
                  <li>Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> to refresh all stock data</li>
                  <li>Data is cached to reduce API load and improve performance</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
};

export default StockMarketView; 