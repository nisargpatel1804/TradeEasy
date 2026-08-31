# TradeEasy Backend Engine

A robust Flask-based REST API and WebSocket server handling authentication, trade execution, and real-time market data streaming.

**Key Modules**
* `/app/moapi`: Custom wrappers and binary packet parsers for the Motilal Oswal API.
* `/app/routes`: RESTful endpoints for Auth, Portfolios, Orders, and Chart Data.
* `/app/services`: Background workers, caching logic, and scheduled cron jobs.
* `socket_manager.py`: A singleton WebSocket client/server hybrid. It connects to the upstream broker feed via standard WebSockets, parses binary ticks, and rebroadcasts them to frontend clients using isolated Socket.IO rooms.
* `scheduler.py`: APScheduler implementation for end-of-day portfolio snapshots, order expiry, and corporate action resolution.