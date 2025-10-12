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
    created_at = DateTimeField(default=datetime.utcnow, required=True)
    is_active = BooleanField(default=True, required=True)
    watchlists = ListField(EmbeddedDocumentField(Watchlist))

    meta = {'collection': 'TE_User'}

    def get_id(self):
        return str(self.id)

    def __repr__(self):
        return f"<User {self.username} | ClientID: {self.client_id}>"

class Transaction(Document):
    """Logs every buy or sell transaction."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    action = StringField(choices=('BUY', 'SELL'), required=True)
    quantity = IntField(required=True)
    price = FloatField(required=True)
    status = StringField(default="EXECUTED", required=True)
    order_type = StringField(default='MARKET', required=True)
    transaction_date = DateTimeField(default=datetime.utcnow, required=True)

    meta = {'collection': 'transactions', 'indexes': ['user', 'symbol']}

    def __repr__(self):
        return f"<Transaction {self.action} {self.symbol} x{self.quantity}>"

class Holding(Document):
    """Represents a user's current holdings of a particular stock."""
    user = ReferenceField(User, required=True)
    symbol = StringField(max_length=30, required=True)
    quantity = IntField(required=True)
    average_price = FloatField(required=True)
    
    meta = {
        'collection': 'holdings',
        'indexes': [
            {'fields': ('user', 'symbol'), 'unique': True}
        ]
    }
    
    def __repr__(self):
        return f"<Holding {self.user.client_id} | {self.symbol} x{self.quantity}>"

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
    created_at = DateTimeField(default=datetime.utcnow)
    updated_at = DateTimeField(default=datetime.utcnow)

    meta = {
        'collection': 'AQ_scrips',
        'indexes': [
            # Unique compound index to prevent duplicates and speed up lookups
            {'fields': ('scripcode', 'exchangename'), 'unique': True},
            'exchangename',
            'instrumentname',
            'scripshortname'
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
