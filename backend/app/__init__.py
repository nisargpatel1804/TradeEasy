from flask import Flask, session, request, redirect, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from flask_login import LoginManager
from flask_session import Session
from sqlalchemy import text
from dotenv import load_dotenv
import os
import logging

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask Extensions
db = SQLAlchemy()
migrate = Migrate()
login_manager = LoginManager()
session_manager = Session()

def create_app():
    """Factory function to create and configure the Flask app."""
    app = Flask(__name__)

    # Load configuration from config object or environment variables
    app.config.from_object("app.config.Config")

    # Enhanced CORS setup with more specific configuration
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": os.getenv('FRONTEND_URL', 'http://localhost:5173'),
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
                "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
                "expose_headers": ["Content-Type", "X-CSRFToken"],
                "supports_credentials": True,
                "max_age": 86400  # 24 hours for preflight cache
            }
        }
    )

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    session_manager.init_app(app)
    login_manager.login_view = '/login'

    # Add middleware to handle OPTIONS requests
    @app.before_request
    def handle_options():
        if request.method == 'OPTIONS':
            response = jsonify({'status': 'ok'})
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
            return response

    # Register Blueprints (Routes)
    from .routes import (
        auth, trade, watchlist, portfolio,
        performance, orders, profile, indices, search, status
    )
    from .routes.stock import stock_bp  # Import the stock Blueprint

    app.register_blueprint(auth.bp, url_prefix='/api')
    app.register_blueprint(stock_bp, url_prefix='/api')
    app.register_blueprint(search.search_bp, url_prefix='/api')
    app.register_blueprint(trade.bp, url_prefix='/api/trade')
    app.register_blueprint(watchlist.bp, url_prefix='/api')
    app.register_blueprint(portfolio.bp, url_prefix='/api')
    app.register_blueprint(performance.bp, url_prefix='/api')
    app.register_blueprint(orders.bp, url_prefix='/api')
    app.register_blueprint(profile.bp, url_prefix='/api')
    app.register_blueprint(indices.bp, url_prefix='/api')
    app.register_blueprint(status.status_bp, url_prefix='/api')

    # Database connection check
    with app.app_context():
        try:
            db.session.execute(text("SELECT 1"))
            logger.info("✅ Database connection successful!")
        except Exception as e:
            logger.error(f"❌ Database connection failed: {e}")

    # Unauthorized handler for protected routes
    @login_manager.unauthorized_handler
    def unauthorized_handler():
        logger.warning("⚠️ Unauthorized access attempt.")
        return jsonify({"error": "Unauthorized"}), 401

    # Redirect logged-in users from /login to /dashboard
    @app.before_request
    def redirect_to_dashboard():
        if 'user_id' in session and request.path == '/login':
            logger.info(f"🔄 User {session['user_id']} already logged in. Redirecting to /dashboard.")
            return redirect('/dashboard', code=302)

    return app

# Load user session for Flask-Login
@login_manager.user_loader
def load_user(user_id):
    """Load user by ID for session management."""
    from .models import User
    try:
        return User.query.get(int(user_id))
    except (ValueError, TypeError):
        return None