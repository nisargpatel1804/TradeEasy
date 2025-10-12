/**
 * Price Update Service
 * Manages real-time price updates by listening to the main application socket.
 * This service should be initialized once with a connected Socket.IO client.
 */

class PriceUpdateService {
  constructor() {
    this.subscribers = [];
    this.socket = null;
    this.allPrices = {};
    this.isConnected = false;
    this.isMarketOpen = false; // Tracks market open/close status
    this.isStreamingPaused = true;
    this.lastConnectionEvent = null;

    this._handleConnect = () => {
      this.isConnected = true;
      this.isStreamingPaused = false;
      this.lastConnectionEvent = 'reconnected';
      this.notifySubscribers({ connectionEvent: 'reconnected', changedPrices: {} });
      this.lastConnectionEvent = null;
    };

    this._handleDisconnect = () => {
      this.isConnected = false;
      this.isStreamingPaused = true;
      this.lastConnectionEvent = 'disconnected';
      console.warn("Price feed disconnected.");
      this.notifySubscribers({ connectionEvent: 'disconnected', changedPrices: {} });
      this.lastConnectionEvent = null;
    };

    this._handleStockUpdate = (priceData = {}) => {
      const { symbol, ltp, change, percent_change, last_updated, data_type } = priceData;

      if (!symbol) return;

      const updateSource =
        data_type === 'LIVE_STOCK' ? 'TICK-BY-TICK (WebSocket)'
          : data_type === 'POLL_STOCK' ? 'MANUAL POLL (15s fallback)'
            : 'UNKNOWN';
      console.log(`📈 Price update for ${symbol}: ₹${ltp} (${updateSource})`);

      const newPrice = {
        ltp,
        change,
        percent_change,
        last_updated,
      };

      this.allPrices[symbol] = { ...this.allPrices[symbol], ...newPrice };
      const shouldFlash = !this.isStreamingPaused;
      this.notifySubscribers({
        changedPrices: shouldFlash ? { [symbol]: newPrice } : {},
        source: updateSource
      });
    };

    this._handleMarketStatus = (status = {}) => {
      this.isMarketOpen = status.isOpen;
      this.notifySubscribers();
    };
  }

  /**
   * Initializes the service with the Socket.IO client instance.
   * This should be called once when the application starts (e.g., in SocketProvider.jsx).
   * @param {object} socketInstance - The connected socket.io-client instance.
   */
  init(socketInstance) {
    if (!socketInstance) {
      return;
    }

    if (this.socket === socketInstance) {
      return;
    }

    if (this.socket) {
      this._detachSocketListeners(this.socket);
    }

    this.socket = socketInstance;
    this._attachSocketListeners(this.socket);
    this.notifySubscribers();
  }

  reset() {
    if (this.socket) {
      this._detachSocketListeners(this.socket);
      this.socket = null;
    }
    this.isConnected = false;
    this.notifySubscribers();
  }

  _attachSocketListeners(socket) {
    socket.on('connect', this._handleConnect);
    socket.on('disconnect', this._handleDisconnect);
    socket.on('stock_update', this._handleStockUpdate);
    socket.on('market_status', this._handleMarketStatus);
  }

  _detachSocketListeners(socket) {
    socket.off('connect', this._handleConnect);
    socket.off('disconnect', this._handleDisconnect);
    socket.off('stock_update', this._handleStockUpdate);
    socket.off('market_status', this._handleMarketStatus);
  }

  /**
   * Subscribes a component to receive updates.
   * @param {function} callback - The function to call with new data.
   * @returns {function} A function to unsubscribe.
   */
  subscribe(callback) {
    this.subscribers.push(callback);
    // Immediately notify the new subscriber with the current state
    this.notifySubscribers({}, callback);
    
    return () => {
      this.subscribers = this.subscribers.filter(cb => cb !== callback);
    };
  }

  /**
   * Notifies all subscribed components with the latest data.
   * @param {object} data - Optional data containing specific changes.
   * @param {function} [singleCallback] - Optional callback to notify only one subscriber.
   */
  notifySubscribers(data = {}, singleCallback = null) {
    const payload = {
      allPrices: this.allPrices,
      changedPrices: data.changedPrices || {},
      isConnected: this.isConnected,
      isMarketOpen: this.isMarketOpen,
      isStreamingPaused: this.isStreamingPaused,
      connectionEvent: data.connectionEvent || null,
      error: data.error || null,
      source: data.source || null,
    };
    
    const callbacksToNotify = singleCallback ? [singleCallback] : this.subscribers;

    callbacksToNotify.forEach(callback => {
      try {
        callback(payload);
      } catch (error) {
        console.error('Error in price update subscriber:', error);
      }
    });
  }
  
  /**
   * Allows external parts of the app to set an error state.
   * @param {string} error - The error message to broadcast.
   */
  setError(error) {
    this.notifySubscribers({ error });
  }

  /**
   * Manually injects or updates a batch of prices into the service.
   * Useful for loading initial data from a REST API before WebSocket takes over.
   * @param {object} initialPrices - An object where keys are symbols and values are price data.
   */
  loadInitialPrices(initialPrices) {
    // Prices are already in rupees from backend
    const normalized = Object.fromEntries(
      Object.entries(initialPrices || {}).map(([sym, data]) => [
        sym,
        {
          ...data,
          ltp: data?.ltp,
          change: data?.change,
        },
      ])
    );
    this.allPrices = { ...this.allPrices, ...normalized };
    const shouldFlash = !this.isStreamingPaused;
    this.notifySubscribers({ changedPrices: shouldFlash ? normalized : {} });
  }

  /**
   * Update multiple prices at once (used by polling fallbacks or batch updates)
   * @param {object} priceMap - { SYMBOL: { ltp, change, percent_change, last_updated } }
   */
  updatePrices(priceMap = {}) {
    // Prices are already in rupees from backend
    const normalized = Object.fromEntries(
      Object.entries(priceMap).map(([sym, data]) => [
        sym,
        {
          ...data,
          ltp: data?.ltp,
          change: data?.change,
        },
      ])
    );
    this.allPrices = { ...this.allPrices, ...normalized };
    const shouldFlash = !this.isStreamingPaused;
    this.notifySubscribers({ changedPrices: shouldFlash ? normalized : {} });
  }

  /**
   * Set connection status and notify subscribers
   */
  setConnected(flag) {
    this.isConnected = !!flag;
    this.isStreamingPaused = !this.isConnected;
    this.notifySubscribers();
  }

  /**
   * Set market open/close status and notify subscribers
   */
  setMarketHours(flag) {
    this.isMarketOpen = !!flag;
    this.notifySubscribers();
  }
}

// Create and export a singleton instance
const priceUpdateService = new PriceUpdateService();
export default priceUpdateService;