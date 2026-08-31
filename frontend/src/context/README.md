# Application State Management

TradeEasy utilizes React Context + Custom Hooks for global state, avoiding heavy dependencies like Redux.

* **`AuthContext.jsx`**: Manages session state, handles login/logout, and orchestrates local-storage cache clearing upon session expiry.
* **`DataContext.jsx`**: The central data repository. Fetches, caches, and provides Portfolios, Watchlists, and Orders. Automatically instructs the `SocketContext` which rooms to join based on user holdings.
* **`SocketContext.jsx`**: Manages the Socket.IO connection lifecycle, automatic reconnections, and network fallback transports.