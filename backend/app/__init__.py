import os
import logging
from flask import Flask, jsonify
from flask_mongoengine import MongoEngine
from flask_cors import CORS
from flask_login import LoginManager
from flask_session import Session
from flask_bcrypt import Bcrypt
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configure Logging ---
logging.basicConfig(level=logging.INFO)
logging.getLogger('werkzeug').setLevel(logging.WARNING)  # Quiets the default request logger
logger = logging.getLogger(__name__)

# --- Initialize Flask Extensions ---
# These are initialized here but configured inside the create_app factory
db = MongoEngine()
login_manager = LoginManager()
session_manager = Session()
bcrypt = Bcrypt()

def create_app():
    """
    Factory function to create and configure the Flask application.
    This pattern allows for multiple app instances and is great for testing.
    """
    app = Flask(__name__)

    # Load configuration from the AppConfig object in config.py
    from app.config import AppConfig
    app.config.from_object(AppConfig)

    # --- Configure Extensions with App Context ---
    db.init_app(app)
    login_manager.init_app(app)
    session_manager.init_app(app)
    bcrypt.init_app(app)

    # Set the view to redirect to for routes requiring login
    login_manager.login_view = '/api/login'

    # --- CORS Configuration ---
    # This is the single source of truth for CORS policy.
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": os.getenv('FRONTEND_URL', 'http://localhost:5173'),
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
                "supports_credentials": True,
            }
        }
    )

    # --- Import and Register Blueprints ---
    # Imports are now cleaned up to reflect the merged files.
    from .routes import (
        auth, trade, portfolio, orders, profile, search, markets
    )
    # Assuming `watchlist`, `status`, and `motilal_oswal` routes exist as per your previous structure.
    from .routes import watchlist, status
    from .routes.stock import stock_bp
    from .routes.motilal_oswal import mo_bp

    # Register all blueprints with a consistent '/api' prefix
    app.register_blueprint(auth.bp, url_prefix='/api')
    app.register_blueprint(stock_bp, url_prefix='/api')
    app.register_blueprint(search.search_bp, url_prefix='/api')
    app.register_blueprint(trade.bp, url_prefix='/api')
    app.register_blueprint(watchlist.bp, url_prefix='/api')
    app.register_blueprint(portfolio.bp, url_prefix='/api')
    app.register_blueprint(orders.bp, url_prefix='/api')
    app.register_blueprint(profile.bp, url_prefix='/api')
    app.register_blueprint(status.status_bp, url_prefix='/api')
    app.register_blueprint(markets.markets_bp, url_prefix='/api') # Standardized prefix
    app.register_blueprint(mo_bp, url_prefix='/api/mo')

    # --- Define Login Manager Handlers ---
    @login_manager.user_loader
    def load_user(user_id):
        """Load user by ID for session management."""
        from .models import User
        try:
            return User.objects(id=user_id).first()
        except (ValueError, TypeError):
            # Handles cases where user_id might be invalid
            return None

    @login_manager.unauthorized_handler
    def unauthorized_handler():
        """Handle unauthorized access attempts for @login_required routes."""
        return jsonify({"error": "Unauthorized access. Please log in."}), 401

    logger.info(f"Flask app created with '{AppConfig.__name__}' configuration.")
    return app

