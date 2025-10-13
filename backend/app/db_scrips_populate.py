import logging
import sys
from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
from datetime import datetime
from mongoengine.errors import NotUniqueError

from app.moapi.mo_api import MotilalOswalAPI
from app.models import AQScrip

# --- Configuration ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
data_management_bp = Blueprint("data_management", __name__)

def _map_api_to_model_data(scrip_data: dict, exchange: str) -> dict:
    """
    Safely maps a scrip dictionary from the MO API response to the AQScrip model format.
    Handles type casting and provides default values for missing or null fields.
    """
    try:
        return {
            'exchange': int(scrip_data.get('exchange') or 0),
            'exchangename': scrip_data.get('exchangename', exchange),
            'scripcode': int(scrip_data.get('scripcode')),
            'scripname': str(scrip_data.get('scripname', '')),
            'scripshortname': str(scrip_data.get('scripshortname', '')),
            'scripfullname': str(scrip_data.get('scripfullname', '')),
            'marketlot': int(scrip_data.get('marketlot') or 1),
            'issuspended': str(scrip_data.get('issuspended', 'N')),
            'instrumentname': str(scrip_data.get('instrumentname', '')).strip(),
            'expirydate': int(scrip_data.get('expirydate') or 0),
            'strikeprice': float(scrip_data.get('strikeprice') or 0.0),
            'optiontype': str(scrip_data.get('optiontype', '')).strip(),
            'ticksize': float(scrip_data.get('ticksize') or 0.05),
            'scripisinno': str(scrip_data.get('scripisinno', '')),
            'isbanscrip': str(scrip_data.get('isbanscrip', 'N')),
            'updated_at': datetime.utcnow()
        }
    except (ValueError, TypeError) as e:
        logger.error(f"Data mapping error for scrip {scrip_data.get('scripcode')}: {e}")
        return None

@data_management_bp.route("/populate-scrips", methods=["POST"])
@login_required
def populate_scrips_endpoint():
    """
    API endpoint to fetch and populate scrips. Uses an efficient 'upsert' operation
    to update existing scrips or insert new ones without needing to check first.
    """
    try:
        data = request.get_json() or {}
        logger.info(f"Scrip population endpoint triggered by user: {current_user.client_id}")
        exchanges = data.get("exchanges", ["NSE", "BSE", "NSEFO", "NSECD", "MCX"])
        
        mo_api = MotilalOswalAPI()
        if not mo_api.login():
            return jsonify({"status": "error", "message": "Failed to authenticate with MO API"}), 500
        
        stats = {"total_processed": 0, "total_upserted": 0, "exchanges": {}}

        for exchange in exchanges:
            logger.info(f"Processing exchange: {exchange}")
            scrips_response = mo_api.get_scrips_by_exchange(exchange)
            
            if not (scrips_response and scrips_response.get("status") == "SUCCESS"):
                logger.warning(f"Failed to fetch scrips for {exchange}. Response: {scrips_response}")
                continue

            scrips_list = scrips_response.get("data", [])
            exchange_upserted = 0

            for scrip_api_data in scrips_list:
                model_data = _map_api_to_model_data(scrip_api_data, exchange)
                if not model_data: continue

                # Use update_one with upsert=True for high efficiency
                result = AQScrip.objects(
                    scripcode=model_data['scripcode'], 
                    exchangename=model_data['exchangename']
                ).update_one(set__=model_data, upsert=True)
                
                if result.upserted_id or result.modified_count > 0:
                    exchange_upserted += 1
            
            stats["total_processed"] += len(scrips_list)
            stats["total_upserted"] += exchange_upserted
            stats["exchanges"][exchange] = {"processed": len(scrips_list), "upserted": exchange_upserted}
            logger.info(f"Completed {exchange}: {len(scrips_list)} processed, {exchange_upserted} upserted.")
        
        logger.info(f"Scrip population finished. Final stats: {stats}")
        return jsonify({"status": "success", "message": "Scrip population complete.", "data": stats})
        
    except Exception as e:
        logger.error(f"Error in /populate-scrips endpoint: {e}", exc_info=True)
        return jsonify({"status": "error", "message": "An internal server error occurred."}), 500

def populate_scrips_from_scratch():
    """
    Standalone function for a full, clean population of the scrips database.
    It clears all existing data and uses efficient bulk inserts for maximum speed.
    """
    print("--- Starting Full Scrip Database Population ---")
    try:
        print("Clearing existing AQ_scrips collection...")
        count = AQScrip.objects.delete()
        print(f"Deleted {count} existing scrips.")
        
        mo_api = MotilalOswalAPI()
        print("Logging into Motilal Oswal API...")
        if not mo_api.login():
            print("ERROR: API login failed. Aborting.")
            return False
        print("API Login successful.")

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
                    # Perform the bulk insert operation
                    AQScrip.objects.insert(new_scrips_to_insert, load_bulk=False)
                    print(f"Successfully inserted {len(new_scrips_to_insert)} scrips for {exchange}.")
                    total_inserted += len(new_scrips_to_insert)
                except NotUniqueError:
                    print(f"WARNING: Duplicate scrips found for {exchange}. This should not happen on a clean import.")
                except Exception as e:
                    print(f"ERROR: Bulk insert failed for {exchange}: {e}")
        
        print("\n--- Scrip Population Complete ---")
        print(f"Total scrips inserted across all exchanges: {total_inserted}")
        return True
        
    except Exception as e:
        print(f"\nFATAL ERROR during scrip population: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    """
    Main execution block to run the population script from the command line.
    Requires the script to be run from the project's root `backend` directory.
    """
    if len(sys.argv) > 1 and sys.argv[1] == 'populate':
        # This assumes the script is run from the 'backend' directory.
        # It ensures the app context is available for database connections.
        try:
            from app import create_app
            app = create_app()
            with app.app_context():
                if populate_scrips_from_scratch():
                    print("\n✅ Operation completed successfully!")
                    sys.exit(0)
                else:
                    print("\n❌ Operation failed.")
                    sys.exit(1)
        except Exception as e:
            print(f"Error setting up Flask app context: {e}")
            sys.exit(1)
    else:
        print("Usage: python -m app.db_scrips_populate populate")
        print("Ensure you run this command from the root 'backend' directory.")
