/**
 * Price Update Service
 * Handles real-time price updates for stocks via WebSocket
 * This is a placeholder implementation that can be expanded
 */

class PriceUpdateService {
  constructor() {
    this.subscribers = [];
    this.isConnected = false;
    this.allPrices = {};
    this.marketHours = false;
  }

  /**
   * Subscribe to price updates
   * @param {function} callback - Function to call when price data is received
   * @returns {function} - Unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.subscribers.indexOf(callback);
      if (index > -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Notify all subscribers with price data
   * @param {object} priceData - The price data to send
   */
  notifySubscribers(priceData) {
    this.subscribers.forEach(callback => {
      try {
        callback(priceData);
      } catch (error) {
        console.error('Error in price update subscriber:', error);
      }
    });
  }

  /**
   * Update connection status
   * @param {boolean} connected - Whether connected to price feed
   */
  setConnected(connected) {
    this.isConnected = connected;
    this.notifySubscribers({
      allPrices: this.allPrices,
      changedPrices: {},
      isConnected: this.isConnected,
      isMarketHours: this.marketHours,
      error: null
    });
  }

  /**
   * Update market hours status
   * @param {boolean} marketHours - Whether market is open
   */
  setMarketHours(marketHours) {
    this.marketHours = marketHours;
  }

  /**
   * Update prices
   * @param {object} prices - Object with symbol keys and price data values
   */
  updatePrices(prices) {
    this.allPrices = { ...this.allPrices, ...prices };
    this.notifySubscribers({
      allPrices: this.allPrices,
      changedPrices: prices,
      isConnected: this.isConnected,
      isMarketHours: this.marketHours,
      error: null
    });
  }

  /**
   * Set error state
   * @param {string} error - Error message
   */
  setError(error) {
    this.notifySubscribers({
      allPrices: this.allPrices,
      changedPrices: {},
      isConnected: this.isConnected,
      isMarketHours: this.marketHours,
      error: error
    });
  }
}

// Create singleton instance
const priceUpdateService = new PriceUpdateService();

export default priceUpdateService;