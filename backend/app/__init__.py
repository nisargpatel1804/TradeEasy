import os
import logging
from flask import Flask, jsonify, request
from flask_mongoengine import MongoEngine
from flask_cors import CORS
from flask_login import LoginManager
from flask_session import Session
from flask_bcrypt import Bcrypt
from dotenv import load_dotenv
from flask_socketio import SocketIO, emit
from bson import ObjectId

# Load environment variables from .env file
load_dotenv()

# --- Configure Logging ---
logging.basicConfig(level=logging.INFO)
# Quiets the default request logger for a cleaner console
logging.getLogger('werkzeug').setLevel(logging.WARNING) 
logger = logging.getLogger(__name__)

# --- Initialize Flask Extensions ---
# These are initialized here but configured inside the create_app factory
db = MongoEngine()
login_manager = LoginManager()
session_manager = Session()
bcrypt = Bcrypt()
# Initialize SocketIO for real-time communication
socketio = SocketIO()

def create_app():
    """
    Factory function to create and configure the Flask application.
    This pattern allows for multiple app instances and is ideal for testing.
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

    # --- CORS Configuration ---
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5173')
    
    # SocketIO requires its own CORS configuration
    socketio.init_app(
        app, 
        cors_allowed_origins=[frontend_url, "http://127.0.0.1:5173"]
    )

    # Configure CORS for standard HTTP requests
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": [frontend_url, "http://127.0.0.1:5173"],
                "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "Authorization", "X-Requested-With"],
                "supports_credentials": True,
            }
        }
    )

    # --- Start the WebSocket Manager ---
    # This must be done only once. It starts the background thread that
    # connects to the Motilal Oswal API and listens for real-time data.
    with app.app_context():
        from app.socket_manager import MO_WebSocket_Manager
        # Ensure indexes exist (idempotent)
        try:
            from app.models import ensure_db_indexes
            ensure_db_indexes()
        except Exception as e:
            logger.warning(f"Failed to ensure DB indexes: {e}")
        # Pass the socketio server instance to the manager so it can emit messages
        socket_manager = MO_WebSocket_Manager(socketio_server=socketio)
        socket_manager.start()

    # Set the view to redirect to for routes requiring login
    login_manager.login_view = '/api/auth/login'

    # --- Import and Register Blueprints ---
    from .routes import auth, trade, portfolio, orders, profile, search, markets, watchlist
    from .routes.stock import stock_bp

    # Register all blueprints with a consistent '/api' prefix
    app.register_blueprint(auth.bp, url_prefix='/api/auth')
    app.register_blueprint(stock_bp, url_prefix='/api')
    app.register_blueprint(search.search_bp, url_prefix='/api')
    app.register_blueprint(trade.bp, url_prefix='/api')
    app.register_blueprint(portfolio.bp, url_prefix='/api')
    app.register_blueprint(orders.bp, url_prefix='/api')
    app.register_blueprint(profile.bp, url_prefix='/api')
    app.register_blueprint(markets.markets_bp, url_prefix='/api')
    app.register_blueprint(watchlist.bp, url_prefix='/api')
    
    # Import db_scrips_populate here to avoid circular imports
    from . import db_scrips_populate
    app.register_blueprint(db_scrips_populate.data_management_bp, url_prefix='/api/data')

    # --- Root Route for Health Check ---
    @app.route('/')
    def health_check():
        """Simple health check endpoint."""
        return jsonify({"status": "healthy", "message": "TradeEasy API is running"}), 200

    # --- Define Login Manager Handlers ---
    @login_manager.user_loader
    def load_user(user_id):
        """Load user by ID for session management."""
        from .models import User
        try:
            return User.objects(id=ObjectId(user_id)).first()
        except Exception as e:
            logger.warning(f"Failed to load user with ID {user_id}: {e}")
            return None

    @login_manager.unauthorized_handler
    def unauthorized_handler():
        """Handle unauthorized access attempts for @login_required routes."""
        return jsonify({"error": "Unauthorized access. Please log in."}), 401

    # --- Define SocketIO Event Handlers ---
    @socketio.on('connect')
    def handle_connect():
        """
        Handles a new client connection. It immediately sends the latest
        cached data to populate the client's UI.
        """
        logger.info("Client connected")
        # Get the existing socket manager instance (don't create a new one)
        socket_manager = MO_WebSocket_Manager(socketio_server=socketio)
        latest_data = socket_manager.get_latest_data()
        if latest_data:
            # Emit to the specific client that just connected
            emit('initial_indices', latest_data, room=request.sid)
        # Emit current market status (open/closed) so client can adjust expectations
        try:
            is_open = False
            # Prefer the MO market hours helper if available
            if hasattr(socket_manager, 'mo_api') and hasattr(socket_manager.mo_api, 'market_hours'):
                is_open = bool(socket_manager.mo_api.market_hours.is_market_open())
            emit('market_status', {"isOpen": is_open, "source": "connect"}, room=request.sid)
        except Exception:
            pass

    @socketio.on('disconnect')
    def handle_disconnect():
        """Handles a client disconnection."""
        logger.info("Client disconnected")

    logger.info(f"Flask app created with '{AppConfig.__name__}' configuration.")
    return app