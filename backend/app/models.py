from datetime import datetime
import re
import random
import string
from flask_login import UserMixin
from sqlalchemy.orm import relationship
from sqlalchemy import Numeric, ForeignKey, Integer, String, DateTime, Boolean, Column, Index  # Explicit imports

from app import db  # ✅ Import `db` early


# ✅ Move `generate_client_id()` ABOVE `User` to avoid reference errors
def generate_client_id():
    """Generates a unique client ID (3 uppercase letters + 4 digits)."""
    while True:
        letters = ''.join(random.choices(string.ascii_uppercase, k=3))
        numbers = ''.join(random.choices(string.digits, k=4))
        new_client_id = f"{letters}{numbers}"

        # Ensure uniqueness in the database
        if not db.session.query(User).filter_by(client_id=new_client_id).first():
            return new_client_id


# ✅ User Model
class User(db.Model, UserMixin):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    client_id = Column(String(7), unique=True, nullable=False)  # ❌ Removed `default`
    username = Column(String(100), nullable=False, unique=True)
    password = Column(String(255), nullable=False)
    email = Column(String(100), nullable=False, unique=True)
    mobile = Column(String(13), nullable=False)  # Format: +91XXXXXXXXXX
    balance = Column(Numeric(10, 2), default=1000000.00, nullable=False)  # Default balance: ₹10 lakh
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Relationships
    watchlist = relationship('Watchlist', backref='user', lazy=True)
    transactions = relationship('Transaction', backref='user', lazy=True)
    holdings = relationship('Holding', backref='user', lazy=True)

    def __init__(self, **kwargs):
        """Initialize User with a unique client_id if not provided."""
        super().__init__(**kwargs)
        if not self.client_id:
            self.client_id = generate_client_id()

    def __repr__(self):
        return f"<User {self.username} | ClientID: {self.client_id}>"

    def validate_email(self):
        """Validates email format."""
        if not re.match(r"[^@]+@[^@]+\.[^@]+", self.email):
            raise ValueError("Invalid email format")

    def validate_mobile(self):
        """Validates mobile number format."""
        if not re.match(r"^\+91\d{10}$", self.mobile):
            raise ValueError("Invalid mobile number format")


# ✅ Watchlist Model
class Watchlist(db.Model):
    __tablename__ = 'watchlist'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    added_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (Index('idx_watchlist_symbol', 'symbol'),)  # 🔹 Add Index for performance

    def __repr__(self):
        return f"<Watchlist UserID: {self.user_id} | Symbol: {self.symbol}>"


class Transaction(db.Model):
    __tablename__ = 'transactions'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    action = Column(String(10), nullable=False)
    quantity = Column(Integer, nullable=False)
    price = Column(Numeric(10, 2), nullable=False)
    limit_price = Column(Numeric(10, 2), nullable=True)
    stop_loss = Column(Numeric(10, 2), nullable=True)
    status = Column(String(10), default="executed", nullable=False)
    order_type = Column(String(10), nullable=False, default='market')
    transaction_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    executed_at = Column(DateTime, default=datetime.utcnow, nullable=False)  # ✅ ADD THIS

    __table_args__ = (Index('idx_transaction_symbol', 'symbol'),)

    def __repr__(self):
        return f"<Transaction {self.status.upper()} | {self.action.upper()} {self.symbol} x{self.quantity} @ ₹{self.price}>"

class Holding(db.Model):
    __tablename__ = 'holdings'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    average_price = Column(Numeric(10, 2), nullable=False)

    __table_args__ = (Index('idx_holding_symbol', 'symbol'),)

    def __repr__(self):
        return f"<Holding UserID: {self.user_id} | {self.symbol} x{self.quantity} @ ₹{self.average_price}>"

    def update_values(self, current_price):
        """
        Update logic based on the current market price.
        Extend this as needed — for now it's a placeholder.
        """
        # You can store current market price, compute unrealized profit/loss, etc.
        # For now, this does nothing. Add fields if needed.
        pass



class MarketIndex(db.Model):
    __tablename__ = "market_indices"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False, index=True)  # Index name (e.g., Nifty 50, Sensex)
    symbol = Column(String(20), unique=True, nullable=False)  # Ticker symbol (e.g., ^NSEI, ^BSESN)
    price = Column(Numeric(10, 2), nullable=False)  # Latest index value
    change = Column(Numeric(10, 2), nullable=False)  # Absolute change in index value
    percent_change = Column(Numeric(5, 2), nullable=False)  # Percentage change
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<MarketIndex {self.name} | {self.price} ({self.percent_change}%)>"
