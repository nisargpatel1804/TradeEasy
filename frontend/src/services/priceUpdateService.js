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
  }

  /**
   * Initializes the service with the application's Socket.IO client instance.
   * This should only be called once, typically from a central context provider.
   * @param {object} socketInstance - The connected socket.io-client instance.
   */
  initialize(socketInstance) {
    if (this.socket || !socketInstance) {
      return;
    }
    this.socket = socketInstance;
    this._attachSocketListeners();
    console.log("PriceUpdateService initialized and listening for socket events.");
  }

  /**
   * Attaches listeners to the core socket events emitted by the backend.
   */
  _attachSocketListeners() {
    // Listener for individual stock price ticks
    this.socket.on('stock_update', (data) => {
      this.latestPrices[data.symbol] = data;
      this._notifySubscribers(data);
    });

    // Listener for index price ticks
    this.socket.on('index_update', (data) => {
      this.latestPrices[data.symbol] = data; // Indices are also identified by a symbol-like key (e.g., 'NSE:26000')
      this._notifySubscribers(data);
    });
  }

  /**
   * Subscribes a callback function to receive real-time updates.
   * @param {function} callback - The function to be called with new price data.
   * @returns {function} A function to unsubscribe the callback.
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    // Return an unsubscribe function for cleanup
    return () => this.subscribers.delete(callback);
  }

  /**
   * Notifies all active subscribers with the new data.
   * @param {object} data - The price data received from the WebSocket.
   */
  _notifySubscribers(data) {
    this.subscribers.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error("Error in price update subscriber:", error);
      }
    });
  }

  /**
   * Retrieves the most recent cached price for a given symbol.
   * @param {string} symbol - The stock or index symbol.
   * @returns {object|null} The latest price data or null if not available.
   */
  getLatestPrice(symbol) {
    return this.latestPrices[symbol] || null;
  }
}

// Export a single, singleton instance of the service for the entire application.
const priceUpdateService = new PriceUpdateService();
export default priceUpdateService;
