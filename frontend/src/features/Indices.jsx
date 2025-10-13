import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDataContext } from '../context/DataContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import priceUpdateService from '../services/priceUpdateService.js';
import { Card, CardContent, CardHeader, CardTitle } from '../assets/ui/card.jsx';
import { Skeleton } from '../assets/ui/skeleton.jsx';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../assets/ui/button.jsx';

const Indices = () => {
  const { indicesData: initialIndices, isLoadingIndices, indicesError, getInitialIndices } = useDataContext();
  const { isConnected } = useSocket();
  const [indices, setIndices] = useState([]);

  useEffect(() => {
    // Set initial data from context
    if (initialIndices && initialIndices.length > 0) {
      setIndices(initialIndices);
    }
  }, [initialIndices]);

  useEffect(() => {
    // Subscribe to real-time updates
    const onPriceUpdate = (data) => {
      setIndices(prevIndices => {
        const updatedIndices = { ...data.allPrices };
        // Create a map for efficient lookups
        const indexMap = new Map(prevIndices.map(i => [i.symbol, i]));

        // Update based on incoming data
        for (const symbol in updatedIndices) {
            if (indexMap.has(symbol)) {
                indexMap.set(symbol, { ...indexMap.get(symbol), ...updatedIndices[symbol] });
            }
        }
        return Array.from(indexMap.values());
      });
    };

    const unsubscribe = priceUpdateService.subscribe(onPriceUpdate);
    return () => unsubscribe();
  }, []);

  const formatNumber = (value) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return num.toFixed(2);
  };
  
  const getChangeColor = (change) => {
    const numChange = parseFloat(change);
    if (numChange > 0) return 'text-green-600';
    if (numChange < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const renderContent = () => {
    if (isLoadingIndices && indices.length === 0) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (indicesError) {
      return (
        <div className="text-center py-10">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
          <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-white">Could not load market data</h3>
          <p className="mt-1 text-sm text-gray-500">{indicesError}</p>
          <div className="mt-6">
            <Button onClick={() => getInitialIndices(true)}>Retry</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {indices.map((index, i) => (
          <motion.div
            key={index.symbol}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium truncate">{index.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatNumber(index.price)}</p>
                <p className={`text-sm font-semibold ${getChangeColor(index.change)}`}>
                  {index.change > 0 ? '+' : ''}
                  {formatNumber(index.change)} ({index.percent_change > 0 ? '+' : ''}{formatNumber(index.percent_change)}%)
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8">
       <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Market Overview</h1>
         <div className="flex items-center gap-2">
           <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} title={isConnected ? 'Live connection' : 'Disconnected'}></div>
           <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{isConnected ? 'Live' : 'Offline'}</span>
        </div>
      </div>
      {renderContent()}
    </div>
  );
};

export default Indices;

