import os
import logging
import atexit
from flask import Flask, jsonify, request
from flask_mongoengine import MongoEngine
from flask_cors import CORS
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv
from bson import ObjectId

# --- Load Environment Variables ---
# Best practice to load this at the very top
load_dotenv()

# --- Configure Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logging.getLogger('werkzeug').setLevel(logging.WARNING)  # Quiets the default Flask request logger
logger = logging.getLogger(__name__)

# --- Initialize Flask Extensions ---
# Extensions are instantiated globally and then initialized within the app factory
db = MongoEngine()
login_manager = LoginManager()
bcrypt = Bcrypt()
socketio = SocketIO()

# --- Application Factory ---

def create_app():
    """
    Factory function to create and configure the Flask application.
    This pattern promotes testability and avoids circular imports.
    """
    app = Flask(__name__)

    # --- Load Configuration ---
    from app.config import AppConfig
    app.config.from_object(AppConfig)

    # --- Initialize Extensions with App Context ---
    db.init_app(app)
    login_manager.init_app(app)
    bcrypt.init_app(app)

    # --- CORS Configuration ---
    # Configure CORS for both standard HTTP requests and WebSocket connections
    frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5173')
    socketio.init_app(app, cors_allowed_origins=[frontend_url, "http://127.0.0.1:5173"])
    CORS(
        app,
        resources={r"/api/*": {"origins": [frontend_url, "http://127.0.0.1:5173"]}},
        supports_credentials=True
    )

    # --- Singleton WebSocket Manager Initialization ---
    with app.app_context():
        from app.socket_manager import MO_WebSocket_Manager
        
        # Instantiate the singleton manager and pass the socketio server to it
        # This allows the manager's background threads to emit data to clients
        socket_manager = MO_WebSocket_Manager(socketio_server=socketio)
        socket_manager.start()

        # --- Graceful Shutdown Hook ---
        # Register the shutdown function to be called when the app exits.
        # This ensures WebSocket connections are closed cleanly.
        atexit.register(socket_manager.shutdown)

    # --- Register Blueprints for API Routes ---
    # Grouping blueprint imports and registrations for better organization
    from .routes import auth, markets, orders, portfolio, profile, search, stock, trade, watchlist
    from .db_scrips_populate import data_management_bp
    
    app.register_blueprint(auth.auth_bp, url_prefix='/api/auth')
    app.register_blueprint(markets.markets_bp, url_prefix='/api/markets')
    app.register_blueprint(orders.orders_bp, url_prefix='/api/orders')
    app.register_blueprint(portfolio.portfolio_bp, url_prefix='/api/portfolio')
    app.register_blueprint(profile.profile_bp, url_prefix='/api/profile')
    app.register_blueprint(search.search_bp, url_prefix='/api/search')
    app.register_blueprint(stock.stock_bp, url_prefix='/api/stock')
    app.register_blueprint(trade.trade_bp, url_prefix='/api/trade')
    app.register_blueprint(watchlist.watchlist_bp, url_prefix='/api/watchlist')
    app.register_blueprint(data_management_bp, url_prefix='/api/data')

    # --- Health Check Endpoint ---
    @app.route('/')
    def health_check():
        return jsonify({"status": "healthy", "message": "TradeEasy API is running"}), 200

    # --- Configure Flask-Login Handlers ---
    login_manager.login_view = 'auth.login' # Points to the login function in the auth blueprint

    @login_manager.user_loader
    def load_user(user_id):
        """Loads a user from the database for session management."""
        from .models import User
        try:
            return User.objects(id=ObjectId(user_id)).first()
        except Exception as e:
            logger.error(f"Error loading user {user_id}: {e}")
            return None

    @login_manager.unauthorized_handler
    def unauthorized():
        """Returns a consistent 401 Unauthorized error response."""
        return jsonify({
            "success": False,
            "message": "Authentication required. Please log in."
        }), 401

    # --- Configure SocketIO Event Handlers ---
    @socketio.on('connect')
    def handle_connect():
        """
        Handles new client connections by sending the latest cached data
        to immediately populate their UI.
        """
        logger.info(f"Client connected: {request.sid}")
        # Get the singleton instance of the manager
        manager = MO_WebSocket_Manager() 
        # Send the latest cached index data to the newly connected client
        latest_indices = manager.get_latest_indices_data()
        if latest_indices:
            emit('initial_indices', latest_indices, room=request.sid)
        # Inform client of current market status
        market_open = manager.mo_api.market_hours.is_market_open()
        emit('market_status', {"isOpen": market_open}, room=request.sid)

    @socketio.on('disconnect')
    def handle_disconnect():
        """Logs when a client disconnects."""
        logger.info(f"Client disconnected: {request.sid}")

    logger.info("Flask application created and configured successfully.")
    return app
