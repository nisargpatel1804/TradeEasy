import logging
import sys
import os
from flask import Blueprint, jsonify, request
from datetime import datetime

# Add the backend directory to the Python path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.moapi.mo_api import MotilalOswalAPI
from app.models import AQScrip

# --- Configuration ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
data_management_bp = Blueprint("data_management", __name__)


@data_management_bp.route("/populate-scrips", methods=["POST"])
def populate_scrips():
    """
    Endpoint to fetch and populate all scrips from MO API into AQ_scrips collection.
    
    This endpoint will fetch scrips from multiple exchanges and store them in MongoDB.
    Expects JSON body with:
    - exchanges: List of exchange names (optional, defaults to major exchanges)
    - force_update: Boolean to force update existing records (optional, defaults to False)
    """
    try:
        data = request.get_json() or {}
        exchanges = data.get("exchanges", ["NSE", "NSECD", "MCX"])
        force_update = data.get("force_update", False)
        
        # Initialize MO API
        mo_api = MotilalOswalAPI()
        
        # Login to MO API
        logger.info("Attempting to login to MO API...")
        login_success = mo_api.login()
        logger.info(f"MO API login result: {login_success}")
        
        if not login_success:
            return jsonify({"error": "Failed to authenticate with MO API"}), 500
        
        total_processed = 0
        total_inserted = 0
        total_updated = 0
        exchange_stats = {}
        
        for exchange in exchanges:
            logger.info(f"Processing exchange: {exchange}")
            exchange_processed = 0
            exchange_inserted = 0
            exchange_updated = 0
            
            # Get scrips data for the exchange
            scrips_data = mo_api.get_scrips_by_exchange(exchange)
            
            logger.info(f"API Response for {exchange}: Status={scrips_data.get('status') if scrips_data else 'None'}")
            
            if scrips_data and scrips_data.get("status") == "SUCCESS":
                scrips = scrips_data.get("data", [])
                logger.info(f"Found {len(scrips)} scrips for {exchange}")
                
                for scrip in scrips:
                    try:
                        scripcode = scrip.get("scripcode")
                        exchangename = scrip.get("exchangename", exchange)
                        
                        if not scripcode:
                            continue
                        
                        # Check if scrip already exists
                        existing_scrip = AQScrip.objects(
                            scripcode=scripcode, 
                            exchangename=exchangename
                        ).first()
                        
                        if existing_scrip and not force_update:
                            # Skip if already exists and not forcing update
                            continue
                        
                        # Prepare scrip data
                        scrip_data = {
                            'exchange': scrip.get('exchange', 0),
                            'exchangename': exchangename,
                            'scripcode': scripcode,
                            'scripname': str(scrip.get('scripname', '')),
                            'scripshortname': str(scrip.get('scripshortname', '')),
                            'scripfullname': str(scrip.get('scripfullname', '')),
                            'marketlot': scrip.get('marketlot', 1),
                            'issuspended': str(scrip.get('issuspended', 'N')),
                            'instrumentname': str(scrip.get('instrumentname', '')),
                            'expirydate': scrip.get('expirydate', 0),
                            'strikeprice': scrip.get('strikeprice', 0),
                            'optiontype': str(scrip.get('optiontype', '')),
                            'markettype': str(scrip.get('markettype', '')),
                            'foexposurepercent': scrip.get('foexposurepercent', 0),
                            'lowercircuitprice': scrip.get('lowercircuitprice', 0),
                            'uppercircuitprice': scrip.get('uppercircuitprice', 0),
                            'ticksize': scrip.get('ticksize', 0.05),
                            'scripisinno': str(scrip.get('scripisinno', '')),
                            'indicesidentifier': scrip.get('indicesidentifier', 0),
                            'isbanscrip': str(scrip.get('isbanscrip', 'N')),
                            'facevalue': scrip.get('facevalue', 0),
                            'calevel': scrip.get('calevel', 0),
                            'maxqtyperorder': scrip.get('maxqtyperorder', 0),
                            'algoid': scrip.get('algoid', 0),
                            'ultoken': str(scrip.get('ultoken', '')),
                            'updated_at': datetime.utcnow()
                        }
                        
                        if existing_scrip:
                            # Update existing scrip
                            for key, value in scrip_data.items():
                                setattr(existing_scrip, key, value)
                            existing_scrip.save()
                            exchange_updated += 1
                            total_updated += 1
                        else:
                            # Create new scrip
                            scrip_data['created_at'] = datetime.utcnow()
                            new_scrip = AQScrip(**scrip_data)
                            new_scrip.save()
                            exchange_inserted += 1
                            total_inserted += 1
                        
                        exchange_processed += 1
                        total_processed += 1
                        
                        # Log progress every 100 scrips
                        if exchange_processed % 100 == 0:
                            logger.info(f"Processed {exchange_processed} scrips for {exchange}")
                    
                    except Exception as e:
                        logger.error(f"Error processing scrip {scripcode} from {exchange}: {e}")
                        continue
            
            else:
                logger.warning(f"Failed to fetch scrips for exchange {exchange}. Response: {scrips_data}")
                continue
            
            exchange_stats[exchange] = {
                "processed": exchange_processed,
                "inserted": exchange_inserted,
                "updated": exchange_updated
            }
            
            logger.info(f"Completed {exchange}: {exchange_processed} processed, {exchange_inserted} inserted, {exchange_updated} updated")
        
        logger.info(f"Scrips population completed. Total: {total_processed} processed, {total_inserted} inserted, {total_updated} updated")
        
        return jsonify({
            "status": "success",
            "message": "Scrips population completed",
            "total_processed": total_processed,
            "total_inserted": total_inserted,
            "total_updated": total_updated,
            "exchange_stats": exchange_stats
        })
        
    except Exception as e:
        logger.error(f"Error in /populate-scrips endpoint: {e}")
        return jsonify({"error": "An internal server error occurred while populating scrips."}), 500


