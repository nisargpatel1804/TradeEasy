from flask_login import UserMixin
from mongoengine import (
    Document, EmbeddedDocument, StringField, IntField, FloatField,
    DateTimeField, BooleanField, ListField, EmbeddedDocumentField,
    ReferenceField, signals
)
from datetime import datetime
import random
import string
import re

# --- Helper Functions ---

def generate_client_id():
    """Generates a unique client ID (3 uppercase letters + 4 digits)."""
    while True:
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        numbers = ''.join(random.choices(string.digits, k=4))
        new_client_id = f"{letters}{numbers}"
        if User.objects(client_id=new_client_id).first() is None:
            return new_client_id

# --- Core Application Models ---

class Stock(Document):
    """Represents a stock tracked within the application (e.g., in a watchlist)."""
    symbol = StringField(primary_key=True, max_length=30)
    name = StringField(max_length=200)
    exchange = StringField(max_length=10, default="NSE")
    scripcode = IntField(required=True)
    instrument_type = StringField(max_length=20, default="EQUITY")
    is_active = BooleanField(default=True)
    
    # Real-time market data fields (updated via WebSocket or API)
    current_price = FloatField()
    change = FloatField()
    percent_change = FloatField()
    volume = IntField()
    last_updated = DateTimeField()
    
    meta = {
        'collection': 'stocks',
        'indexes': [
            {'fields': ('scripcode', 'exchange'), 'unique': True},
            'exchange',
            'is_active'
        ]
    }

    def __repr__(self):
        return f"<Stock {self.symbol} | {self.exchange}:{self.scripcode}>"

class Watchlist(EmbeddedDocument):
    """Represents a user's watchlist, embedded within the User document."""
    name = StringField(max_length=50, required=True)
    is_deletable = BooleanField(default=True, required=True)
    stocks = ListField(ReferenceField(Stock))

class User(Document, UserMixin):
    """Represents an application user."""
    client_id = StringField(max_length=7, unique=True, required=True, default=generate_client_id)
    username = StringField(max_length=100, required=True, unique=True)
    password = StringField(max_length=255, required=True)
    email = StringField(max_length=100, required=True, unique=True)
    mobile = StringField(max_length=13, required=True)
    balance = FloatField(default=1000000.00, required=True)
    reserved_balance = FloatField(default=0.00, required=True)  # Funds committed to pending orders
    created_at = DateTimeField(default=datetime.utcnow, required=True)
    is_active = BooleanField(default=True, required=True)
    watchlists = ListField(EmbeddedDocumentField(Watchlist))
    reset_in_progress = BooleanField(default=False, required=True)
    reset_started_at = DateTimeField()
    last_portfolio_reset_at = DateTimeField()
    realized_pnl = FloatField(default=0.0, required=True)
    realized_pnl_synced_at = DateTimeField()
    realized_pnl_sell_count = IntField(default=0, required=True)
    
    # Password reset fields
    # Stores HMAC-SHA256(token) rather than the plaintext token to prevent token leakage
    reset_token = StringField(max_length=100)
    reset_token_expiry = DateTimeField()

    meta = {
        'collection': 'TE_User',
        'indexes': [
            'email',
            'client_id',
            'reset_token',
            'reset_in_progress',
            'realized_pnl_synced_at',
            'realized_pnl_sell_count'
        ]
    }

    def get_id(self):
        return str(self.id)

    def __repr__(self):
        return f"<User {self.username} | ClientID: {self.client_id}>"

TRANSACTION_STATUSES = ("PENDING", "EXECUTED", "CANCELLED")


