# TradeEasy Backend (Flask) — Deploy on Render (Free)

## Build / Start
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `python run.py`

## Required Render Environment Variables
- `SECRET_KEY` (required)
- `MONGODB_URI` (required)
- `MONGO_DB_NAME` (required)
- `FLASK_DEBUG=false`
- `FRONTEND_URL=https://<your-vercel-app>.vercel.app`

## Order Processor (required for pending orders)
This backend includes a background order processor thread.

- Enable it on Render with: `ENABLE_ORDER_PROCESSOR=1`
- Do **not** set `WERKZEUG_RUN_MAIN` on Render. That variable is used internally by Werkzeug and can crash the server.

## Notes
- Render provides `PORT` automatically. Avoid setting a custom `PORT` env var.
- `GET /` is a health endpoint.
