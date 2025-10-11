from flask_login import UserMixin
from mongoengine import (
    Document,
    EmbeddedDocument,
    StringField,
    IntField,
    DecimalField,
    DateTimeField,
    BooleanField,
    ListField,
    EmbeddedDocumentField,
    ReferenceField,
    signals,
)
from datetime import datetime
import random
import string
import re

def generate_client_id():
    """Generates a unique client ID (3 uppercase letters + 4 digits)."""
    while True:
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        numbers = ''.join(random.choices(string.digits, k=4))
        new_client_id = f"{letters}{numbers}"
        if User.objects(client_id=new_client_id).first() is None:
            return new_client_id

class Stock(Document):
    symbol = StringField(primary_key=True, max_length=20)
    name = StringField(max_length=200, required=False)  # Increased length for full company names
    base_symbol = StringField(max_length=20)  # Symbol without exchange suffix
    exchange = StringField(max_length=10, default="NSE")  # NSE, BSE, etc.
    scripcode = IntField()  # Motilal Oswal scripcode
    instrument_type = StringField(max_length=20, default="EQUITY")  # EQUITY, FUTURES, OPTIONS, etc.
    is_active = BooleanField(default=True)  # Whether stock is actively traded
    current_price = DecimalField(precision=4, default=0.0)
    change = DecimalField(precision=4, default=0.0)
    percent_change = DecimalField(precision=4, default=0.0)
    volume = IntField(default=0)
    last_updated = DateTimeField()
    
    # Simplified index configuration to avoid MongoDB index issues
    meta = {
        'collection': 'stocks',
        'indexes': [
            'base_symbol',
            'exchange',
            'is_active',
            ('base_symbol', 'exchange'),
            ('exchange', 'is_active')
        ]
    }

    def __repr__(self):
        return f"<Stock {self.symbol} ({self.exchange})>"

class Watchlist(EmbeddedDocument):
    name = StringField(max_length=50, required=True)
    is_deletable = BooleanField(default=True, required=True)
    stocks = ListField(ReferenceField(Stock))

class User(Document, UserMixin):
    client_id = StringField(max_length=7, unique=True, required=True, default=generate_client_id)
    username = StringField(max_length=100, required=True, unique=True)
    password = StringField(max_length=255, required=True)
    email = StringField(max_length=100, required=True, unique=True)
    mobile = StringField(max_length=13, required=True)
    balance = DecimalField(precision=2, default=1000000.00, required=True)
    created_at = DateTimeField(default=datetime.utcnow, required=True)
    is_active = BooleanField(default=True, required=True)
    watchlists = ListField(EmbeddedDocumentField(Watchlist))

    meta = {
        'collection': 'TE_User'
    }

    def get_id(self):
        """Override Flask-Login's get_id to return string representation of ObjectId"""
        return str(self.id)

    def __repr__(self):
        return f"<User {self.username} | ClientID: {self.client_id}>"

    def validate_email(self):
        if not re.match(r"[^@]+@[^@]+\.[^@]+", self.email):
            raise ValueError("Invalid email format")

    def validate_mobile(self):
        if not re.match(r"^\+91\d{10}$", self.mobile):
            raise ValueError("Invalid mobile number format")


# ---- Clean hooks to enforce basic schema constraints ----
def _clean_stock(sender, document, **kwargs):
    if not document.symbol:
        raise ValueError("Stock.symbol is required")
    document.symbol = document.symbol.upper().strip()
    if document.base_symbol:
        document.base_symbol = document.base_symbol.upper().strip()
    if document.exchange:
        document.exchange = document.exchange.upper().strip()


def _clean_user(sender, document, **kwargs):
    if document.watchlists is None:
        document.watchlists = []
    # ensure watchlist names are trimmed
    for wl in document.watchlists:
        if wl and wl.name:
            wl.name = wl.name.strip()


def ensure_db_indexes():
    """Create important indexes if they don't already exist."""
    try:
        from mongoengine import connection
        from pymongo.errors import OperationFailure
        db = connection.get_db()
        # stocks: ensure _id (symbol) index exists (usually by default)
        try:
            db['stocks'].create_index('_id')
        except OperationFailure as oe:
            # Ignore existing index conflicts
            if getattr(oe, 'code', None) != 85:
                raise
        # users: index on embedded watchlist names for faster lookups/updates
        # Note: This index is already defined in User.meta, so manual creation is removed to avoid conflicts
        pass
    except Exception as e:
        # Log via print to avoid circular imports with logger
        print(f"Index creation warning: {e}")

