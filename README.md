# TradeEasy: Real-Time Paper Trading Platform

TradeEasy is an institutional-grade, real-time paper trading environment for the Indian Stock Market (NSE/BSE). Built with a focus on high-frequency data handling, state synchronization, and premium UI/UX, it mirrors a live brokerage experience without financial risk.

**Core Architecture Highlights**
* **Live WebSocket Feeds:** Custom backend Socket.IO manager subscribing to Motilal Oswal's binary Broadcast API.
* **Room-Isolated Ticks:** Frontend React clients dynamically join/leave Socket.IO "rooms" per stock to minimize bandwidth and CPU overhead.
* **Optimistic UI Updates:** Instantaneous order execution feedback with background sync reconciliation.
* **In-Memory Caching:** Thread-safe backend caching (TTL/LRU) to protect against API rate limits.
* **Corporate Actions Engine:** Automated scraping and adjustment of splits/bonuses to prevent artificial P&L spikes.

**Tech Stack**
* **Frontend:** React, Vite, Tailwind CSS, Framer Motion, Recharts, Radix UI.
* **Backend:** Python, Flask, Flask-SocketIO, MongoEngine (MongoDB).
* **Brokerage API:** Motilal Oswal (MOAPI) & Yahoo Finance (Historical OHLCV).

**Getting Started**
1. Ensure MongoDB is running locally or via Atlas.
2. `cd backend` -> `pip install -r requirements.txt` -> `python run.py`
3. `cd frontend` -> `npm install` -> `npm run dev`