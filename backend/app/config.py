import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    """Base configuration class for the Flask app."""

    # 🔑 SECRET KEY (MANDATORY for session security)
    SECRET_KEY = os.getenv('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("❌ FATAL ERROR: SECRET_KEY is not set. Please define it in your .env file.")

    # ⚙️ SESSION CONFIGURATION
    SESSION_PROTECTION = 'strong'
    SESSION_TYPE = 'filesystem'  # Use filesystem for development
    SESSION_FILE_DIR = os.path.join(os.getcwd(), 'flask_session')
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=int(os.getenv("SESSION_LIFETIME", 120)))  # Extended to 2 hours
    SESSION_USE_SIGNER = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
    # Add session refresh configuration
    SESSION_REFRESH_EACH_REQUEST = True
    # Add cookie domain and path configuration
    SESSION_COOKIE_DOMAIN = None  # Allow cookies to work on localhost
    SESSION_COOKIE_PATH = '/'

    # 🍃 MONGODB CONFIGURATION
    MONGODB_SETTINGS = {
        'host': os.getenv('MONGODB_URI'),
        'db': os.getenv('MONGO_DB_NAME')
    }
    if not MONGODB_SETTINGS['host'] or not MONGODB_SETTINGS['db']:
        raise ValueError("❌ FATAL ERROR: MONGODB_URI or MONGO_DB_NAME is not set. Check your .env file.")

    # 🔒 BCRYPT HASHING ROUNDS
    # Higher number means more secure but slower. 12 is a good default.
    BCRYPT_LOG_ROUNDS = int(os.getenv('BCRYPT_LOG_ROUNDS', 12))

    # 📈 MOTILAL OSWAL API CREDENTIALS
    # These names MUST match the variables used in mo_api.py
    API_KEY = os.getenv("API_KEY")
    USER_ID = os.getenv("USER_ID")
    PASSWORD = os.getenv("PASSWORD")
    TWO_FA = os.getenv("TWO_FA")
    TOTP_SECRET = os.getenv("TOTP_SECRET")

    if not all([API_KEY, USER_ID, PASSWORD, TWO_FA, TOTP_SECRET]):
        print("⚠️ WARNING: Motilal Oswal API credentials are not fully set in the .env file.")

class DevelopmentConfig(Config):
    """Configuration for the development environment."""
    DEBUG = True
    SESSION_COOKIE_SECURE = False # Allow HTTP for local development

class ProductionConfig(Config):
    """Configuration for the production environment."""
    DEBUG = False
    SESSION_COOKIE_SECURE = True # Enforce HTTPS
    # Ensure a strong secret key is used in production
    if Config.SECRET_KEY == 'your-default-secret-key-here':
         raise ValueError("❌ FATAL ERROR: Do not use the default SECRET_KEY in production.")

# 🔁 Select configuration based on FLASK_DEBUG environment variable
FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'

if FLASK_DEBUG:
    AppConfig = DevelopmentConfig
else:
    AppConfig = ProductionConfig
