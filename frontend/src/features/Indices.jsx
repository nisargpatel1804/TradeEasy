"use client"

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/assets/ui/card";
import { Button } from "@/assets/ui/button";
import { Skeleton } from "@/assets/ui/skeleton";
import Navbar from "@/features/Navbar";
import { motion } from "framer-motion";
import { ArrowUpCircle, ArrowDownCircle, AlertTriangle } from "lucide-react";
import "@/assets/css/IndicesCss.css";

import { useDataContext } from "@/context/DataContext";
import { useSocketContext } from "@/context/SocketContext";

const Indices = () => {
  const { isConnected } = useSocketContext();
  // --- Consume new error state and retry function from context ---
  const { indicesData, isLoadingIndices, indicesError, getInitialIndices } = useDataContext();

  const [processedIndices, setProcessedIndices] = useState([]);
  const [sortBy, setSortBy] = useState('gainers');
  const [sortOrder, setSortOrder] = useState('desc');

  // --- Removed the client-side `calculateChange` function ---

  const processIndices = useCallback((allIndices = []) => {
    const indexMap = new Map();
    
    allIndices.forEach((idx) => {
      // The backend now provides all necessary data, so we just need to deduplicate.
      const name = (idx.name || "").toLowerCase();
      const exchange = (idx.exchange || "").toUpperCase();
      let normalizedName = name;
      
      // Normalize common index names
      if (name.includes('nifty 50')) normalizedName = 'nifty50';
      else if (name.includes('sensex')) normalizedName = 'sensex';
      // Add other normalizations as needed...
      
      const existing = indexMap.get(normalizedName);
      if (!existing || (exchange === 'NSE' && existing.exchange === 'BSE')) {
        indexMap.set(normalizedName, idx);
      }
    });
    
    const filtered = Array.from(indexMap.values());
    
    const sorted = [...filtered].sort((a, b) => {
      // --- Use the new `percent_change_intraday` field for sorting ---
      const changeA = a.percent_change_intraday || 0;
      const changeB = b.percent_change_intraday || 0;

      if (sortBy === 'gainers') {
        if (changeA > 0 && changeB <= 0) return -1;
        if (changeB > 0 && changeA <= 0) return 1;
        return sortOrder === 'desc' ? changeB - changeA : changeA - changeB;
      } 
      if (sortBy === 'losers') {
        if (changeA < 0 && changeB >= 0) return -1;
        if (changeB < 0 && changeA >= 0) return 1;
        return sortOrder === 'desc' ? changeA - changeB : changeB - changeA;
      }
      return a.name.localeCompare(b.name);
    });
    
    setProcessedIndices(sorted);
  }, [sortBy, sortOrder]);

  useEffect(() => {
    if (indicesData && Array.isArray(indicesData)) {
      processIndices(indicesData);
    }
  }, [indicesData, processIndices]);

  const formatNumber = (value, decimalPlaces = 2) => {
    return value !== undefined && !isNaN(value) ? parseFloat(value).toFixed(decimalPlaces) : "N/A";
  };

  const handleSortChange = (newSortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(newSortBy);
      setSortOrder('desc');
    }
  };

  // --- Function to render main content based on loading, error, or data state ---
  const renderContent = () => {
    if (isLoadingIndices && processedIndices.length === 0) {
      return (
        <div className="indices-skeleton">
          {[...Array(6)].map((_, idx) => (
            <div key={idx} className="index-item" style={{ minHeight: "96px" }}>
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-1/2 mb-1" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      );
    }

    if (indicesError) {
      return (
        <div className="error-container">
            <AlertTriangle className="h-12 w-12 text-red-500" />
            <h3 className="error-title">Failed to Load Market Data</h3>
            <p className="error-message">{indicesError}</p>
            <Button onClick={() => getInitialIndices(true)} variant="destructive">
              Click to Retry
            </Button>
        </div>
      );
    }

    return (
        <div className="indices-sections">
            <div className="indices-section">
                <h3 className="section-title">Market Indices</h3>
                <motion.div
                    className="indices-grid"
                    variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
                    initial="hidden"
                    animate="visible"
                >
                    {processedIndices.map((idx) => (
                        <motion.div
                            key={idx.symbol}
                            className="index-item"
                            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                            whileHover={{ scale: 1.03, y: -2 }}
                        >
                            <p className="index-name">{idx.name}</p>
              <p className="index-meta">
                {idx.exchange} | LTP: {formatNumber(idx.ltp || idx.price)}
              </p>
                            <p className="index-price-details">
                                O: {formatNumber(idx.open)} | H: {formatNumber(idx.high)} | L: {formatNumber(idx.low)} | C: {formatNumber(idx.close)}
                            </p>
                            <p className={`index-change ${idx.change_intraday >= 0 ? "profit" : "loss"}`}>
                                {idx.change_intraday >= 0 ? "+" : ""}
                                {formatNumber(idx.change_intraday)} ({formatNumber(idx.percent_change_intraday)}%)
                            </p>
                            <p className="index-meta">
                                Last Updated:{" "}
                                {idx.last_updated ? new Date(idx.last_updated).toLocaleTimeString() : "Live"}
                            </p>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </div>
    );
  };

  return (
    <div className="indices-container">
      <Navbar />
      <main className="indices-main">
        <motion.div
          className="indices-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <Card className="indices-card">
            <CardHeader className="indices-card-header">
              <div className="indices-header-row">
                <CardTitle className="indices-title">Market Indices</CardTitle>
                <div className="header-actions">
                  <div className="connection-status">
                    <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
                    <span className="status-text">{isConnected ? 'Live' : 'Offline'}</span>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="indices-card-content">
              <div className="sorting-controls-section">
                <div className="sorting-buttons">
                  <Button 
                    variant={sortBy === 'gainers' ? 'default' : 'outline'} 
                    onClick={() => handleSortChange('gainers')}
                  >
                    <ArrowUpCircle className="h-4 w-4 mr-1" /> 
                    Gainers {sortBy === 'gainers' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </Button>
                  <Button 
                    variant={sortBy === 'losers' ? 'default' : 'outline'} 
                    onClick={() => handleSortChange('losers')}
                  >
                    <ArrowDownCircle className="h-4 w-4 mr-1" /> 
                    Losers {sortBy === 'losers' && (sortOrder === 'desc' ? '↓' : '↑')}
                  </Button>
                </div>
              </div>
              {renderContent()}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
};

export default Indices;