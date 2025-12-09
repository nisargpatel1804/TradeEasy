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

def _env_flag(name: str, default: bool = False) -> bool:
    """Parse truthy environment flags with sensible defaults."""
    value = os.getenv(name, str(default)).strip().lower()
    return value in {"1", "true", "t", "y", "yes"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logging.getLogger(__name__).warning(
            "Invalid integer for %s=%s. Falling back to %s.",
            name,
            value,
            default,
        )
        return default


# --- Configure Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

SUPPRESS_SOCKET_LOGS = _env_flag('SUPPRESS_SOCKET_LOGS', default=True)

if SUPPRESS_SOCKET_LOGS:
    for logger_name, level in (
        ('app.socket_manager', logging.WARNING),
        ('app.moapi.mo_api', logging.WARNING),
        ('websocket', logging.WARNING),
        ('engineio', logging.ERROR),
        ('socketio', logging.ERROR),
        ('werkzeug', logging.CRITICAL),  # Suppress werkzeug WSGI errors (including disconnect race conditions)
    ):
        logging.getLogger(logger_name).setLevel(level)
else:
    logging.getLogger('werkzeug').setLevel(logging.WARNING)  # Quiets the default Flask request logger
logger = logging.getLogger(__name__)

# --- Initialize Flask Extensions ---
# Extensions are instantiated globally and then initialized within the app factory
db = MongoEngine()
login_manager = LoginManager()
bcrypt = Bcrypt()
SOCKETIO_PING_INTERVAL = _env_int('SOCKETIO_PING_INTERVAL', 25)
SOCKETIO_PING_TIMEOUT = _env_int('SOCKETIO_PING_TIMEOUT', 90)
SOCKETIO_MAX_HTTP_BUFFER = _env_int('SOCKETIO_MAX_HTTP_BUFFER', 2 * 1024 * 1024)
socketio = SocketIO(
    logger=not SUPPRESS_SOCKET_LOGS,
    engineio_logger=not SUPPRESS_SOCKET_LOGS,
    async_mode='threading',
    ping_interval=SOCKETIO_PING_INTERVAL,
    ping_timeout=SOCKETIO_PING_TIMEOUT,
    max_http_buffer_size=SOCKETIO_MAX_HTTP_BUFFER,
    always_connect=True,
    cors_allowed_origins='*',
)

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
    socketio.init_app(
        app,
        cors_allowed_origins='*',
        ping_interval=SOCKETIO_PING_INTERVAL,
        ping_timeout=SOCKETIO_PING_TIMEOUT,
        max_http_buffer_size=SOCKETIO_MAX_HTTP_BUFFER,
        always_connect=True,
    )
    
    # Allow CORS for API routes - more permissive in development
    if app.config.get('DEBUG', False):
        CORS(app, supports_credentials=True, origins='*')
    else:
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
        # force_connect=True enables WebSocket connection even when markets are closed
        socket_manager = MO_WebSocket_Manager(socketio_server=socketio, force_connect=True)
        socket_manager.start()

        # --- Initialize Task Scheduler for Background Jobs ---
        from app.scheduler import init_scheduler
        task_scheduler = init_scheduler(app)

        # --- Graceful Shutdown Hook ---
        # Register the shutdown function to be called when the app exits.
        # This ensures WebSocket connections and scheduled tasks are closed cleanly.
        def cleanup():
            socket_manager.shutdown()
            task_scheduler.shutdown()
        
        atexit.register(cleanup)

    # --- Register Blueprints for API Routes ---
    # Grouping blueprint imports and registrations for better organization
    from .routes import auth, markets, orders, portfolio, profile, search, stock, trade, watchlist
    from .db_scrips_populate import data_management_bp
    
    app.register_blueprint(auth.auth_bp, url_prefix='/api')
    app.register_blueprint(markets.markets_bp, url_prefix='/api')
    app.register_blueprint(orders.orders_bp, url_prefix='/api')
    app.register_blueprint(portfolio.portfolio_bp, url_prefix='/api')
    app.register_blueprint(profile.profile_bp, url_prefix='/api')
    app.register_blueprint(search.search_bp, url_prefix='/api')
    app.register_blueprint(stock.stock_bp, url_prefix='/api')
    app.register_blueprint(trade.trade_bp, url_prefix='/api')
    app.register_blueprint(watchlist.watchlist_bp, url_prefix='/api')
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

    # --- Session Idle Timeout Middleware ---
    @app.before_request
    def check_session_timeout():
        """Check if the session has been idle for too long."""
        from flask_login import current_user
        from flask import session
        from datetime import datetime
        
        if current_user.is_authenticated:
            now = datetime.utcnow()
            last_activity = session.get('last_activity')
            
            # Update timestamp at the start to prevent race conditions
            session['last_activity'] = now.isoformat()
            session.modified = True
            
            # Check if previous activity was too long ago
            if last_activity:
                from datetime import datetime as dt
                if isinstance(last_activity, str):
                    try:
                        last_activity = dt.fromisoformat(last_activity)
                    except ValueError:
                        # Invalid timestamp format - reset and continue
                        logger.warning(f"Invalid last_activity timestamp for user {current_user.client_id}")
                        return
                
                idle_duration = now - last_activity
                if idle_duration > app.config['SESSION_IDLE_TIMEOUT']:
                    logger.info(f"Session expired due to inactivity for user {current_user.client_id} (idle: {idle_duration})")
                    from flask_login import logout_user
                    logout_user()
                    session.clear()
                    return jsonify({
                        "success": False,
                        "message": "Session expired due to inactivity. Please log in again."
                    }), 401

    # --- Configure SocketIO Event Handlers ---
    @socketio.on('connect')
    def handle_connect():
        """
        Handles new client connections by sending the latest cached data
        to immediately populate their UI and registering their watchlist stocks.
        """
        try:
            from flask_login import current_user
            
            logger.info(f"Client connected: {request.sid}")
            
            # Get the singleton instance of the manager
            manager = MO_WebSocket_Manager()
            
            # If user is authenticated, register their watchlist stocks for real-time updates
            if current_user.is_authenticated:
                try:
                    manager.register_user_watchlist_stocks(current_user.id)
                except Exception as e:
                    logger.error(f"Error registering watchlist stocks for user {current_user.id}: {e}")
            
            # Send the latest cached index data to the newly connected client
            latest_indices = manager.get_latest_indices_data()
            if latest_indices:
                emit('initial_indices', latest_indices, room=request.sid)
            latest_stock_prices = manager.get_latest_stock_data()
            if latest_stock_prices:
                emit('initial_stock_prices', latest_stock_prices, room=request.sid)
            # Inform client of current market status
            market_open = manager.mo_api.market_hours.is_market_open()
            emit('market_status', {"isOpen": market_open}, room=request.sid)
        except Exception as e:
            logger.error(f"Error in connect handler: {e}", exc_info=True)

    @socketio.on('disconnect')
    def handle_disconnect():
        """Logs when a client disconnects."""
        try:
            logger.info(f"Client disconnected: {request.sid}")
        except Exception as e:
            logger.error(f"Error in disconnect handler: {e}", exc_info=True)

    logger.info("Flask application created and configured successfully.")
    return app
