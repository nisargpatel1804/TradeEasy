# Core Background Services

This directory contains the business logic that keeps the trading engine accurate and responsive.

* **`cache.py`**: A custom thread-safe, in-memory LRU/TTL cache layer using SHA256 hashed request signatures to aggressively reduce upstream API calls.
* **`order_processor.py`**: Background thread that continuously monitors `PENDING` transactions, applying limit/stop-loss logic against live market ticks, and executing auto-square-offs at 3:25 PM IST.
* **`corporate_actions.py`**: A daily scraper that checks for stock splits and bonuses, seamlessly adjusting user quantities and average purchase prices to maintain P&L integrity.
* **`market_time.py`**: Indian Standard Time (IST) aware validator handling market hours, weekends, and dynamically fetched trading holidays.