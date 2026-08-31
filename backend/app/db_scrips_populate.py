import logging
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from datetime import datetime
from mongoengine.errors import NotUniqueError
from pymongo import UpdateOne

from app.moapi import get_mo_api_client
from app.models import AQScrip

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
data_management_bp = Blueprint("data_management", __name__)

BATCH_SIZE = 5000  # Process bulk operations in chunks to manage memory

def _map_api_to_model_data(scrip_data: dict, exchange: str) -> dict:
    """
    Safely maps a scrip dictionary from the MO API response to the AQScrip model format.
    Handles type casting, strips whitespace for data resilience, and provides defaults.
    """
    try:
        return {
            'exchange': int(scrip_data.get('exchange') or 0),
            'exchangename': str(scrip_data.get('exchangename', exchange)).strip(),
            'scripcode': int(scrip_data.get('scripcode')),
            'scripname': str(scrip_data.get('scripname', '')).strip(),
            'scripshortname': str(scrip_data.get('scripshortname', '')).strip(),
            'scripfullname': str(scrip_data.get('scripfullname', '')).strip(),
            'marketlot': int(scrip_data.get('marketlot') or 1),
            'issuspended': str(scrip_data.get('issuspended', 'N')).strip(),
            'instrumentname': str(scrip_data.get('instrumentname', '')).strip(),
            'expirydate': int(scrip_data.get('expirydate') or 0),
            'strikeprice': float(scrip_data.get('strikeprice') or 0.0),
            'optiontype': str(scrip_data.get('optiontype', '')).strip(),
            'ticksize': float(scrip_data.get('ticksize') or 0.05),
            'scripisinno': str(scrip_data.get('scripisinno', '')).strip(),
            'isbanscrip': str(scrip_data.get('isbanscrip', 'N')).strip(),
            'updated_at': datetime.utcnow()
        }
    except (ValueError, TypeError) as e:
        logger.error(f"Data mapping error for scrip {scrip_data.get('scripcode')}: {e}")
        return None

