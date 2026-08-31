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
    SESSION_TYPE = os.getenv('SESSION_TYPE', 'filesystem')
    SESSION_FILE_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), '..', 'flask_session')
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(hours=int(os.getenv("SESSION_LIFETIME_HOURS", 8)))
    SESSION_USE_SIGNER = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    
    # Session idle timeout (inactive sessions expire after this duration)
    SESSION_IDLE_TIMEOUT = timedelta(minutes=int(os.getenv("SESSION_IDLE_TIMEOUT_MINUTES", 30)))

    # --- Database Configuration ---
    MONGODB_SETTINGS = {
        'host': os.getenv('MONGODB_URI'),
        'db': os.getenv('MONGO_DB_NAME')
    }
    if not MONGODB_SETTINGS['host'] or not MONGODB_SETTINGS['db']:
        raise ValueError("FATAL ERROR: MONGODB_URI or MONGO_DB_NAME is not set in the .env file.")

    # --- Motilal Oswal API Credentials ---
    # Credentials for the Motilal Oswal API are loaded here but used in mo_api.py
    # NOTE: For production, consider using encrypted storage or a secrets manager.
    API_KEY = os.getenv("API_KEY")
    API_SECRET_KEY = os.getenv("API_SECRET_KEY")
    USER_ID = os.getenv("USER_ID")
    PASSWORD = os.getenv("PASSWORD")
    TWO_FA = os.getenv("TWO_FA")
    TOTP_SECRET = os.getenv("TOTP_SECRET")

    # Optional per-app key to HMAC reset tokens. Falls back to SECRET_KEY if not set.
    RESET_TOKEN_HMAC_KEY = os.getenv('RESET_TOKEN_HMAC_KEY')

    # MO API Credential Validation
    if not all([API_KEY, USER_ID, PASSWORD, TWO_FA]):
        print("WARNING: Core Motilal Oswal API credentials (API_KEY, USER_ID, PASSWORD, TWO_FA) are missing. API functionality will be limited.")
    
    if not API_SECRET_KEY:
        print("WARNING: API_SECRET_KEY is not set. The dual-token login flow (v1/getaccesstoken) will fail.")
        
    if TOTP_SECRET:
        import re
        if len(TOTP_SECRET) != 32:
            print(f"WARNING: TOTP_SECRET has unusual length ({len(TOTP_SECRET)} chars). Expected 32 characters.")
        if not re.match(r'^[A-Z2-7]+=*$', TOTP_SECRET):
            print("WARNING: TOTP_SECRET doesn't appear to be valid base32 encoding.")
    else:
        print("WARNING: TOTP_SECRET is missing. The system will fall back to manual OTP flow, which breaks automated background jobs.")


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
    SESSION_COOKIE_SAMESITE = 'None' # Allow cross-origin cookies (required for separate frontend/backend domains)

    # Critical security check for production
    if not Config.SECRET_KEY or Config.SECRET_KEY == 'dev-secret-key-for-testing':
         raise ValueError("FATAL ERROR: A strong, unique SECRET_KEY must be set for production.")


# --- Configuration Selection ---
# The application will use DevelopmentConfig if FLASK_DEBUG is true, otherwise ProductionConfig.
IS_DEBUG_MODE = get_bool_from_env('FLASK_DEBUG', default=False)

# Select config class
if IS_DEBUG_MODE:
    AppConfig = DevelopmentConfig
    print("INFO: Running in Development mode.")
else:
    AppConfig = ProductionConfig
    print("INFO: Running in Production mode.")

# --- Market Holidays Configuration (override via env) ---
# Accept either:
#  - MARKET_HOLIDAYS as a comma-separated list of YYYY-MM-DD dates, or
#  - MARKET_HOLIDAYS_FILE pointing to a file with one YYYY-MM-DD per line.
# If neither is provided, defaults to an empty list (so market_time can decide).
import os
_market_holidays_env = os.getenv('MARKET_HOLIDAYS', '').strip()
_market_holidays_file = os.getenv('MARKET_HOLIDAYS_FILE', '').strip()

_markets = []
if _market_holidays_env:
    _markets = [d.strip() for d in _market_holidays_env.split(',') if d.strip()]

if _market_holidays_file and os.path.exists(_market_holidays_file):
    try:
        with open(_market_holidays_file, 'r', encoding='utf-8') as fh:
            file_dates = [line.strip() for line in fh if line.strip()]
            # file entries override/extend env values
            _markets = list(dict.fromkeys(_markets + file_dates))
    except Exception as e:
        print(f"WARNING: Failed to load MARKET_HOLIDAYS_FILE '{_market_holidays_file}': {e}")

# Expose as attribute on AppConfig for other modules to consume.
setattr(AppConfig, 'MARKET_HOLIDAYS', _markets)