class Transaction(Document):
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=20, required=True)
    action = StringField(max_length=10, required=True)
    quantity = IntField(required=True)
    price = DecimalField(precision=2, required=True)
    limit_price = DecimalField(precision=2)
    stop_loss = DecimalField(precision=2)
    status = StringField(max_length=10, default="executed", required=True)
    order_type = StringField(max_length=10, default='market', required=True)
    transaction_date = DateTimeField(default=datetime.utcnow, required=True)
    executed_at = DateTimeField(default=datetime.utcnow, required=True)

    meta = {'collection': 'transactions', 'indexes': ['symbol', 'user']}
    
    def __repr__(self):
        return f"<Transaction {self.status.upper()} | {self.action.upper()} {self.symbol} x{self.quantity} @ ₹{self.price}>"

class Holding(Document):
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=20, required=True)
    quantity = IntField(required=True)
    average_price = DecimalField(precision=2, required=True)

    meta = {'collection': 'holdings', 'indexes': ['symbol', 'user']}

    def __repr__(self):
        return f"<Holding UserID: {self.user.id} | {self.symbol} x{self.quantity} @ ₹{self.average_price}>"

class MarketIndex(Document):
    name = StringField(max_length=50, unique=True, required=True)
    symbol = StringField(max_length=20, unique=True, required=True)
    price = DecimalField(precision=2, required=True)
    change = DecimalField(precision=2, required=True)
    percent_change = DecimalField(precision=2, required=True)
    last_updated = DateTimeField(default=datetime.utcnow, required=True)
    
    meta = {'collection': 'market_indices', 'indexes': ['name']}

    def __repr__(self):
        return f"<MarketIndex {self.name} | {self.price} ({self.percent_change}%)>"

class GlobalMarketIndex(Document):
    category = StringField(max_length=50, required=True)
    name = StringField(max_length=100, required=True)
    symbol = StringField(max_length=20, unique=True, sparse=True)
    ltp = DecimalField(precision=4)
    change = DecimalField(precision=4)
    percent_change = DecimalField(precision=2)
    high = DecimalField(precision=4)
    low = DecimalField(precision=4)
    open_price = DecimalField(precision=4)
    prev_close = DecimalField(precision=4)
    week_52_high = DecimalField(precision=4)
    week_52_low = DecimalField(precision=4)
    ytd_change = DecimalField(precision=2)
    technical_rating = StringField(max_length=20)
    last_updated = DateTimeField(default=datetime.utcnow)

    meta = {'collection': 'global_market_data', 'indexes': ['category', 'symbol']}

    def __repr__(self):
        return f"<GlobalMarketData {self.category} - {self.name}>"

class AQScrip(Document):
    """
    Model to store all scrip data from Motilal Oswal API for different exchanges.
    This includes stocks, indices, derivatives, etc.
    """
    exchange = IntField(required=True)  # Exchange code (2 for NSEFO, etc.)
    exchangename = StringField(max_length=20, required=True)  # NSE, BSE, NSEFO, etc.
    scripcode = IntField(required=True)  # Unique scrip code from MO API
    scripname = StringField(max_length=200, required=True)  # Full scrip name
    scripshortname = StringField(max_length=50)  # Short name
    scripfullname = StringField(max_length=200)  # Full name
    marketlot = IntField(default=1)  # Market lot size
    issuspended = StringField(max_length=1, default="N")  # Y/N
    instrumentname = StringField(max_length=20)  # EQUITY, OPTIDX, FUTIDX, etc.
    expirydate = IntField()  # Unix timestamp for derivatives
    strikeprice = DecimalField(precision=2, default=0)  # Strike price for options
    optiontype = StringField(max_length=2)  # CE/PE for options
    markettype = StringField(max_length=10)  # Market type
    foexposurepercent = DecimalField(precision=2, default=0)  # F&O exposure %
    lowercircuitprice = DecimalField(precision=4, default=0)  # Lower circuit limit
    uppercircuitprice = DecimalField(precision=4, default=0)  # Upper circuit limit
    ticksize = DecimalField(precision=4, default=0.05)  # Minimum tick size
    scripisinno = StringField(max_length=20)  # ISIN number
    indicesidentifier = IntField(default=0)  # Index identifier
    isbanscrip = StringField(max_length=1, default="N")  # Y/N for banned scrips
    facevalue = DecimalField(precision=2, default=0)  # Face value
    calevel = IntField(default=0)  # Capital adequacy level
    maxqtyperorder = IntField(default=0)  # Maximum quantity per order
    algoid = IntField(default=0)  # Algorithm ID
    ultoken = StringField(max_length=20)  # Underlying token
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)

    meta = {
        'collection': 'AQ_scrips',
        'indexes': [
            'exchangename',
            'scripcode',
            'instrumentname',
            'issuspended',
            'isbanscrip',
            ('exchangename', 'scripcode'),
            ('exchangename', 'instrumentname'),
            ('scripcode', 'exchangename')
        ]
    }

    def __repr__(self):
        return f"<AQScrip {self.exchangename}:{self.scripcode} - {self.scripname}>"


# Connect signals at the end to ensure definitions are available
signals.pre_save.connect(_clean_stock, sender=Stock)
signals.pre_save.connect(_clean_user, sender=User)
