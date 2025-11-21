/**
 * Price Update Service (Singleton)
 * * Manages real-time price updates by listening to a Socket.IO client. This service
 * centralizes all incoming price data from the backend WebSocket and efficiently
 * distributes it to any subscribed React components.
 */
class PriceUpdateService {
  constructor() {
    this.socket = null;
    this.subscribers = new Set();
    this.latestPrices = {}; // Cache for the most recent price of each symbol
    this._stockUpdateHandler = null;
    this._indexUpdateHandler = null;
    this._initialSnapshotHandler = null;
  this._initialIndicesHandler = null;
  }

  /**
   * Initializes the service with the application's Socket.IO client instance.
   * This should only be called once, typically from a central context provider.
   * @param {object} socketInstance - The connected socket.io-client instance.
   */
  initialize(socketInstance) {
    if (!socketInstance) {
      return;
    }

    if (this.socket === socketInstance) {
      return;
    }

    if (this.socket) {
      this._detachSocketListeners();
    }

    this.socket = socketInstance;
    this._attachSocketListeners();
    console.log("PriceUpdateService initialized and listening for socket events.");
  }

  /**
   * Backwards-compatible alias for initialize.
   * @param {object} socketInstance - The connected socket.io-client instance.
   */
  init(socketInstance) {
    this.initialize(socketInstance);
  }

  /**
   * Attaches listeners to the core socket events emitted by the backend.
   */
  _attachSocketListeners() {
    if (!this.socket) {
      return;
    }

    this._stockUpdateHandler = (data = {}) => {
      const symbol = data.symbol;
      if (!symbol) {
        return;
      }

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...data,
        symbol,
        entityType: 'stock',
      };

      this.latestPrices[symbol] = mergedPayload;
      this._notifySubscribers({ type: 'stock', symbol });
    };

    this._indexUpdateHandler = (data = {}) => {
      const symbol = data.symbol;
      if (!symbol) {
        return;
      }

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...data,
        entityType: 'index',
      };

      this.latestPrices[symbol] = mergedPayload; // Indices are also identified by a symbol-like key (e.g., 'NSE:26000')
      this._notifySubscribers({ type: 'index', symbol });
    };

    // Listener for individual stock price ticks
    this.socket.on('stock_update', this._stockUpdateHandler);

    // Listener for index price ticks
    this.socket.on('index_update', this._indexUpdateHandler);

    this._initialSnapshotHandler = (data = {}) => {
      if (!data || typeof data !== 'object') {
        return;
      }

      let mutated = false;
      Object.entries(data).forEach(([symbol, payload]) => {
        if (!symbol || typeof payload !== 'object') {
          return;
        }

        const mergedPayload = {
          ...(this.latestPrices[symbol] || {}),
          ...payload,
          symbol,
          entityType: payload.entityType || 'stock',
        };

        this.latestPrices[symbol] = mergedPayload;
        mutated = true;
      });

      if (mutated) {
        this._notifySubscribers({ type: 'snapshot' });
      }
    };

    this.socket.on('initial_stock_prices', this._initialSnapshotHandler);

    this._initialIndicesHandler = (data = []) => {
      if (!Array.isArray(data)) {
        return;
      }

      const priceMap = {};
      data.forEach((payload = {}) => {
        const symbol = payload.symbol;
        if (!symbol) {
          return;
        }

        priceMap[symbol] = {
          ...(payload || {}),
          symbol,
          entityType: 'index',
        };
      });

      if (Object.keys(priceMap).length > 0) {
        this.seedPrices(priceMap);
      }
    };

    this.socket.on('initial_indices', this._initialIndicesHandler);
  }

  _detachSocketListeners() {
    if (!this.socket) {
      return;
    }

    if (this._stockUpdateHandler) {
      this.socket.off('stock_update', this._stockUpdateHandler);
    }

    if (this._indexUpdateHandler) {
      this.socket.off('index_update', this._indexUpdateHandler);
    }

    if (this._initialSnapshotHandler) {
      this.socket.off('initial_stock_prices', this._initialSnapshotHandler);
    }

    if (this._initialIndicesHandler) {
      this.socket.off('initial_indices', this._initialIndicesHandler);
    }

    this._stockUpdateHandler = null;
    this._indexUpdateHandler = null;
    this._initialSnapshotHandler = null;
    this._initialIndicesHandler = null;
  }

  /**
   * Subscribes a callback function to receive real-time updates.
   * @param {function} callback - The function to be called with new price data.
   * @returns {function} A function to unsubscribe the callback.
   */
  subscribe(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.subscribers.add(callback);

    try {
      callback(this._createBroadcastPayload({ type: 'snapshot' }));
    } catch (error) {
      console.error('Error delivering initial price snapshot to subscriber:', error);
    }

    // Return an unsubscribe function for cleanup
    return () => this.subscribers.delete(callback);
  }

  /**
   * Clears socket listeners and cached data, allowing a fresh re-initialization later.
   */
  reset() {
    if (this.socket) {
      this._detachSocketListeners();
    }
    this.socket = null;
    this.latestPrices = {};
    this._notifySubscribers({ type: 'reset' });
  }

  /**
   * Notifies all active subscribers with the new data.
   * @param {object} data - The price data received from the WebSocket.
   */
  _notifySubscribers(payload = {}) {
    const broadcast = this._createBroadcastPayload(payload);
    this.subscribers.forEach(callback => {
      try {
        callback(broadcast);
      } catch (error) {
        console.error("Error in price update subscriber:", error);
      }
    });
  }

  _cloneLatestPrices() {
    const snapshot = {};
    for (const [symbol, value] of Object.entries(this.latestPrices)) {
      snapshot[symbol] = { ...value };
    }
    return snapshot;
  }

  _createBroadcastPayload({ type = 'snapshot', symbol = null } = {}) {
    const allPrices = this._cloneLatestPrices();
    const changedPrices = symbol && allPrices[symbol]
      ? { [symbol]: { ...allPrices[symbol] } }
      : {};

    return {
      type,
      symbol,
      data: symbol && allPrices[symbol] ? { ...allPrices[symbol] } : null,
      changedPrices,
      allPrices,
    };
  }

  /**
   * Retrieves the most recent cached price for a given symbol.
   * @param {string} symbol - The stock or index symbol.
   * @returns {object|null} The latest price data or null if not available.
   */
  getLatestPrice(symbol) {
    return this.latestPrices[symbol] || null;
  }

  /**
   * Seeds the cache with pre-fetched prices and notifies subscribers.
   * Useful for priming the UI with REST-fetched data before live ticks arrive.
   * @param {Object<string, object>} priceMap - Map of symbol to price payloads.
   */
  seedPrices(priceMap = {}) {
    if (!priceMap || typeof priceMap !== 'object') {
      return;
    }

    let mutated = false;
    Object.entries(priceMap).forEach(([symbol, payload]) => {
      if (!symbol || typeof payload !== 'object') {
        return;
      }

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...payload,
        symbol,
        entityType: payload.entityType || 'stock',
      };

      this.latestPrices[symbol] = mergedPayload;
      mutated = true;
    });

    if (mutated) {
      this._notifySubscribers({ type: 'snapshot' });
    }
  }
}

// Export a single, singleton instance of the service for the entire application.
const priceUpdateService = new PriceUpdateService();
export default priceUpdateService;