@data_management_bp.route("/scrips-stats", methods=["GET"])
def get_scrips_stats():
    """
    Endpoint to get statistics about stored scrips data.
    """
    try:
        # Get total count
        total_count = AQScrip.objects.count()
        
        # Get count by exchange
        exchange_stats = {}
        exchanges = AQScrip.objects.distinct('exchangename')
        
        for exchange in exchanges:
            count = AQScrip.objects(exchangename=exchange).count()
            # Get count by instrument type for this exchange
            instruments = AQScrip.objects(exchangename=exchange).distinct('instrumentname')
            instrument_counts = {}
            for instrument in instruments:
                instrument_counts[instrument] = AQScrip.objects(
                    exchangename=exchange, 
                    instrumentname=instrument
                ).count()
            
            exchange_stats[exchange] = {
                "total": count,
                "instruments": instrument_counts
            }
        
        # Get latest update time
        latest_scrip = AQScrip.objects.order_by('-updated_at').first()
        latest_update = latest_scrip.updated_at if latest_scrip else None
        
        return jsonify({
            "total_scrips": total_count,
            "exchange_stats": exchange_stats,
            "latest_update": latest_update.isoformat() if latest_update else None
        })
        
    except Exception as e:
        logger.error(f"Error in /scrips-stats endpoint: {e}")
        return jsonify({"error": "An internal server error occurred while fetching scrips stats."}), 500


@data_management_bp.route("/indices-scrips", methods=["GET"])
def get_indices_scrips():
    """
    Endpoint to get all index-related scrips from AQ_scrips collection.
    This will help identify which scrips are indices for proper data fetching.
    """
    try:
        # Find scrips that are likely indices based on instrument name or other criteria
        # Different exchanges may have different instrument names for indices
        index_instruments = ["INDEX", "INDICES", "IDX", ""]  # Some exchanges use empty string for indices
        
        indices_scrips = []
        
        # Query for potential index scrips
        for exchange in ["NSE"]:
            # For NSE, indices usually have specific patterns
            # Let's fetch scrips and filter them
            exchange_scrips = AQScrip.objects(exchangename=exchange)
            
            for scrip in exchange_scrips:
                # Check if this looks like an index based on various criteria
                is_index = False
                
                # Check if instrument name suggests it's an index
                if scrip.instrumentname in index_instruments:
                    is_index = True
                
                # Check if scripname contains common index keywords
                index_keywords = ["NIFTY", "SENSEX", "BANK", "IT", "AUTO", "PHARMA", "METAL", "INDEX"]
                scripname_upper = scrip.scripname.upper()
                if any(keyword in scripname_upper for keyword in index_keywords):
                    is_index = True
                
                # Check indices identifier
                if scrip.indicesidentifier and scrip.indicesidentifier > 0:
                    is_index = True
                
                if is_index:
                    indices_scrips.append({
                        "exchange": scrip.exchangename,
                        "scripcode": scrip.scripcode,
                        "scripname": scrip.scripname,
                        "scripshortname": scrip.scripshortname,
                        "instrumentname": scrip.instrumentname,
                        "indicesidentifier": scrip.indicesidentifier
                    })
        
        logger.info(f"Found {len(indices_scrips)} potential index scrips")
        
        return jsonify({
            "status": "success",
            "indices_count": len(indices_scrips),
            "indices": indices_scrips
        })
        
    except Exception as e:
        logger.error(f"Error in /indices-scrips endpoint: {e}")
        return jsonify({"error": "An internal server error occurred while fetching indices scrips."}), 500


