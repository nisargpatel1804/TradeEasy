/**
 * Real-time price update service for frontend
 * Fetches live prices during market hours and cached data otherwise
 * Optimized to reduce unnecessary API calls and improve performance
 */

import { api } from './api'
import marketHours from '../utils/marketHours'

class PriceUpdateService {
  constructor() {
    this.isRunning = false
    this.intervalId = null
    this.updateInterval = 1000 // 1 second during market hours
    this.offMarketInterval = 300000 // 5 minutes when market is closed
    this.subscribers = new Set()
    this.lastPrices = {}
    this.retryCount = 0
    this.maxRetries = 3
    this.lastFetchTime = null
    this.isMarketHours = false
    this.lastMarketStatusCheck = null
    this.marketStatusCacheMs = 30000 // Cache market status for 30 seconds
  }

  /**
   * Subscribe to price updates
   * @param {Function} callback - Function to call when prices are updated
   * @returns {Function} - Unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.add(callback)
    
    // Start service if not already running
    if (!this.isRunning) {
      this.start()
    }
    
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback)
      
      // Stop service if no more subscribers
      if (this.subscribers.size === 0) {
        this.stop()
      }
    }
  }

  /**
   * Start the price update service
   */
  start() {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.retryCount = 0
    this.updateMarketStatus()
    
    // Set appropriate interval based on market hours
    const interval = this.isMarketHours ? this.updateInterval : this.offMarketInterval
    
    this.intervalId = setInterval(() => {
      this.updateMarketStatus()
      this.fetchPrices()
    }, interval)
  }

  /**
   * Update market status and adjust fetch frequency
   * Uses caching to reduce frequent market status checks
   */
  updateMarketStatus() {
    const now = Date.now()
    
    // Use cached market status if checked recently
    if (this.lastMarketStatusCheck && (now - this.lastMarketStatusCheck) < this.marketStatusCacheMs) {
      return
    }
    
    const marketStatus = marketHours.getMarketStatus()
    const wasMarketHours = this.isMarketHours
    this.isMarketHours = marketStatus.isOpen
    this.lastMarketStatusCheck = now

    // If market status changed, restart with new interval
    if (wasMarketHours !== this.isMarketHours && this.intervalId) {
      clearInterval(this.intervalId)
      const interval = this.isMarketHours ? this.updateInterval : this.offMarketInterval
      
      this.intervalId = setInterval(() => {
        this.updateMarketStatus()
        this.fetchPrices()
      }, interval)
      
      // If market just closed, do one final fetch to get closing prices
      if (!this.isMarketHours && wasMarketHours) {
        setTimeout(() => this.fetchPrices(), 1000)
      }
    }
  }

  /**
   * Stop the price update service
   */
  stop() {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  /**
   * Fetch latest prices from backend
   * Optimized to reduce API calls when market is closed
   */
  async fetchPrices() {
    try {
      // Skip fetching if market is closed and we've fetched recently
      if (!this.isMarketHours && this.lastFetchTime) {
        const timeSinceLastFetch = Date.now() - this.lastFetchTime.getTime()
        const minInterval = 60000 // Minimum 1 minute between off-market fetches
        
        if (timeSinceLastFetch < minInterval) {
          return
        }
      }
      
      // During market hours, fetch real-time prices; otherwise, fetch cached data
      const endpoint = this.isMarketHours ? 
        '/watchlists/prices/realtime' : 
        '/watchlists/prices/cached'
      
      const response = await api.get(endpoint)
      
      if (response.data && response.data.prices) {
        const newPrices = response.data.prices
        
        // Check for price changes only during market hours
        const changedPrices = {}
        if (this.isMarketHours) {
          for (const [symbol, priceData] of Object.entries(newPrices)) {
            const lastPrice = this.lastPrices[symbol]
            if (!lastPrice || lastPrice.ltp !== priceData.ltp) {
              changedPrices[symbol] = {
                ...priceData,
                previousPrice: lastPrice ? lastPrice.ltp : null,
                priceDirection: lastPrice ? 
                  (priceData.ltp > lastPrice.ltp ? 'up' : 
                   priceData.ltp < lastPrice.ltp ? 'down' : 'same') : 'same'
              }
            }
          }
        }
        
        // Update stored prices
        this.lastPrices = { ...newPrices }
        this.lastFetchTime = new Date()
        
        // Notify subscribers
        this.notifySubscribers({
          allPrices: newPrices,
          changedPrices,
          timestamp: new Date().toISOString(),
          isConnected: true,
          isMarketHours: this.isMarketHours
        })
        
        // Reset retry count on success
        this.retryCount = 0
      }
    } catch (error) {
      // Only log errors during market hours to reduce noise
      if (this.isMarketHours) {
        console.error('Failed to fetch real-time prices:', error)
      }
      
      // Notify subscribers of connection issues
      this.notifySubscribers({
        allPrices: {},
        changedPrices: {},
        timestamp: new Date().toISOString(),
        isConnected: false,
        isMarketHours: this.isMarketHours,
        error: error.message
      })
      
      this.retryCount++
      
      // If too many retries, stop the service temporarily
      if (this.retryCount >= this.maxRetries) {
        this.stop()
        
        // Restart after delay (longer delay if market is closed)
        const retryDelay = this.isMarketHours ? 30000 : 300000 // 30s or 5min
        setTimeout(() => {
          if (this.subscribers.size > 0) {
            this.start()
          }
        }, retryDelay)
      }
    }
  }

  /**
   * Notify all subscribers of price updates
   * @param {Object} priceData - The price update data
   */
  notifySubscribers(priceData) {
    this.subscribers.forEach(callback => {
      try {
        callback(priceData)
      } catch (error) {
        console.error('Error in price update callback:', error)
      }
    })
  }

  /**
   * Get the last known price for a symbol
   * @param {string} symbol - The stock symbol
   * @returns {Object|null} - The price data or null if not found
   */
  getLastPrice(symbol) {
    return this.lastPrices[symbol] || null
  }

  /**
   * Check if the service is currently running
   * @returns {boolean}
   */
  isServiceRunning() {
    return this.isRunning
  }

  /**
   * Get the number of active subscribers
   * @returns {number}
   */
  getSubscriberCount() {
    return this.subscribers.size
  }

  /**
   * Get market status information
   * @returns {Object}
   */
  getMarketStatus() {
    return {
      isMarketHours: this.isMarketHours,
      lastFetchTime: this.lastFetchTime,
      isRunning: this.isRunning,
      subscriberCount: this.subscribers.size,
      marketInfo: marketHours.getMarketStatus()
    }
  }
}

// Create singleton instance
const priceUpdateService = new PriceUpdateService()

export default priceUpdateService
