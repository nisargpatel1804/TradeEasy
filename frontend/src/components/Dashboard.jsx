"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { fetchPortfolio, fetchPerformance, fetchWatchlistStocks } from "@/services/api"
import { useDataContext } from "@/services/DataContext"
import priceUpdateService from "@/services/priceUpdateService"
import { Card, CardHeader, CardContent, CardTitle } from "@/ui/card"
import { Button } from "@/ui/button"
import { isAuthenticated, getProfile, getClientId } from "@/services/auth"
import {
  ChevronLeft,
  ChevronRight,
  Star,
  BarChart3,
  TrendingUp,
  TrendingDown,
  IndianRupee,
  RefreshCw,
} from "lucide-react"
import { motion } from "framer-motion"
import Navbar from "@/components/Navbar"
import "../assets/css/DashboardCss.css"

const Dashboard = () => {
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true) // Track initial load
  const [componentsLoaded, setComponentsLoaded] = useState({
    portfolio: false,
    performance: false,
    watchlist: false,
    indices: false,
  })
  const [componentErrors, setComponentErrors] = useState({
    portfolio: null,
    performance: null,
    watchlist: null,
    indices: null,
  })
  const [retryingComponent, setRetryingComponent] = useState(null)
  const [error, setError] = useState(null)
  const [portfolio, setPortfolio] = useState(null)
  const [performance, setPerformance] = useState(null)
  const [watchlist, setWatchlist] = useState(null)
  const [watchlistStocks, setWatchlistStocks] = useState([])
  const [realTimePrices, setRealTimePrices] = useState({})
  const [priceUpdateStatus, setPriceUpdateStatus] = useState({
    isConnected: false,
    lastUpdate: null,
    updateCount: 0
  })
  const [portfolioPage, setPortfolioPage] = useState(0)
  const [watchlistPage, setWatchlistPage] = useState(0)
  const [profile, setProfile] = useState({ name: "Client Name", clientId: "TR123456" })
  const [indices, setIndices] = useState([])
  const navigate = useNavigate()
  
  // Get shared context data
  const { getProfile, getIndices, getWatchlists } = useDataContext()

  const portfolioItemsPerPage = 2
  const watchlistItemsPerPage = 3

  const containerVariants = {
    hidden: { opacity: 1 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
      },
    },
  }

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeOut",
      },
    },
  }

  // Individual component retry functions
  const retryComponent = async (componentName) => {
    setRetryingComponent(componentName)
    setComponentErrors((prev) => ({ ...prev, [componentName]: null }))

    try {
      let data
      switch (componentName) {
        case "portfolio":
          data = await fetchPortfolio()
          setPortfolio(data)
          break
        case "performance":
          data = await fetchPerformance()
          setPerformance(data)
          break
        case "watchlist":
          data = await getWatchlists(true) // Force refresh
          setWatchlist(data)
          break
        case "indices":
          data = await getIndices(true) // Force refresh
          setIndices(data)
          break
      }
      setComponentsLoaded((prev) => ({ ...prev, [componentName]: true }))
    } catch (error) {
      setComponentErrors((prev) => ({
        ...prev,
        [componentName]: error?.message || `Failed to fetch ${componentName}`,
      }))
    } finally {
      setRetryingComponent(null)
    }
  }

  // Flag to prevent duplicate API calls in React's StrictMode
  const [hasFetchedData, setHasFetchedData] = useState(false)
  
  useEffect(() => {
    const fetchData = async () => {
      // Skip if already fetched data (prevents StrictMode double-fetch)
      if (hasFetchedData) return
      
      try {
        if (!isAuthenticated()) {
          navigate("/login")
          return
        }

        setLoading(true)
        document.body.classList.add('loading')

        const profileData = await getProfile()
        if (profileData) {
          setProfile({
            name: profileData.name || "Client Name",
            clientId: getClientId() || "TR123456",
          })
        }

        // Fetch data with individual error handling - no dummy data fallback
        const portfolioPromise = fetchPortfolio()
          .then((data) => {
            setPortfolio(data)
            setComponentsLoaded((prev) => ({ ...prev, portfolio: true }))
            return data
          })
          .catch((error) => {
            setComponentErrors((prev) => ({ ...prev, portfolio: error?.message || "Failed to fetch portfolio" }))
            throw error
          })

        const performancePromise = fetchPerformance()
          .then((data) => {
            setPerformance(data)
            setComponentsLoaded((prev) => ({ ...prev, performance: true }))
            return data
          })
          .catch((error) => {
            setComponentErrors((prev) => ({ ...prev, performance: error?.message || "Failed to fetch performance" }))
            throw error
          })

        const watchlistPromise = getWatchlists()
          .then(async (data) => {
            if (data && !data.error) {
              // Find the 'Stocks' watchlist and fetch its stocks
              const stocksWatchlist = data.find(w => w.name === "Stocks")
              if (stocksWatchlist) {
                const stocksData = await fetchWatchlistStocks(stocksWatchlist.id)
                if (stocksData && !stocksData.error) {
                  setWatchlistStocks(stocksData.stocks || [])
                  setWatchlist({ data: stocksData.stocks || [] })
                }
              }
            }
            setComponentsLoaded((prev) => ({ ...prev, watchlist: true }))
            return data
          })
          .catch((error) => {
            setComponentErrors((prev) => ({ ...prev, watchlist: error?.message || "Failed to fetch watchlist" }))
            throw error
          })

        const indicesPromise = getIndices()
          .then((data) => {
            setIndices(data)
            setComponentsLoaded((prev) => ({ ...prev, indices: true }))
            return data
          })
          .catch((error) => {
            setComponentErrors((prev) => ({ ...prev, indices: error?.message || "Failed to fetch indices" }))
            throw error
          })

        await Promise.allSettled([portfolioPromise, performancePromise, watchlistPromise, indicesPromise])
      } catch (error) {
        setError(error?.message || "Failed to fetch data")
      } finally {
        setLoading(false)
        setInitialLoad(false)
        document.body.classList.remove('loading')
        document.body.classList.add('loaded')
        setHasFetchedData(true)
      }
    }

    fetchData()
  }, [navigate])

  // Price update subscription effect - optimized to prevent excessive re-renders
  useEffect(() => {
    let unsubscribe = null
    
    // Only subscribe if we have watchlist stocks
    if (watchlistStocks.length > 0) {
      unsubscribe = priceUpdateService.subscribe(({ allPrices, isConnected, isMarketHours, error }) => {
        setPriceUpdateStatus(prev => ({
          isConnected,
          lastUpdate: isConnected ? new Date().toLocaleTimeString() : prev.lastUpdate,
          updateCount: isConnected ? prev.updateCount + 1 : prev.updateCount
        }))
        
        if (isConnected && allPrices && Object.keys(allPrices).length > 0) {
          // Update watchlist stocks with new prices
          setWatchlistStocks(prevStocks => {
            const updatedStocks = prevStocks.map(stock => {
              const newPriceData = allPrices[stock.symbol]
              if (newPriceData) {
                return {
                  ...stock,
                  price: newPriceData.ltp,
                  change: newPriceData.change,
                  percent_change: newPriceData.percent_change,
                  last_updated: newPriceData.last_updated
                }
              }
              return stock
            })
            
            // Also update the watchlist.data state for display
            setWatchlist(prev => ({
              ...prev,
              data: updatedStocks
            }))
            
            return updatedStocks
          })
          
          // Update real-time prices state
          setRealTimePrices(allPrices)
        }
        
        if (error && isMarketHours) {
          console.warn('Dashboard: Price update service error:', error)
        }
      })
    }

    // Cleanup subscription on unmount or when stocks change
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [watchlistStocks.length]) // Only depend on watchlist length, not the entire array

  const formatCurrency = useCallback((amount) => {
    if (amount === null || amount === undefined) {
      return "₹0.00"
    }
    return amount.toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
    })
  }, [])

  const handlePortfolioNext = useCallback(() => {
    const maxPage = Math.ceil((portfolio?.holdings?.length || 0) / portfolioItemsPerPage) - 1
    setPortfolioPage((prev) => Math.min(prev + 1, maxPage))
  }, [portfolio?.holdings?.length, portfolioItemsPerPage])

  const handlePortfolioPrev = useCallback(() => {
    setPortfolioPage((prev) => Math.max(prev - 1, 0))
  }, [])

  const handleWatchlistNext = useCallback(() => {
    const maxPage = Math.ceil((watchlist?.data?.length || 0) / watchlistItemsPerPage) - 1
    setWatchlistPage((prev) => Math.min(prev + 1, maxPage))
  }, [watchlist?.data?.length, watchlistItemsPerPage])

  const handleWatchlistPrev = useCallback(() => {
    setWatchlistPage((prev) => Math.max(prev - 1, 0))
  }, [])

  // Memoized calculations to prevent unnecessary re-renders
  const paginatedPortfolio = useMemo(() => 
    portfolio?.holdings?.slice(portfolioPage * portfolioItemsPerPage, (portfolioPage + 1) * portfolioItemsPerPage) || []
  , [portfolio?.holdings, portfolioPage, portfolioItemsPerPage])

  const paginatedWatchlist = useMemo(() => 
    watchlist?.data?.slice(
      watchlistPage * watchlistItemsPerPage,
      (watchlistPage + 1) * watchlistItemsPerPage,
    ) || []
  , [watchlist?.data, watchlistPage, watchlistItemsPerPage])

  // Component Loading Skeleton
  const ComponentSkeleton = ({ title, rows = 3 }) => (
    <div className="skeleton-container">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton-row">
          <div className="skeleton-item skeleton-circle"></div>
          <div className="skeleton-item skeleton-text"></div>
          <div className="skeleton-item skeleton-number"></div>
        </div>
      ))}
    </div>
  )

  // Skeleton for Overview Cards
  const OverviewSkeleton = () => (
    <div className="overview-grid">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="overview-card">
          <div className="overview-card-content">
            <div className="overview-header">
              <div className="skeleton-item skeleton-text" style={{ width: "80px" }}></div>
              <div className="skeleton-item skeleton-circle" style={{ width: "20px", height: "20px" }}></div>
            </div>
            <div className="skeleton-item skeleton-text" style={{ width: "120px", height: "32px" }}></div>
            <div className="skeleton-item skeleton-text" style={{ width: "100px", height: "16px" }}></div>
          </div>
        </div>
      ))}
    </div>
  )

  // Skeleton for Watchlist
  const WatchlistSkeleton = () => (
    <div className="watchlist-grid">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="watchlist-item">
          <div className="watchlist-header">
            <div className="watchlist-symbol-group">
              <div className="skeleton-item skeleton-circle" style={{ width: "16px", height: "16px" }}></div>
              <div className="skeleton-item skeleton-text" style={{ width: "60px", height: "20px" }}></div>
            </div>
            <div className="skeleton-item skeleton-text" style={{ width: "40px", height: "16px" }}></div>
          </div>
          <div className="skeleton-item skeleton-text" style={{ width: "80px", height: "24px" }}></div>
          <div className="skeleton-item skeleton-text" style={{ width: "40px", height: "12px" }}></div>
        </div>
      ))}
    </div>
  )

  // Component Error State
  const ComponentError = ({ error, onRetry, componentName }) => (
    <div className="component-error">
      <div className="error-content">
        <p className="error-message">{error}</p>
        <Button className="error-retry-button" onClick={onRetry} disabled={retryingComponent === componentName}>
          {retryingComponent === componentName ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Retrying...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </>
          )}
        </Button>
      </div>
    </div>
  )

  // Clean symbol function to remove exchange suffixes
  const cleanSymbol = (symbol) => {
    return symbol.replace(/\.(NSE|BSE|NS|BO)$/, "")
  }

  // Define loading animation variants
  const loaderVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { 
      opacity: 1, 
      scale: 1,
      transition: { duration: 0.5, ease: "easeOut" }
    }
  };

  const spinnerVariants = {
    animate: {
      rotate: 360,
      transition: { 
        duration: 1.5, 
        ease: "linear", 
        repeat: Infinity 
      }
    }
  };

  const pulseVariants = {
    animate: {
      scale: [1, 1.05, 1],
      opacity: [0.7, 1, 0.7],
      transition: { 
        duration: 2, 
        ease: "easeInOut", 
        repeat: Infinity 
      }
    }
  };

  // Full-site loader
  if (loading) {
    return (
      <div className="full-site-loader">
        <div className="loader-spinner">
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
          <div className="spinner-ring"></div>
        </div>
        <p className="loader-text">Loading your dashboard...</p>
      </div>
    );
  }

  if (error && initialLoad) {
    return (
      <div className="dashboard-error">
        <div className="error-content">
          <p className="error-message">{error}</p>
          <Button className="error-retry-button" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Navbar />

      <main className="dashboard-main">
        <motion.div
          className="dashboard-content"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {/* Portfolio Overview Cards */}
          <motion.div className="overview-grid" variants={itemVariants}>
            <div className="overview-card">
              <div className="overview-card-content">
                <div className="overview-header">
                  <h3 className="overview-title">Portfolio Value</h3>
                  <BarChart3 className="overview-icon" />
                </div>
                <p className="overview-value">{formatCurrency(portfolio?.portfolio_value)}</p>
                <p className="overview-subtitle">Current market value</p>
              </div>
            </div>

            <div className="overview-card">
              <div className="overview-card-content">
                <div className="overview-header">
                  <h3 className="overview-title">Total Investment</h3>
                  <IndianRupee className="overview-icon" />
                </div>
                <p className="overview-value">{formatCurrency(portfolio?.total_investment)}</p>
                <p className="overview-subtitle">Amount invested</p>
              </div>
            </div>

            <div className="overview-card">
              <div className="overview-card-content">
                <div className="overview-header">
                  <h3 className="overview-title">Total P&L</h3>
                  {Number.parseFloat(portfolio?.total_profit_loss) >= 0 ? (
                    <TrendingUp className="overview-icon profit" />
                  ) : (
                    <TrendingDown className="overview-icon loss" />
                  )}
                </div>
                <p
                  className={`overview-value ${
                    Number.parseFloat(portfolio?.total_profit_loss) >= 0 ? "profit" : "loss"
                  }`}
                >
                  {formatCurrency(portfolio?.total_profit_loss)}
                </p>
                <p className="overview-subtitle">Profit & Loss</p>
              </div>
            </div>
          </motion.div>

          {/* Dashboard Grid Section */}
          <motion.div className="dashboard-grid" variants={itemVariants}>
            {/* Portfolio Holdings Section */}
            <Card className="dashboard-card clickable-card" onClick={() => navigate("/portfolio")}>
              <CardHeader className="dashboard-card-header">
                <div className="card-header-content">
                  <CardTitle className="dashboard-card-title">Portfolio Holdings</CardTitle>
                  <div className="pagination-controls" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (portfolioPage > 0) {
                          handlePortfolioPrev()
                        }
                      }}
                      disabled={portfolioPage === 0}
                      className="pagination-button"
                    >
                      <ChevronLeft className="pagination-icon" />
                    </Button>
                    <span className="pagination-info">
                      {portfolioPage * portfolioItemsPerPage + 1}-
                      {Math.min((portfolioPage + 1) * portfolioItemsPerPage, portfolio?.holdings?.length || 0)} of{" "}
                      {portfolio?.holdings?.length || 0}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        const maxPage = Math.ceil((portfolio?.holdings?.length || 0) / portfolioItemsPerPage) - 1
                        if (portfolioPage < maxPage) {
                          handlePortfolioNext()
                        }
                      }}
                      disabled={(portfolioPage + 1) * portfolioItemsPerPage >= (portfolio?.holdings?.length || 0)}
                      className="pagination-button"
                    >
                      <ChevronRight className="pagination-icon" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="dashboard-card-content">
                {componentErrors.portfolio ? (
                  <ComponentError
                    error={componentErrors.portfolio}
                    onRetry={() => retryComponent("portfolio")}
                    componentName="portfolio"
                  />
                ) : !componentsLoaded.portfolio ? (
                  <ComponentSkeleton title="" rows={2} />
                ) : (
                  <div className="holdings-container">
                    {paginatedPortfolio.length > 0 ? (
                      paginatedPortfolio.map((holding, index) => (
                        <div
                          key={`${holding.symbol}-${portfolioPage}-${index}`}
                          className="holding-card"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`/stock/overview/${cleanSymbol(holding.symbol)}`)
                          }}
                        >
                          <div className="holding-header">
                            <h4 className="holding-symbol">{cleanSymbol(holding.symbol)}</h4>
                            <div
                              className={`holding-percentage ${
                                Number.parseFloat(holding.profit_loss) >= 0 ? "profit" : "loss"
                              }`}
                            >
                              {Number.parseFloat(holding.profit_loss_percentage) >= 0 ? "+" : ""}
                              {Number.parseFloat(holding.profit_loss_percentage).toFixed(2)}%
                            </div>
                          </div>
                          <div className="holding-details">
                            <div className="holding-detail-group">
                              <p className="holding-detail">
                                Quantity: <span className="holding-value">{holding.quantity}</span>
                              </p>
                              <p className="holding-detail">
                                Avg Price: <span className="holding-value">{formatCurrency(holding.average_price)}</span>
                              </p>
                              <p className="holding-detail">
                                Current Price:{" "}
                                <span className="holding-value">{formatCurrency(holding.current_price)}</span>
                              </p>
                            </div>
                            <div className="holding-detail-group">
                              <p className="holding-detail">
                                Investment:{" "}
                                <span className="holding-value">{formatCurrency(holding.investment_value)}</span>
                              </p>
                              <p className="holding-detail">
                                Current Value:{" "}
                                <span className="holding-value">{formatCurrency(holding.current_value)}</span>
                              </p>
                              <p className="holding-detail">
                                P&L:{" "}
                                <span
                                  className={`holding-value ${
                                    Number.parseFloat(holding.profit_loss) >= 0 ? "profit" : "loss"
                                  }`}
                                >
                                  {formatCurrency(holding.profit_loss)}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">
                        <p className="empty-message">No holdings available</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Section - Clickable to /performance */}
            <Card className="dashboard-card clickable-card" onClick={() => navigate("/performance")}>
              <CardHeader className="dashboard-card-header">
                <CardTitle className="dashboard-card-title">Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent className="dashboard-card-content">
                {componentErrors.performance ? (
                  <ComponentError
                    error={componentErrors.performance}
                    onRetry={() => retryComponent("performance")}
                    componentName="performance"
                  />
                ) : !componentsLoaded.performance ? (
                  <ComponentSkeleton title="" rows={4} />
                ) : (
                  <div className="performance-container">
                    {/* Total Holdings is now a highlighted metric at the top */}
                    <div className="performance-metric highlight">
                      <p className="metric-label">Total Holdings</p>
                      <p className="metric-value">{portfolio?.total_holdings ?? 0}</p>
                    </div>

                    <div className="performance-overview">
                      {/* Swapped: Invested Amount on left, Current Value on right */}
                      <div className="performance-metric">
                        <p className="metric-label">Invested Amount</p>
                        <p className="metric-value">{formatCurrency(performance?.invested_amount)}</p>
                      </div>
                      <div className="performance-metric">
                        <p className="metric-label">Current Value</p>
                        <p className="metric-value">{formatCurrency(performance?.current_value)}</p>
                      </div>
                    </div>

                    <div className="performance-details">
                      <div className="performance-item">
                        <span className="performance-label">Realized P&L</span>
                        <span
                          className={`performance-value ${
                            Number.parseFloat(performance?.realized_profit_loss) >= 0 ? "profit" : "loss"
                          }`}
                        >
                          {formatCurrency(performance?.realized_profit_loss)}
                        </span>
                      </div>
                      <div className="performance-item">
                        <span className="performance-label">Unrealized P&L</span>
                        <span
                          className={`performance-value ${
                            Number.parseFloat(performance?.unrealized_profit_loss) >= 0 ? "profit" : "loss"
                          }`}
                        >
                          {formatCurrency(performance?.unrealized_profit_loss)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Watchlist Section */}
          <motion.div variants={itemVariants}>
            <Card className="dashboard-card">
              <CardHeader className="dashboard-card-header">
                <div className="card-header-content">
                  <CardTitle className="dashboard-card-title">Watchlist</CardTitle>
                  <div className="watchlist-controls">
                    <div className="pagination-controls">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleWatchlistPrev}
                        disabled={watchlistPage === 0}
                        className="pagination-button"
                      >
                        <ChevronLeft className="pagination-icon" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleWatchlistNext}
                        disabled={(watchlistPage + 1) * watchlistItemsPerPage >= watchlist?.data?.length || 0}
                        className="pagination-button"
                      >
                        <ChevronRight className="pagination-icon" />
                      </Button>
                    </div>
                    <Button className="view-all-button" onClick={() => navigate("/watchlist")}>
                      View All
                      <ChevronRight className="button-icon" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="dashboard-card-content">
                {componentErrors.watchlist ? (
                  <ComponentError
                    error={componentErrors.watchlist}
                    onRetry={() => retryComponent("watchlist")}
                    componentName="watchlist"
                  />
                ) : !componentsLoaded.watchlist ? (
                  <WatchlistSkeleton />
                ) : (
                  <div className="watchlist-grid">
                    {paginatedWatchlist.map((stock, index) => (
                      <div
                        key={`${stock.symbol}-${watchlistPage}-${index}`}
                        className="watchlist-item"
                        onClick={() => navigate(`/stock/overview/${cleanSymbol(stock.symbol)}`)}
                      >
                        <div className="watchlist-header">
                          <div className="watchlist-symbol-group">
                            <Star className="watchlist-star" />
                            <h3 className="watchlist-symbol">{cleanSymbol(stock.symbol)}</h3>
                          </div>
                          <span className={`watchlist-change ${(stock.percent_change || 0) >= 0 ? "profit" : "loss"}`}>
                            {(stock.percent_change === 0 || stock.percent_change === null || stock.percent_change === undefined) ? "-.--%" : 
                             `${(stock.percent_change || 0) >= 0 ? "+" : ""}${isNaN(Number(stock.percent_change)) ? "-.--" : Number(stock.percent_change || 0).toFixed(2)}%`}
                          </span>
                        </div>
                        <p className="watchlist-price">
                          ₹{(stock.price === 0 || stock.price === null || stock.price === undefined || isNaN(Number(stock.price))) ? "-.--" : Number(stock.price || 0).toFixed(2)}
                        </p>
                        <div className="watchlist-exchange">NSE</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      </main>
    </>
  )
}

export default Dashboard
