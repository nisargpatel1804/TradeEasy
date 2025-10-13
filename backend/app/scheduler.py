"""
Scheduler for automated background tasks including daily scrip updates.
Uses APScheduler to run tasks at specific times without blocking the main application.
"""

import logging
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from flask import current_app

logger = logging.getLogger(__name__)

class TaskScheduler:
    """Manages scheduled background tasks for the application."""
    
    _instance = None
    
    def __new__(cls):
        """Singleton pattern to ensure only one scheduler instance exists."""
        if cls._instance is None:
            cls._instance = super(TaskScheduler, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        """Initialize the scheduler (only once due to singleton pattern)."""
        if self._initialized:
            return
        
        self.scheduler = BackgroundScheduler(
            timezone='Asia/Kolkata',  # IST timezone for Indian stock market
            daemon=True
        )
        self._initialized = True
        logger.info("Task Scheduler initialized successfully.")
    
    def start(self):
        """Start the scheduler and register all scheduled jobs."""
        if not self.scheduler.running:
            # Schedule daily scrip update at 6:00 AM IST (before market opens)
            # Markets typically open at 9:15 AM IST, so this gives buffer time
            self.scheduler.add_job(
                func=self._daily_scrip_update,
                trigger=CronTrigger(hour=6, minute=0),  # 6:00 AM IST daily
                id='daily_scrip_update',
                name='Daily Scrip Master Update',
                replace_existing=True,
                max_instances=1  # Prevent overlapping executions
            )
            
            self.scheduler.start()
            logger.info("Task Scheduler started. Jobs registered:")
            for job in self.scheduler.get_jobs():
                logger.info(f"  - {job.name} (ID: {job.id}) - Next run: {job.next_run_time}")
        else:
            logger.warning("Scheduler is already running.")
    
    def shutdown(self):
        """Gracefully shutdown the scheduler."""
        if self.scheduler.running:
            self.scheduler.shutdown(wait=True)
            logger.info("Task Scheduler shut down successfully.")
    
    def _daily_scrip_update(self):
        """
        Daily job to update the AQScrip database with latest data from MO API.
        This handles new stock listings and removes delisted stocks.
        """
        logger.info("=== Starting Daily Scrip Update Job ===")
        start_time = datetime.utcnow()
        
        try:
            from app.moapi.mo_api import MotilalOswalAPI
            from app.models import AQScrip
            from app.db_scrips_populate import _map_api_to_model_data
            
            mo_api = MotilalOswalAPI()
            if not mo_api.login():
                logger.error("Failed to authenticate with MO API for daily update.")
                return
            
            # Focus on equity exchanges (NSE and BSE) for daily updates
            # F&O and commodities can be updated less frequently if needed
            exchanges = ["NSE", "BSE"]
            stats = {"total_processed": 0, "upserted": 0, "updated": 0}
            
            for exchange in exchanges:
                logger.info(f"Updating scrips for {exchange}...")
                scrips_response = mo_api.get_scrips_by_exchange(exchange)
                
                if not (scrips_response and scrips_response.get("status") == "SUCCESS"):
                    logger.warning(f"Failed to fetch scrips for {exchange}.")
                    continue
                
                scrips_list = scrips_response.get("data", [])
                exchange_upserted = 0
                exchange_updated = 0
                
                for scrip_api_data in scrips_list:
                    model_data = _map_api_to_model_data(scrip_api_data, exchange)
                    if not model_data:
                        continue
                    
                    # Upsert operation: update if exists, insert if new
                    result = AQScrip.objects(
                        scripcode=model_data['scripcode'],
                        exchangename=model_data['exchangename']
                    ).update_one(set__=model_data, upsert=True)
                    
                    if result.upserted_id:
                        exchange_upserted += 1
                    elif result.modified_count > 0:
                        exchange_updated += 1
                
                stats["total_processed"] += len(scrips_list)
                stats["upserted"] += exchange_upserted
                stats["updated"] += exchange_updated
                logger.info(
                    f"Completed {exchange}: {len(scrips_list)} processed, "
                    f"{exchange_upserted} new, {exchange_updated} updated."
                )
            
            # Mark inactive scrips (optional: could implement logic to mark scrips
            # not seen in the latest API response as inactive/delisted)
            
            duration = (datetime.utcnow() - start_time).total_seconds()
            logger.info(
                f"=== Daily Scrip Update Complete === "
                f"Duration: {duration:.2f}s | Stats: {stats}"
            )
            
        except Exception as e:
            logger.error(f"Error during daily scrip update: {e}", exc_info=True)
    
    def trigger_scrip_update_now(self):
        """
        Manually trigger an immediate scrip update (useful for testing or on-demand updates).
        This can be called from an API endpoint if needed.
        """
        logger.info("Manually triggering scrip update...")
        self._daily_scrip_update()


def init_scheduler(app):
    """
    Initialize and start the task scheduler with the Flask app context.
    Should be called from the app factory after app creation.
    """
    with app.app_context():
        scheduler = TaskScheduler()
        scheduler.start()
        return scheduler
