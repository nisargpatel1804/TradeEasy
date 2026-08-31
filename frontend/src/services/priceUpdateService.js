/**
 * Price Update Service (Singleton)
 * Manages real-time price updates by listening to a Socket.IO client.
 * Implements Socket.IO Room Isolation to drastically reduce bandwidth and CPU usage.
 */
class PriceUpdateService {
  constructor() {
    this.socket = null;
    this.subscribers = new Set();
    this.latestPrices = {}; 
    this.maxLatestPriceEntries = 4000;
    
    // Tracks active rooms so we can re-join them on reconnect
    this.activeRooms = new Set(['indices']); // Always subscribe to global indices

    this._stockUpdateHandler = null;
    this._indexUpdateHandler = null;
    this._initialSnapshotHandler = null;
    this._initialIndicesHandler = null;
    this._connectHandler = null;
  }

  _deferToNextFrame(callback) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 0);
  }

  _pruneLatestPrices() {
    const keys = Object.keys(this.latestPrices);
    const overflow = keys.length - this.maxLatestPriceEntries;
    if (overflow <= 0) {
      return;
    }

    for (let idx = 0; idx < overflow; idx += 1) {
      delete this.latestPrices[keys[idx]];
    }
  }

  initialize(socketInstance) {
    if (!socketInstance || this.socket === socketInstance) {
      return;
    }

    if (this.socket) {
      this._detachSocketListeners();
    }

    this.socket = socketInstance;
    this._attachSocketListeners();
  }

  init(socketInstance) {
    this.initialize(socketInstance);
  }

  // --- Room Isolation Management ---

  /**
   * Tells the backend to send live ticks for specific symbols.
   */
  watchSymbols(symbols) {
    if (!Array.isArray(symbols)) return;
    symbols.forEach(sym => {
      if (!sym) return;
      const room = `stock:${sym}`;
      this.activeRooms.add(room);
      if (this.socket && this.socket.connected) {
        this.socket.emit('join_room', { room });
      }
    });
  }

  /**
   * Tells the backend to stop sending live ticks for specific symbols.
   */
  unwatchSymbols(symbols) {
    if (!Array.isArray(symbols)) return;
    symbols.forEach(sym => {
      if (!sym) return;
      const room = `stock:${sym}`;
      this.activeRooms.delete(room);
      if (this.socket && this.socket.connected) {
        this.socket.emit('leave_room', { room });
      }
    });
  }

  _attachSocketListeners() {
    if (!this.socket) return;

    // Automatically rejoin all active rooms when socket connects/reconnects
    this._connectHandler = () => {
      this.activeRooms.forEach(room => {
        this.socket.emit('join_room', { room });
      });
    };
    this.socket.on('connect', this._connectHandler);

    this._stockUpdateHandler = (data = {}) => {
      const symbol = data.symbol;
      if (!symbol) return;

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...data,
        symbol,
        entityType: 'stock',
      };

      this.latestPrices[symbol] = mergedPayload;
      this._pruneLatestPrices();
      this._notifySubscribers({ type: 'stock', symbol });
    };

    this._indexUpdateHandler = (data = {}) => {
      const symbol = data.symbol;
      if (!symbol) return;

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...data,
        entityType: 'index',
      };

      this.latestPrices[symbol] = mergedPayload; // Indices are also identified by a symbol-like key
      this._pruneLatestPrices();
      this._notifySubscribers({ type: 'index', symbol });
    };

    // Batch update handlers for improved performance
    this._stockBatchUpdateHandler = (payload = {}) => {
      const dataArray = payload.updates || [];
      if (!Array.isArray(dataArray) || dataArray.length === 0) return;

      const changedSymbols = [];
      dataArray.forEach((data = {}) => {
        const symbol = data.symbol;
        if (!symbol) return;

        const mergedPayload = {
          ...(this.latestPrices[symbol] || {}),
          ...data,
          symbol,
          entityType: 'stock',
        };

        this.latestPrices[symbol] = mergedPayload;
        changedSymbols.push(symbol);
      });

      this._pruneLatestPrices();

      if (changedSymbols.length > 0) {
        this._notifySubscribers({ 
          type: 'stock_batch', 
          symbols: changedSymbols,
          count: changedSymbols.length 
        });
      }
    };

    this._indexBatchUpdateHandler = (payload = {}) => {
      const dataArray = payload.updates || [];
      if (!Array.isArray(dataArray) || dataArray.length === 0) return;

      const changedSymbols = [];
      dataArray.forEach((data = {}) => {
        const symbol = data.symbol;
        if (!symbol) return;

        const mergedPayload = {
          ...(this.latestPrices[symbol] || {}),
          ...data,
          symbol,
          entityType: 'index',
        };

        this.latestPrices[symbol] = mergedPayload;
        changedSymbols.push(symbol);
      });

      this._pruneLatestPrices();

      if (changedSymbols.length > 0) {
        this._notifySubscribers({ 
          type: 'index_batch', 
          symbols: changedSymbols,
          count: changedSymbols.length 
        });
      }
    };

    this.socket.on('stock_update', this._stockUpdateHandler);
    this.socket.on('index_update', this._indexUpdateHandler);
    this.socket.on('stock_updates_batch', this._stockBatchUpdateHandler);
    this.socket.on('index_updates_batch', this._indexBatchUpdateHandler);

    this._initialSnapshotHandler = (data = {}) => {
      if (!data || typeof data !== 'object') return;

      let mutated = false;
      Object.entries(data).forEach(([symbol, payload]) => {
        if (!symbol || typeof payload !== 'object') return;

        const mergedPayload = {
          ...(this.latestPrices[symbol] || {}),
          ...payload,
          symbol,
          entityType: payload.entityType || 'stock',
        };

        this.latestPrices[symbol] = mergedPayload;
        mutated = true;
      });

      this._pruneLatestPrices();

      if (mutated) {
        this._notifySubscribers({ type: 'snapshot' });
      }
    };

    this.socket.on('initial_stock_prices', this._initialSnapshotHandler);

    this._initialIndicesHandler = (data = []) => {
      if (!Array.isArray(data)) return;

      const priceMap = {};
      data.forEach((payload = {}) => {
        const symbol = payload.symbol;
        if (!symbol) return;

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
    if (!this.socket) return;

    if (this._connectHandler) this.socket.off('connect', this._connectHandler);
    if (this._stockUpdateHandler) this.socket.off('stock_update', this._stockUpdateHandler);
    if (this._indexUpdateHandler) this.socket.off('index_update', this._indexUpdateHandler);
    if (this._stockBatchUpdateHandler) this.socket.off('stock_updates_batch', this._stockBatchUpdateHandler);
    if (this._indexBatchUpdateHandler) this.socket.off('index_updates_batch', this._indexBatchUpdateHandler);
    if (this._initialSnapshotHandler) this.socket.off('initial_stock_prices', this._initialSnapshotHandler);
    if (this._initialIndicesHandler) this.socket.off('initial_indices', this._initialIndicesHandler);

    this._connectHandler = null;
    this._stockUpdateHandler = null;
    this._indexUpdateHandler = null;
    this._stockBatchUpdateHandler = null;
    this._indexBatchUpdateHandler = null;
    this._initialSnapshotHandler = null;
    this._initialIndicesHandler = null;
  }

  subscribe(callback) {
    if (typeof callback !== 'function') return () => {};

    this.subscribers.add(callback);

    try {
      callback(this._createBroadcastPayload({ type: 'snapshot' }));
    } catch (error) {
      console.error('Error delivering initial price snapshot to subscriber:', error);
    }

    return () => this.subscribers.delete(callback);
  }

  reset() {
    if (this.socket) {
      this._detachSocketListeners();
    }
    this.socket = null;
    this.latestPrices = {};
    this.activeRooms = new Set(['indices']); // Reset rooms
    this._notifySubscribers({ type: 'reset' });
  }

  clearPrices({ defer = false } = {}) {
    this.latestPrices = {};

    const notifyReset = () => this._notifySubscribers({ type: 'reset' });
    if (defer) {
      this._deferToNextFrame(notifyReset);
      return;
    }

    notifyReset();
  }

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

  _createBroadcastPayload({ type = 'snapshot', symbol = null, symbols = null } = {}) {
    const isIncremental = type !== 'snapshot' && type !== 'reset';

    if (type === 'reset') {
      return {
        type,
        symbol: null,
        symbols: null,
        data: null,
        changedPrices: {},
        allPrices: {},
      };
    }

    if (isIncremental) {
      let changedPrices = {};
      if (symbol) {
        const entry = this.latestPrices[symbol];
        if (entry) changedPrices[symbol] = { ...entry };
      } else if (symbols?.length) {
        symbols.forEach((sym) => {
          const entry = this.latestPrices[sym];
          if (entry) changedPrices[sym] = { ...entry };
        });
      }
      return {
        type,
        symbol,
        symbols,
        data: changedPrices[symbol] || null,
        changedPrices,
        allPrices: null,
      };
    }

    const allPrices = this._cloneLatestPrices();
    let changedPrices = {};
    if (symbols?.length) {
      symbols.forEach((sym) => {
        if (allPrices[sym]) changedPrices[sym] = { ...allPrices[sym] };
      });
    } else if (symbol && allPrices[symbol]) {
      changedPrices = { [symbol]: { ...allPrices[symbol] } };
    }
    return {
      type,
      symbol,
      symbols,
      data: symbol && allPrices[symbol] ? { ...allPrices[symbol] } : null,
      changedPrices,
      allPrices,
    };
  }

  getLatestPrice(symbol) {
    return this.latestPrices[symbol] || null;
  }

  /**
   * Seeds the cache and automatically joins Socket.IO rooms for the requested symbols.
   */
  seedPrices(priceMap = {}) {
    if (!priceMap || typeof priceMap !== 'object') return;

    let mutated = false;
    const symbolsToWatch = [];

    Object.entries(priceMap).forEach(([symbol, payload]) => {
      if (!symbol || typeof payload !== 'object') return;

      const mergedPayload = {
        ...(this.latestPrices[symbol] || {}),
        ...payload,
        symbol,
        entityType: payload.entityType || 'stock',
      };

      this.latestPrices[symbol] = mergedPayload;
      symbolsToWatch.push(symbol);
      mutated = true;
    });

    this._pruneLatestPrices();

    // Automatically instruct the backend to route these ticks to us
    if (symbolsToWatch.length > 0) {
      this.watchSymbols(symbolsToWatch);
    }

    if (mutated) {
      this._notifySubscribers({ type: 'snapshot' });
    }
  }
}

// Export a single, singleton instance of the service for the entire application.
const priceUpdateService = new PriceUpdateService();
export default priceUpdateService;