class Transaction(Document):
    """Logs every buy or sell transaction."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    action = StringField(choices=('BUY', 'SELL'), required=True)
    quantity = IntField(required=True)
    price = FloatField(required=True)
    status = StringField(default="PENDING", required=True, choices=TRANSACTION_STATUSES)
    is_processing = BooleanField(default=False)
    order_type = StringField(default='MARKET', required=True)  # MARKET, LIMIT, STOP_LOSS, STOP_LIMIT, BRACKET, TRAILING_STOP
    transaction_date = DateTimeField(default=datetime.utcnow, required=True)
    
    # Advanced order type fields
    stop_loss_price = FloatField()  # Trigger price for stop-loss orders
    target_price = FloatField()  # Target price for bracket orders
    trailing_stop_pct = FloatField()  # Percentage for trailing stop (e.g., 2.0 for 2%)
    trailing_stop_trigger_price = FloatField()  # Current trigger price for trailing stop (updated dynamically)
    
    # Product type for intraday vs delivery
    product_type = StringField(default='CNC', choices=('CNC', 'MIS'))  # CNC=Cash & Carry (Delivery), MIS=Margin Intraday Square-off
    
    # Bracket order tracking
    parent_order_id = StringField()  # For stop-loss/target legs of bracket order
    bracket_order_type = StringField(choices=('ENTRY', 'STOP_LOSS', 'TARGET'))  # Type of leg in bracket order
    
    # Idempotency and execution tracking
    idempotency_key = StringField(unique=True, sparse=True)  # Prevent duplicate executions
    execution_date = DateTimeField()  # When pending order was actually executed
    square_off_time = DateTimeField()  # Auto square-off timestamp for MIS orders
    original_price = FloatField()  # Original limit/stop price (before execution price override)
    
    is_portfolio_exit = BooleanField()
    metadata = StringField()

    meta = {
        'collection': 'transactions',
        'indexes': [
            'user',
            'symbol',
            'status',
            'product_type',
            'parent_order_id',
            'idempotency_key',
            {'fields': ['user', 'transaction_date']},
            {'fields': ['user', 'symbol']},
            {'fields': ['user', 'action', 'status']},
            {'fields': ['user', 'status', 'product_type']},
            {'fields': ['status', 'product_type']},
            {'fields': ['status', 'order_type']},
        ]
    }

    def __repr__(self):
        return f"<Transaction {self.action} {self.symbol} x{self.quantity} {self.order_type}>"

class Holding(Document):
    """Represents a user's current holdings of a particular stock."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    quantity = IntField(required=True)
    average_price = FloatField(required=True)
    product_type = StringField(default='CNC', choices=('CNC', 'MIS'))  # Separate CNC and MIS holdings
    reserved_quantity = IntField(default=0)  # Shares committed to pending sell orders
    
    meta = {
        'collection': 'holdings',
        'indexes': [
            {'fields': ('user', 'symbol', 'product_type'), 'unique': True}
        ]
    }
    
    def __repr__(self):
        return f"<Holding {self.user.client_id} | {self.symbol} x{self.quantity} {self.product_type}>"

class Lot(Document):
    """Tracks individual purchase lots for FIFO/LIFO P&L calculation."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    quantity = IntField(required=True)  # Remaining quantity in this lot
    original_quantity = IntField(required=True)  # Original quantity purchased
    purchase_price = FloatField(required=True)  # Price at which this lot was purchased
    purchase_date = DateTimeField(required=True)
    purchase_transaction = ReferenceField(Transaction)  # Link to original buy transaction
    product_type = StringField(default='CNC', choices=('CNC', 'MIS'))
    is_active = BooleanField(default=True)  # False when fully sold
    
    meta = {
        'collection': 'lots',
        'indexes': [
            {'fields': ['user', 'symbol', 'is_active']},
            {'fields': ['user', 'symbol', 'product_type', 'purchase_date']},  # For FIFO ordering
            'purchase_transaction'
        ]
    }
    
    def __repr__(self):
        return f"<Lot {self.symbol} x{self.quantity}/{self.original_quantity} @{self.purchase_price}>"

class ShortPosition(Document):
    """Tracks short positions for intraday trading (MIS only)."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    quantity = IntField(required=True)  # Number of shares shorted
    short_price = FloatField(required=True)  # Price at which shares were shorted
    short_date = DateTimeField(default=datetime.utcnow, required=True)
    short_transaction = ReferenceField(Transaction)  # Link to original short sell transaction
    is_active = BooleanField(default=True)  # False when position is covered
    square_off_time = DateTimeField()  # Auto square-off timestamp
    
    meta = {
        'collection': 'short_positions',
        'indexes': [
            {'fields': ['user', 'symbol', 'is_active'], 'unique': True},
            'short_transaction',
            'square_off_time'
        ]
    }
    
    def __repr__(self):
        return f"<ShortPosition {self.symbol} x{self.quantity} @{self.short_price}>"

# --- Motilal Oswal API Data Model ---

