# TradeEasy Frontend App

A high-performance, dashboard-first React SPA built with Vite. It features a custom design system blending Glassmorphism with strict data-density principles for financial applications.

**Performance Optimizations**
* **Debounced Search:** Local search caching with 300ms debounce to prevent API spam.
* **Component Memoization:** Heavy use of `useMemo` and `React.memo` to prevent React from re-rendering the entire DOM tree on every sub-second price tick.
* **Socket Room Isolation:** The UI explicitly instructs the backend to only send WebSocket ticks for actively viewed stocks (Watchlist/Holdings), cutting browser memory usage by 90%.

**Styling & UI**
* **Tailwind CSS:** Fully customized theme with semantic variables (e.g., `primary`, `destructive`, `muted`).
* **Framer Motion:** Smooth layout transitions, micro-interactions, and ambient background animations.
* **Radix UI:** Accessible, unstyled primitive components wrapped with custom TradeEasy CSS.