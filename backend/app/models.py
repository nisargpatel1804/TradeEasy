from flask_login import UserMixin
from mongoengine import Document, EmbeddedDocument, StringField, IntField, DecimalField, DateTimeField, BooleanField, ListField, EmbeddedDocumentField, ReferenceField
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
    name = StringField(max_length=200)  # Increased length for full company names
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

    meta = {'collection': 'users'}

    def __repr__(self):
        return f"<User {self.username} | ClientID: {self.client_id}>"

    def validate_email(self):
        if not re.match(r"[^@]+@[^@]+\.[^@]+", self.email):
            raise ValueError("Invalid email format")

    def validate_mobile(self):
        if not re.match(r"^\+91\d{10}$", self.mobile):
            raise ValueError("Invalid mobile number format")

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