class AQScrip(Document):
    """
    Stores the master list of all scrips (instruments) from the Motilal Oswal API.
    This model is optimized for efficient bulk inserts and lookups.
    """
    exchange = IntField(required=True)
    exchangename = StringField(max_length=20, required=True)
    scripcode = IntField(required=True)
    scripname = StringField(max_length=200, required=True)
    scripshortname = StringField(max_length=50)
    scripfullname = StringField(max_length=200)
    marketlot = IntField(default=1)
    instrumentname = StringField(max_length=20)
    expirydate = IntField()
    strikeprice = FloatField()
    optiontype = StringField(max_length=4)
    lowercircuitprice = FloatField()
    uppercircuitprice = FloatField()
    ticksize = FloatField()
    scripisinno = StringField(max_length=20)
    isbanscrip = StringField(max_length=1, default="N")
    issuspended = StringField(max_length=1, default="N")
    # Additional fields from Motilal Oswal API
    markettype = StringField(max_length=10)
    foexposurepercent = FloatField()
    facevalue = FloatField()
    calevel = IntField()
    maxqtyperorder = IntField()
    algoid = IntField()
    indicesidentifier = IntField()
    ultoken = StringField(max_length=20)
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)

    meta = {
        'collection': 'AQ_scrips',
        'indexes': [
            {'fields': ['exchange', 'scripcode'], 'unique': True, 'name': 'uq_exchange_scripcode'},
            {'fields': ['scripcode'], 'name': 'idx_scripcode'},
            {'fields': ['exchange'], 'name': 'idx_exchange'},
            {'fields': ['exchangename'], 'name': 'idx_exchangename'},
            {'fields': ['instrumentname'], 'name': 'idx_instrumentname'},
            {'fields': ['scripshortname'], 'name': 'idx_scripshortname'},
            {'fields': ['scripname'], 'name': 'idx_scripname'},
            {'fields': ['scripfullname'], 'name': 'idx_scripfullname'},
            {'fields': ['exchangename', 'scripshortname'], 'name': 'idx_exchangename_scripshortname'},
            {'fields': ['optiontype', 'issuspended', 'isbanscrip'], 'name': 'idx_option_status_filters'},
            {
                'fields': ['exchangename', 'optiontype', 'issuspended', 'isbanscrip', 'scripshortname', 'scripcode'],
                'name': 'idx_search_prefix_sort'
            },
            # Text index to accelerate 'contains' searches; weights favor shortname
            {
                'fields': ['$scripshortname', '$scripname', '$scripfullname'],
                'default_language': 'english',
                'weights': {'scripshortname': 10, 'scripname': 5, 'scripfullname': 2},
                'name': 'idx_text_scrip_search'
            }
        ]
    }

    def __repr__(self):
        return f"<AQScrip {self.exchangename}:{self.scripcode} - {self.scripshortname}>"

# --- Data Cleaning and Validation Signals ---

def clean_user_data(sender, document, **kwargs):
    """Pre-save hook to clean and validate User data."""
    if document.email:
        document.email = document.email.lower().strip()
        if not re.match(r"[^@]+@[^@]+\.[^@]+", document.email):
            raise ValueError("Invalid email format")
    if document.mobile:
        if not re.match(r"^\+91\d{10}$", document.mobile):
            raise ValueError("Invalid mobile number format (must be +91XXXXXXXXXX)")
    if not document.watchlists:
        # Ensure every user has a default 'My Watchlist'
        document.watchlists = [Watchlist(name="My Watchlist", is_deletable=False)]

def clean_aqscrip_data(sender, document, **kwargs):
    """Pre-save hook to clean AQScrip data before saving."""
    document.scripname = document.scripname.strip()
    if document.scripshortname:
        document.scripshortname = document.scripshortname.strip()
    if document.instrumentname:
        document.instrumentname = document.instrumentname.strip()
    if document.optiontype:
        document.optiontype = document.optiontype.strip()

# Connect signals to the corresponding models
signals.pre_save.connect(clean_user_data, sender=User)
signals.pre_save.connect(clean_aqscrip_data, sender=AQScrip)


def _invalidate_search_cache_on_scrip_change(sender, document, **kwargs):
    try:
        from app.routes import search as search_module
        build_prefixes = getattr(search_module, "build_invalidation_prefixes", None)
        invalidate_cache = getattr(search_module, "invalidate_search_cache", None)

        if not callable(invalidate_cache):
            return

        prefixes = build_prefixes([
            document.scripshortname or "",
            document.scripname or "",
            document.scripfullname or ""
        ]) if callable(build_prefixes) else None

        if prefixes:
            invalidate_cache(prefixes)
        else:
            invalidate_cache()
    except Exception:
        # Avoid breaking writes if cache invalidation fails
        pass


signals.post_save.connect(_invalidate_search_cache_on_scrip_change, sender=AQScrip)
signals.post_delete.connect(_invalidate_search_cache_on_scrip_change, sender=AQScrip)


def normalize_transaction_status(sender, document, **kwargs):
    """Ensure transaction.status stays within the allowed set."""
    status_value = (document.status or "").upper()
    normalization_map = {
        "PROCESSING": "PENDING",
        "FAILED": "CANCELLED",
        "CANCELED": "CANCELLED",
        "CANCELLED": "CANCELLED",
    }
    if status_value not in TRANSACTION_STATUSES:
        status_value = normalization_map.get(status_value, "CANCELLED")
    document.status = status_value
    # Reset the processing flag once an order leaves pending state
    if status_value != "PENDING":
        document.is_processing = False


signals.pre_save.connect(normalize_transaction_status, sender=Transaction)
