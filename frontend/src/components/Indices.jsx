"use client"

import { useState, useEffect } from "react";
import { fetchIndices, updateIndices } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { toast } from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { motion } from "framer-motion";
import { TrendingUp, Twitter, Facebook, Instagram, Youtube, TrendingDown, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { Link } from "react-router-dom";
import "../assets/css/IndicesCss.css";

const Indices = () => {
  const [indices, setIndices] = useState([]);
  const [nationalIndices, setNationalIndices] = useState([]);
  const [globalIndices, setGlobalIndices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  // New states for movers selection
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [moverType, setMoverType] = useState("gainers"); // "gainers" or "losers"
  const [showMovers, setShowMovers] = useState(false);

  // Flag to prevent duplicate API calls in React's StrictMode
  const [hasFetchedData, setHasFetchedData] = useState(false);

  useEffect(() => {
    // Skip if already fetched data (prevents duplicate API calls in StrictMode)
    if (!hasFetchedData) {
      fetchIndicesData();
      setHasFetchedData(true);
    }
  }, [hasFetchedData]);

  const categoriseIndices = (all = []) => {
    const national = [];
    const global   = [];

    all.forEach((idx) => {
      const sym  = (idx.symbol || "").toUpperCase();
      const name = (idx.name   || "").toLowerCase();

      if (
        sym.includes("NSE")     || sym.includes("BSE") ||
        sym.startsWith("^NSE")  || sym.startsWith("^BSE") ||
        name.includes("nifty")  || name.includes("sensex")
      ) {
        national.push(idx);
      } else {
        global.push(idx);
      }
    });

    setNationalIndices(national);
    setGlobalIndices(global);
  };

  const fetchIndicesData = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchIndices();
      setIndices(data);
      categoriseIndices(data);
      toast.success("Market indices fetched successfully!");
    } catch (err) {
      setError(err?.message || "Failed to fetch market indices");
      toast.error(err?.message || "Failed to fetch market indices");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateIndices = async () => {
    setUpdating(true);
    setError("");

    try {
      await updateIndices();
      toast.success("Market indices updated successfully!");
      fetchIndicesData();
    } catch (err) {
      setError(err?.message || "Failed to update indices");
      toast.error(err?.message || "Failed to update indices");
    } finally {
      setUpdating(false);
    }
  };

  const formatNumber = (value, decimalPlaces = 2) => {
    return value !== undefined && !isNaN(value) ? parseFloat(value).toFixed(decimalPlaces) : "N/A";
  };

  const handleMoversButtonClick = (indexName, type) => {
    const index = indices.find(idx => idx.name.toLowerCase() === indexName.toLowerCase());
    if (index) {
      setSelectedIndex(index);
      setMoverType(type);
      setShowMovers(true);
    }
  };

  const closeMoversPanel = () => {
    setShowMovers(false);
  };

  // Component to display the top gainers/losers
  const MoversPanel = ({ index, type }) => {
    const movers = index?.[type] || [];
    
    return (
      <motion.div 
        className="movers-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
      >
        <div className="movers-header">
          <h3>
            {type === "gainers" ? (
              <><ArrowUpCircle className="icon-gain" /> Top Gainers</>
            ) : (
              <><ArrowDownCircle className="icon-loss" /> Top Losers</>
            )}
            <span> - {index?.name}</span>
          </h3>
          <Button variant="ghost" size="sm" onClick={closeMoversPanel}>×</Button>
        </div>
        {movers.length > 0 ? (
          <div className="movers-list">
            {movers.map((stock, idx) => (
              <div key={idx} className="mover-item">
                <div className="mover-symbol">{stock.symbol}</div>
                <div className="mover-price">₹{formatNumber(stock.price)}</div>
                <div className={`mover-change ${type === "gainers" ? "gain" : "loss"}`}>
                  {type === "gainers" ? "+" : ""}{formatNumber(stock.percent_change)}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-movers">No data available</div>
        )}
      </motion.div>
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
          transition={{ duration: 0.5 }}
        >
          <Card className="indices-card">
            <CardHeader className="indices-card-header">
              <div className="indices-header-row">
                <CardTitle className="indices-title">Market Indices</CardTitle>
                <Button onClick={handleUpdateIndices} disabled={updating || loading}>
                  {updating ? "Updating…" : "Update Data"}
                </Button>
              </div>
              {error && <p className="indices-error">{error}</p>}
            </CardHeader>

            <CardContent className="indices-card-content">
              {loading ? (
                <div className="indices-skeleton">
                  {[...Array(6)].map((_, idx) => (
                    <div
                      key={idx}
                      className="index-item"
                      style={{ minHeight: "96px" }}
                    >
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-3 w-full mb-1" />
                      <Skeleton className="h-3 w-1/2 mb-1" />
                      <Skeleton className="h-3 w-5/6" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="indices-sections">
                  <div className="indices-section">
                    <h3 className="section-title">National (India)</h3>
                    <motion.div
                      className="indices-grid"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        hidden: { opacity: 0 },
                        visible: {
                          opacity: 1,
                          transition: { staggerChildren: 0.06 },
                        },
                      }}
                    >
                      {nationalIndices.map((idx) => (
                        <motion.div
                          key={idx.symbol}
                          className="index-item"
                          variants={{
                            hidden: { opacity: 0, y: 20 },
                            visible: { opacity: 1, y: 0 },
                          }}
                          whileHover={{ scale: 1.03, y: -2 }}
                        >
                          <p className="index-name">{idx.name}</p>
                          <p className="index-meta">
                            Symbol: {idx.symbol} | Price: ₹{formatNumber(idx.price)}
                          </p>
                          <p
                            className={`index-change ${
                              parseFloat(idx.percent_change) >= 0
                                ? "profit"
                                : "loss"
                            }`}
                          >
                            {parseFloat(idx.change) >= 0 ? "+" : ""}
                            {formatNumber(idx.change)} (
                            {formatNumber(idx.percent_change)}%)
                          </p>
                          <p className="index-meta">
                            Last Updated:{" "}
                            {idx.last_updated
                              ? new Date(idx.last_updated).toLocaleString()
                              : "N/A"}
                          </p>
                          
                          {/* Add movers buttons for Nifty 50 and Sensex */}
                          {(idx.name.toLowerCase().includes("nifty") || 
                            idx.name.toLowerCase().includes("sensex")) && (
                            <div className="movers-buttons">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="gainers-btn"
                                onClick={() => handleMoversButtonClick(idx.name, "gainers")}
                              >
                                <ArrowUpCircle className="h-4 w-4 mr-1" /> Gainers
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm" 
                                className="losers-btn"
                                onClick={() => handleMoversButtonClick(idx.name, "losers")}
                              >
                                <ArrowDownCircle className="h-4 w-4 mr-1" /> Losers
                              </Button>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </motion.div>
                  </div>

                  <div className="indices-section">
                    <h3 className="section-title">Global</h3>
                    <motion.div
                      className="indices-grid global-grid"
                      initial="hidden"
                      animate="visible"
                      variants={{
                        hidden: { opacity: 0 },
                        visible: {
                          opacity: 1,
                          transition: { staggerChildren: 0.06 },
                        },
                      }}
                    >
                      {globalIndices.map((idx) => (
                        <motion.div
                          key={idx.symbol}
                          className="index-item"
                          variants={{
                            hidden: { opacity: 0, y: 20 },
                            visible: { opacity: 1, y: 0 },
                          }}
                          whileHover={{ scale: 1.03, y: -2 }}
                        >
                          <p className="index-name">{idx.name}</p>
                          <p className="index-meta">
                            Symbol: {idx.symbol} | Price: ₹{formatNumber(idx.price)}
                          </p>
                          <p
                            className={`index-change ${
                              parseFloat(idx.percent_change) >= 0
                                ? "profit"
                                : "loss"
                            }`}
                          >
                            {parseFloat(idx.change) >= 0 ? "+" : ""}
                            {formatNumber(idx.change)} (
                            {formatNumber(idx.percent_change)}%)
                          </p>
                          <p className="index-meta">
                            Last Updated:{" "}
                            {idx.last_updated
                              ? new Date(idx.last_updated).toLocaleString()
                              : "N/A"}
                          </p>
                        </motion.div>
                      ))}
                    </motion.div>
                  </div>
                </div>
              )}
              
              {/* Render the movers panel when required */}
              {showMovers && selectedIndex && (
                <MoversPanel index={selectedIndex} type={moverType} />
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>

      <footer className="indices-footer">
        <div className="footer-brand">
          <TrendingUp className="footer-logo-icon" />
          <span className="footer-logo-text">TradeEasy</span>
        </div>
        <p className="footer-tagline">
          © {new Date().getFullYear()} TradeEasy. All rights reserved.
        </p>
        <div className="footer-social">
          {[Twitter, Facebook, Instagram, Youtube].map((Icon, idx) => (
            <motion.a
              key={idx}
              href="#"
              className="footer-social-icon"
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.95 }}
            >
              <Icon size={18} />
            </motion.a>
          ))}
        </div>
      </footer>
    </div>
  );
};

export default Indices;