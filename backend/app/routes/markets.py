import logging
import time
from flask import Blueprint, jsonify
from flask_login import login_required

# Import the singleton WebSocket Manager to reuse its authenticated API instance.
# This is a key part of the performance improvement.
from app.socket_manager import MO_WebSocket_Manager

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
markets_bp = Blueprint("markets", __name__)


@markets_bp.route("/indices", methods=["GET"])
@login_required
def get_market_indices_efficiently():
    """
    Endpoint to get market indices efficiently using bulk data fetching.
    This avoids the N+1 problem by making only one data request per exchange,
    and it reuses the existing authenticated API session.
    """
    try:
        # Get the singleton instance of the manager, which holds our authenticated session.
        socket_manager = MO_WebSocket_Manager()
        mo_api = socket_manager.mo_api

        if not mo_api.auth_token:
            logger.error("MO API is not authenticated via the WebSocket Manager.")
            return jsonify({"error": "API authentication is not ready, please try again shortly."}), 503

        market_status = "OPEN" if mo_api.market_hours.is_market_open() else "CLOSED"
        
        all_indices = []
        exchanges = ["NSE", "BSE"]

        for exchange in exchanges:
            # Step 1: Get the master list of all indices (names and codes).
            index_list_response = mo_api.get_index_data(exchange)
            if not (index_list_response and index_list_response.get("status") == "SUCCESS"):
                logger.warning(f"Failed to get index list for {exchange}.")
                continue
            indices_master_list = index_list_response.get("data", [])

            # Step 2: Get bulk price data for ALL instruments on the exchange in ONE single call.
            bulk_data_response = mo_api.get_bulk_eod_data(exchange)
            if not (bulk_data_response and bulk_data_response.get("status") == "SUCCESS"):
                logger.warning(f"Failed to get bulk EOD/LTP data for {exchange}.")
                continue
            bulk_price_map = bulk_data_response.get("data", {})

            # Step 3: Combine the master list with the price data using the efficient map.
            for index_info in indices_master_list:
                index_code = str(index_info.get("indexcode"))
                index_name = index_info.get("indexname")
                
                # Find the price data instantly in the map (O(1) complexity).
                price_data = bulk_price_map.get(index_code)

                if price_data:
                    # Indices are points per business requirement; treat numeric values as points
                    # If backend returns paisa for indices in the future, remove division-free logic accordingly.
                    raw_ltp = price_data.get("ltp", 0) or price_data.get("close", 0)
                    raw_close = price_data.get("close", 0)
                    raw_open = price_data.get("open", 0)

                    # If values appear very large (e.g., > 1e6), assume they are in paisa and convert once.
                    def to_points(v):
                        try:
                            fv = float(v or 0)
                            return fv / 100.0 if fv > 100000 else fv
                        except Exception:
                            return 0.0

                    current_price = to_points(raw_ltp)
                    previous_close = to_points(raw_close)
                    open_price = to_points(raw_open)

                    # --- Standardized Calculations ---
                    # 1. Daily Change (from previous close)
                    change_daily = current_price - previous_close
                    percent_change_daily = (change_daily / previous_close * 100) if previous_close else 0

                    # 2. Intraday Change (from today's open)
                    change_intraday = current_price - open_price if open_price > 0 else 0
                    percent_change_intraday = (change_intraday / open_price * 100) if open_price else 0

                    formatted_index = {
                        "symbol": f"{exchange}:{index_code}", "name": index_name,
                        "exchange": exchange, "price": current_price,
                        "open": open_price, "high": to_points(price_data.get("high", 0)),
                        "low": to_points(price_data.get("low", 0)), "close": previous_close, "ltp": current_price,
                        
                        # Deprecated fields (for backward compatibility if needed)
                        "change": round(change_daily, 2),
                        "percent_change": round(percent_change_daily, 2),

                        # New Standardized Fields
                        "change_daily": round(change_daily, 2),
                        "percent_change_daily": round(percent_change_daily, 2),
                        "change_intraday": round(change_intraday, 2),
                        "percent_change_intraday": round(percent_change_intraday, 2),

                        "data_type": "LIVE" if market_status == "OPEN" else "EOD",
                        "last_updated": int(time.time() * 1000)
                    }
                    all_indices.append(formatted_index)
                else:
                    logger.debug(f"Price data for index {index_code} ({index_name}) not found in bulk response.")

        logger.info(f"Successfully fetched {len(all_indices)} indices using efficient bulk method.")
        
        response_data = {
            "indices": all_indices,
            "metadata": {
                "market_status": market_status,
                "total_indices": len(all_indices),
                "timestamp": int(time.time() * 1000)
            }
        }
        
        return jsonify(response_data)

    except Exception as e:
        logger.error(f"Error in /indices endpoint: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred."}), 500