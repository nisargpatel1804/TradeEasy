"""
Corporate Actions Engine for TradeEasy
Scrapes live corporate actions (Splits, Bonuses, Dividends) and mathematically
adjusts paper-trading portfolios to prevent artificial loss/gain spikes.
"""

import logging
import re
from datetime import datetime, date, timedelta, timezone
from decimal import Decimal
import requests
from bs4 import BeautifulSoup
from mongoengine.queryset.visitor import Q

from app.models import Holding, Lot, Transaction, User, AQScrip, Stock

logger = logging.getLogger(__name__)


class CorporateActionsEngine:
    """
    Automated engine to fetch and apply corporate actions to user portfolios.
    """
    
    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    URLS = {
        'splits': 'https://www.screener.in/actions/split/?o=-1',
        'bonuses': 'https://www.screener.in/actions/bonus/?o=-1',
        'dividends': 'https://www.screener.in/actions/dividend/?o=-1'
    }

    @classmethod
    def _parse_date(cls, date_str: str) -> date | None:
        """Parses Screener date format (e.g., '24 July 2026') into a Python date."""
        try:
            # Clean non-breaking spaces or weird characters
            clean_str = re.sub(r'\s+', ' ', date_str).strip()
            return datetime.strptime(clean_str, "%d %B %Y").date()
        except ValueError:
            return None

    @classmethod
    def _resolve_symbol(cls, company_name: str) -> str | None:
        """
        Attempts to find the NSE symbol for a given Screener company name.
        Uses exact prefix matching against MO's AQScrip master database.
        """
        clean_name = company_name.split('-')[0].strip().lower()
        
        # 1. Try matching against Stock collection first
        stock = Stock.objects(name__icontains=clean_name, exchange='NSE').first()
        if stock and stock.symbol:
            return stock.symbol.split('.')[0]
            
        # 2. Try AQScrip master data
        aq = AQScrip.objects(
            (Q(scripname__icontains=clean_name) | Q(scripfullname__icontains=clean_name)) 
            & Q(exchangename='NSE')
        ).first()
        
        if aq and aq.scripshortname:
            return aq.scripshortname.strip().upper()
            
        return None

    @classmethod
    def scrape_todays_actions(cls) -> list[dict]:
        """
        Scrapes all splits and bonuses executing today.
        Returns a unified list of actionable events.
        """
        today = datetime.now(timezone.utc).date()
        actions = []

        # --- 1. Scrape Splits ---
        try:
            res = requests.get(cls.URLS['splits'], headers=cls.HEADERS, timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            for row in soup.select('table.data-table tr')[1:]:
                cols = row.find_all('td')
                if len(cols) >= 4:
                    ex_date = cls._parse_date(cols[1].text.strip())
                    if ex_date == today:
                        actions.append({
                            'type': 'SPLIT',
                            'company': cols[0].text.strip(),
                            'old_fv': Decimal(cols[2].text.strip()),
                            'new_fv': Decimal(cols[3].text.strip()),
                        })
        except Exception as e:
            logger.error(f"Failed to scrape splits: {e}")

        # --- 2. Scrape Bonuses ---
        try:
            res = requests.get(cls.URLS['bonuses'], headers=cls.HEADERS, timeout=15)
            soup = BeautifulSoup(res.text, 'html.parser')
            for row in soup.select('table.data-table tr')[1:]:
                cols = row.find_all('td')
                if len(cols) >= 3:
                    ex_date = cls._parse_date(cols[1].text.strip())
                    if ex_date == today:
                        ratio_str = cols[2].text.strip()
                        if ':' in ratio_str:
                            given, held = ratio_str.split(':')
                            actions.append({
                                'type': 'BONUS',
                                'company': cols[0].text.strip(),
                                'ratio_given': Decimal(given.strip()),
                                'ratio_held': Decimal(held.strip()),
                            })
        except Exception as e:
            logger.error(f"Failed to scrape bonuses: {e}")

        return actions

    @classmethod
    def apply_corporate_actions(cls):
        """
        Main execution pipeline. Fetches today's actions, resolves symbols, 
        and updates all user holdings atomically.
        """
        logger.info("Starting Corporate Actions Engine...")
        actions = cls.scrape_todays_actions()
        
        if not actions:
            logger.info("No corporate actions found for today.")
            return
            
        logger.info(f"Found {len(actions)} corporate actions to process.")
        
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

        for action in actions:
            symbol = cls._resolve_symbol(action['company'])
            if not symbol:
                logger.warning(f"Could not resolve NSE symbol for {action['company']}. Skipping.")
                continue

            multiplier = Decimal('1.0')
            description = ""

            if action['type'] == 'SPLIT':
                multiplier = action['old_fv'] / action['new_fv']
                description = f"Stock Split {action['old_fv']} to {action['new_fv']}"
                
            elif action['type'] == 'BONUS':
                # Example: 2:1 bonus means 2 new shares for every 1 held. Total = 3 shares.
                multiplier = (action['ratio_given'] + action['ratio_held']) / action['ratio_held']
                description = f"Bonus Issue {action['ratio_given']}:{action['ratio_held']}"

            if multiplier <= Decimal('1.0'):
                continue

            cls._apply_multiplier_to_portfolios(symbol, multiplier, description, today_start)

        logger.info("Corporate Actions Engine completed successfully.")

    @classmethod
    def _apply_multiplier_to_portfolios(cls, symbol: str, multiplier: Decimal, description: str, today_start: datetime):
        """
        Adjusts quantities and prices for all users holding the affected symbol.
        """
        # Formats symbol safely (e.g., RELIANCE.NSE)
        target_symbol = f"{symbol}.NSE"
        
        holdings = Holding.objects(symbol=target_symbol)
        affected_users = set()
        
        for holding in holdings:
            user = holding.user
            
            # Idempotency Check: Did we already process this action for this user today?
            existing_txn = Transaction.objects(
                user=user,
                symbol=target_symbol,
                action='CORPORATE_ACTION',
                transaction_date__gte=today_start
            ).first()
            
            if existing_txn:
                logger.debug(f"Action already applied for {user.client_id} on {target_symbol}.")
                continue
                
            affected_users.add(user)

            try:
                # 1. Update Holding
                old_qty = Decimal(holding.quantity)
                old_avg_price = Decimal(str(holding.average_price))
                
                new_qty = int(old_qty * multiplier)
                new_avg_price = float(old_avg_price / multiplier)
                new_reserved = int(Decimal(holding.reserved_quantity) * multiplier)
                
                Holding.objects(id=holding.id).update_one(
                    set__quantity=new_qty,
                    set__average_price=new_avg_price,
                    set__reserved_quantity=new_reserved
                )

                # 2. Synchronize Underlying FIFO Lots
                lots = Lot.objects(user=user, symbol=target_symbol, is_active=True)
                for lot in lots:
                    lot_old_qty = Decimal(lot.quantity)
                    lot_old_orig_qty = Decimal(lot.original_quantity)
                    lot_old_price = Decimal(str(lot.purchase_price))
                    
                    Lot.objects(id=lot.id).update_one(
                        set__quantity=int(lot_old_qty * multiplier),
                        set__original_quantity=int(lot_old_orig_qty * multiplier),
                        set__purchase_price=float(lot_old_price / multiplier)
                    )

                # 3. Log System Transaction
                txn = Transaction(
                    user=user,
                    symbol=target_symbol,
                    action='CORPORATE_ACTION',
                    quantity=new_qty - int(old_qty), # Log the newly added shares
                    price=0.0, # Zero cost to user
                    status='EXECUTED',
                    order_type='SYSTEM',
                    product_type=holding.product_type,
                    metadata=description,
                    execution_date=datetime.now(timezone.utc)
                )
                txn.save()

                logger.info(f"Applied {description} to {user.client_id}'s portfolio for {target_symbol}.")
                
            except Exception as e:
                logger.error(f"Failed to apply {description} to {user.client_id} for {target_symbol}: {e}", exc_info=True)

        if affected_users:
            from app.services.cache import cache as app_cache
            for user in affected_users:
                app_cache.invalidate_pattern(f"route:get_portfolio:user:{user.id}")