def populate_scrips_to_database():
    """
    Standalone function to populate scrips data by clearing existing data and fetching fresh data.
    This function clears the entire AQScrip collection and repopulates it with latest data.
    """
    try:
        print("Starting scrips population process...")
        
        # Clear existing data
        print("Clearing existing scrips data...")
        deleted_count = AQScrip.objects.delete()
        print(f"Deleted {deleted_count} existing scrip records")
        
        # Initialize MO API
        mo_api = MotilalOswalAPI()
        
        # Login to MO API
        print("Attempting to login to MO API...")
        login_success = mo_api.login()
        print(f"MO API login result: {login_success}")
        
        if not login_success:
            print("ERROR: Failed to authenticate with MO API")
            return False
        
        exchanges = ["NSE"]  # Main exchanges
        total_processed = 0
        total_inserted = 0
        exchange_stats = {}
        
        for exchange in exchanges:
            print(f"Processing exchange: {exchange}")
            exchange_processed = 0
            exchange_inserted = 0
            
            # Get scrips data for the exchange
            scrips_data = mo_api.get_scrips_by_exchange(exchange)
            
            print(f"API Response for {exchange}: Status={scrips_data.get('status') if scrips_data else 'None'}")
            
            if scrips_data and scrips_data.get("status") == "SUCCESS":
                scrips = scrips_data.get("data", [])
                print(f"Found {len(scrips)} scrips for {exchange}")
                
                for scrip in scrips:
                    try:
                        scripcode = scrip.get("scripcode")
                        exchangename = scrip.get("exchangename", exchange)
                        
                        if not scripcode:
                            continue
                        
                        # Prepare scrip data
                        scrip_data = {
                            'exchange': scrip.get('exchange', 0),
                            'exchangename': exchangename,
                            'scripcode': scripcode,
                            'scripname': str(scrip.get('scripname', '')),
                            'scripshortname': str(scrip.get('scripshortname', '')),
                            'scripfullname': str(scrip.get('scripfullname', '')),
                            'marketlot': scrip.get('marketlot', 1),
                            'issuspended': str(scrip.get('issuspended', 'N')),
                            'instrumentname': str(scrip.get('instrumentname', '')),
                            'expirydate': scrip.get('expirydate', 0),
                            'strikeprice': scrip.get('strikeprice', 0),
                            'optiontype': str(scrip.get('optiontype', '')),
                            'markettype': str(scrip.get('markettype', '')),
                            'foexposurepercent': scrip.get('foexposurepercent', 0),
                            'lowercircuitprice': scrip.get('lowercircuitprice', 0),
                            'uppercircuitprice': scrip.get('uppercircuitprice', 0),
                            'ticksize': scrip.get('ticksize', 0.05),
                            'scripisinno': str(scrip.get('scripisinno', '')),
                            'indicesidentifier': scrip.get('indicesidentifier', 0),
                            'isbanscrip': str(scrip.get('isbanscrip', 'N')),
                            'facevalue': scrip.get('facevalue', 0),
                            'calevel': scrip.get('calevel', 0),
                            'maxqtyperorder': scrip.get('maxqtyperorder', 0),
                            'algoid': scrip.get('algoid', 0),
                            'ultoken': str(scrip.get('ultoken', '')),
                            'created_at': datetime.utcnow(),
                            'updated_at': datetime.utcnow()
                        }
                        
                        # Create new scrip
                        new_scrip = AQScrip(**scrip_data)
                        new_scrip.save()
                        exchange_inserted += 1
                        total_inserted += 1
                        
                        exchange_processed += 1
                        total_processed += 1
                        
                        # Log progress every 100 scrips
                        if exchange_processed % 100 == 0:
                            print(f"Processed {exchange_processed} scrips for {exchange}")
                    
                    except Exception as e:
                        print(f"Error processing scrip {scripcode} from {exchange}: {e}")
                        continue
            
            else:
                print(f"Failed to fetch scrips for exchange {exchange}. Response: {scrips_data}")
                continue
            
            exchange_stats[exchange] = {
                "processed": exchange_processed,
                "inserted": exchange_inserted
            }
            
            print(f"Completed {exchange}: {exchange_processed} processed, {exchange_inserted} inserted")
        
        print(f"Scrips population completed successfully!")
        print(f"Total: {total_processed} processed, {total_inserted} inserted")
        print(f"Exchange stats: {exchange_stats}")
        
        return True
        
    except Exception as e:
        print(f"Error in populate_scrips_to_database: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    """
    Main execution block for running the populate function directly.
    Usage: python db_scrips_populate.py populate (run from backend directory)
    """
    if len(sys.argv) > 1 and sys.argv[1] == 'populate':
        # Get the directory containing this file (app)
        current_dir = os.path.dirname(os.path.abspath(__file__))
        # Go up to backend directory
        backend_dir = os.path.dirname(current_dir)
        
        # Add backend directory to Python path
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        
        # Change working directory to backend for proper relative imports
        os.chdir(backend_dir)
        
        # Initialize Flask app context (needed for database operations)
        try:
            from app import create_app
            app = create_app()
            with app.app_context():
                success = populate_scrips_to_database()
                if success:
                    print("✓ Scrips population completed successfully!")
                    sys.exit(0)
                else:
                    print("✗ Scrips population failed!")
                    sys.exit(1)
        except Exception as e:
            print(f"Error initializing app context: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        print("Usage: python db_scrips_populate.py populate")
        print("Example: cd D:\\Projects\\TradeEasy\\backend && python app\\db_scrips_populate.py populate")
        print("Or: python D:\\Projects\\TradeEasy\\backend\\app\\db_scrips_populate.py populate")
        sys.exit(1)