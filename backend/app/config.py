import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from the .env file at the project root
load_dotenv()

def get_bool_from_env(name, default=False):
    """
    Reads an environment variable and safely converts it to a boolean.
    Returns `True` for 'true', '1', 't', 'y', 'yes'. Case-insensitive.
    """
    val = os.getenv(name, str(default)).strip().lower()
    return val in ('true', '1', 't', 'y', 'yes')

class Config:
    """
    Base configuration class. Contains default settings and settings loaded
    from environment variables that are common across all environments.
    """
    # --- Application Security ---
    SECRET_KEY = os.getenv('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("FATAL ERROR: SECRET_KEY is not set. Please define it in your .env file for session security.")

    BCRYPT_LOG_ROUNDS = int(os.getenv('BCRYPT_LOG_ROUNDS', 12))

    # --- Session Management ---
    # Use 'redis' in production for better performance and scalability
    SESSION_TYPE = os.getenv('SESSION_TYPE', 'filesystem')
    SESSION_FILE_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', 'flask_session')
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(hours=int(os.getenv("SESSION_LIFETIME_HOURS", 8)))
    SESSION_USE_SIGNER = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    # For Redis sessions, you would uncomment and configure the following:
    # SESSION_REDIS = redis.from_url(os.getenv('REDIS_URL', 'redis://localhost:6379/0'))

    # --- Database Configuration ---
    MONGODB_SETTINGS = {
        'host': os.getenv('MONGODB_URI'),
        'db': os.getenv('MONGO_DB_NAME')
    }
    if not MONGODB_SETTINGS['host'] or not MONGODB_SETTINGS['db']:
        raise ValueError("FATAL ERROR: MONGODB_URI or MONGO_DB_NAME is not set in the .env file.")

    # --- API Credentials ---
    # Credentials for the Motilal Oswal API are loaded here but used in mo_api.py
    API_KEY = os.getenv("API_KEY")
    USER_ID = os.getenv("USER_ID")
    PASSWORD = os.getenv("PASSWORD")
    TWO_FA = os.getenv("TWO_FA")
    TOTP_SECRET = os.getenv("TOTP_SECRET")

    if not all([API_KEY, USER_ID, PASSWORD, TWO_FA, TOTP_SECRET]):
        print("WARNING: Motilal Oswal API credentials are not fully set in the .env file. API functionality will be limited.")


class DevelopmentConfig(Config):
    """
    Configuration for the local development environment.
    Enables debugging and disables security features not needed for local development.
    """
    DEBUG = True
    SESSION_COOKIE_SECURE = False # Allow sessions over HTTP for local testing
    
    # Use a simple, predictable secret key for development ONLY
    if Config.SECRET_KEY == 'your-production-secret-key':
        print("WARNING: Using a weak, default SECRET_KEY for development.")
        SECRET_KEY = 'dev-secret-key-for-testing'


class ProductionConfig(Config):
    """
    Configuration for the production environment.
    Disables debugging and enforces stricter security settings.
    """
    DEBUG = False
    SESSION_COOKIE_SECURE = True # Enforce HTTPS for all session cookies
    SESSION_COOKIE_SAMESITE = 'Strict'

    # Critical security check for production
    if not Config.SECRET_KEY or Config.SECRET_KEY == 'dev-secret-key-for-testing':
         raise ValueError("FATAL ERROR: A strong, unique SECRET_KEY must be set for production.")


# --- Configuration Selection ---
# The application will use DevelopmentConfig if FLASK_DEBUG is true, otherwise ProductionConfig.
IS_DEBUG_MODE = get_bool_from_env('FLASK_DEBUG', default=False)

if IS_DEBUG_MODE:
    AppConfig = DevelopmentConfig
    print("INFO: Running in Development mode.")
else:
    AppConfig = ProductionConfig
    print("INFO: Running in Production mode.")