@data_management_bp.route("/populate-scrips", methods=["POST"])
@login_required
def populate_scrips_endpoint():
    """
    API endpoint to fetch and populate scrips. Uses efficient chunked 'upsert' operations.
    Accepts an optional JSON payload: {"exchanges": ["NSE", "BSE"]}
    """
    try:
        logger.info(f"Scrip population endpoint triggered by user: {current_user.client_id}")
        try:
            AQScrip.ensure_indexes()
        except Exception as idx_err:
            logger.warning(f"AQScrip pre-upsert ensure_indexes failed: {idx_err}")

        # Dynamic Exchange Selection with fallback
        req_data = request.get_json(silent=True) or {}
        exchanges = req_data.get("exchanges", ["NSE"])
        if not isinstance(exchanges, list) or not exchanges:
            exchanges = ["NSE"]
        
        mo_api = get_mo_api_client()
        if not mo_api.login():
            return jsonify({"status": "error", "message": "Failed to authenticate with MO API"}), 500
        
        stats = {"total_processed": 0, "total_upserted": 0, "total_suspended": 0, "exchanges": {}}

        for exchange in exchanges:
            logger.info(f"Processing exchange: {exchange}")
            scrips_response = mo_api.get_scrips_by_exchange(exchange)
            
            if not (scrips_response and scrips_response.get("status") == "SUCCESS"):
                logger.warning(f"Failed to fetch scrips for {exchange}. Response: {scrips_response}")
                continue

            scrips_list = scrips_response.get("data", [])
            operations = []
            now_utc = datetime.utcnow()
            
            for scrip_api_data in scrips_list:
                model_data = _map_api_to_model_data(scrip_api_data, exchange)
                if not model_data:
                    continue

                operations.append(
                    UpdateOne(
                        {
                            "scripcode": model_data['scripcode'],
                            "exchangename": model_data['exchangename'],
                        },
                        {
                            "$set": model_data,
                            "$setOnInsert": {"created_at": now_utc},
                        },
                        upsert=True,
                    )
                )

            # Process bulk writes in chunks to manage memory
            exchange_upserted = 0
            exchange_modified = 0
            collection = AQScrip._get_collection()
            
            if operations:
                for i in range(0, len(operations), BATCH_SIZE):
                    batch = operations[i:i + BATCH_SIZE]
                    bulk_result = collection.bulk_write(batch, ordered=False)
                    exchange_upserted += len(getattr(bulk_result, "upserted_ids", {}) or {})
                    exchange_modified += getattr(bulk_result, "modified_count", 0) or 0
            
            # Data Staleness Cleanup: Mark scrips that weren't in the API response as suspended/inactive
            suspended_count = AQScrip.objects(
                exchangename=exchange, 
                updated_at__lt=now_utc
            ).update(set__issuspended='Y')
            
            stats["total_processed"] += len(scrips_list)
            stats["total_upserted"] += exchange_upserted
            stats["total_suspended"] += suspended_count
            stats["exchanges"][exchange] = {
                "processed": len(scrips_list), 
                "upserted": exchange_upserted,
                "modified": exchange_modified,
                "suspended": suspended_count
            }
            logger.info(f"Completed {exchange}: {len(scrips_list)} processed, {exchange_upserted} new, {exchange_modified} updated, {suspended_count} marked suspended.")

        try:
            AQScrip.ensure_indexes()
        except Exception as idx_err:
            logger.warning(f"AQScrip post-upsert ensure_indexes failed: {idx_err}")
        
        logger.info(f"Scrip population finished. Final stats: {stats}")
        return jsonify({"status": "success", "message": "Scrip population complete.", "data": stats})
        
    except Exception as e:
        logger.error(f"Error in /populate-scrips endpoint: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "An internal server error occurred."}), 500

@data_management_bp.route("/trigger-scrip-update", methods=["POST"])
@login_required
def trigger_scrip_update():
    """
    Manually trigger the daily scrip update job immediately.
    Useful for testing or on-demand updates.
    """
    try:
        logger.info(f"Manual scrip update triggered by user: {current_user.client_id}")
        from app.scheduler import TaskScheduler
        scheduler = TaskScheduler()
        scheduler.trigger_scrip_update_now()
        return jsonify({"status": "success", "message": "Scrip update triggered successfully."})
    except Exception as e:
        logger.error(f"Error triggering scrip update: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "Failed to trigger scrip update."}), 500

def populate_scrips_from_scratch():
    """
    Standalone function for a full, clean population of the scrips database.
    It clears all existing data and uses efficient bulk inserts for maximum speed.
    """
    logger.info("--- Starting Full Scrip Database Population ---")
    try:
        logger.info("Clearing existing AQ_scrips collection...")
        count = AQScrip.objects.delete()
        logger.info(f"Deleted {count} existing scrips.")
        try:
            AQScrip.ensure_indexes()
        except Exception as idx_err:
            logger.warning(f"AQScrip ensure_indexes failed before fresh import: {idx_err}")
        
        mo_api = get_mo_api_client()
        logger.info("Logging into Motilal Oswal API...")
        if not mo_api.login():
            logger.error("API login failed; aborting population.")
            return False
        logger.info("API Login successful.")

        exchanges = ["NSE", "BSE", "NSEFO", "NSECD", "MCX"]
        total_inserted = 0

        for exchange in exchanges:
            print(f"\nFetching scrips for exchange: {exchange}...")
            scrips_response = mo_api.get_scrips_by_exchange(exchange)
            
            if not (scrips_response and scrips_response.get("status") == "SUCCESS"):
                print(f"WARNING: Failed to fetch scrips for {exchange}.")
                continue

            scrips_list_api = scrips_response.get("data", [])
            print(f"Found {len(scrips_list_api)} scrips for {exchange}. Preparing for bulk insert...")

            new_scrips_to_insert = []
            for scrip_api_data in scrips_list_api:
                model_data = _map_api_to_model_data(scrip_api_data, exchange)
                if model_data:
                    # Add created_at field for new documents
                    model_data['created_at'] = datetime.utcnow()
                    new_scrips_to_insert.append(AQScrip(**model_data))
            
            if new_scrips_to_insert:
                try:
                    # Chunked batch inserts to respect BSON limits
                    for i in range(0, len(new_scrips_to_insert), BATCH_SIZE):
                        batch = new_scrips_to_insert[i:i + BATCH_SIZE]
                        AQScrip.objects.insert(batch, load_bulk=False)
                    
                    print(f"Successfully inserted {len(new_scrips_to_insert)} scrips for {exchange}.")
                    total_inserted += len(new_scrips_to_insert)
                except NotUniqueError:
                    print(f"WARNING: Duplicate scrips found for {exchange}. This should not happen on a clean import.")
                except Exception as e:
                    print(f"ERROR: Bulk insert failed for {exchange}: {e}")
        try:
            AQScrip.ensure_indexes()
        except Exception as idx_err:
            logger.warning(f"AQScrip ensure_indexes failed after fresh import: {idx_err}")
        logger.info("\n--- Scrip Population Complete ---")
        logger.info(f"Total scrips inserted across all exchanges: {total_inserted}")
        return True
        
    except Exception as e:
        logger.error(f"FATAL ERROR during scrip population: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "populate":
        try:
            from app import create_app

            app = create_app()
            with app.app_context():
                if populate_scrips_from_scratch():
                    print("\n✅ Operation completed successfully!")
                    sys.exit(0)
                print("\n❌ Operation failed.")
                sys.exit(1)
        except Exception as e:
            print(f"Error setting up Flask app context: {e}")
            sys.exit(1)
    else:
        print("Usage: python -m app.db_scrips_populate populate")
        print("Ensure you run this command from the root 'backend' directory.")