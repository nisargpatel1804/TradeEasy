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
    SESSION_TYPE = 'filesystem'
    SESSION_FILE_DIR = os.path.join(os.getcwd(), 'flask_session')
    os.makedirs(SESSION_FILE_DIR, exist_ok=True)
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=int(os.getenv("SESSION_LIFETIME", 60)))
    SESSION_USE_SIGNER = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')

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

    if not all([API_KEY, USER_ID, PASSWORD, TWO_FA]):
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

# 🔁 Select configuration based on FLASK_ENV or FLASK_DEBUG environment variables
FLASK_ENV = os.getenv('FLASK_ENV', 'development')

if FLASK_ENV == 'production':
    AppConfig = ProductionConfig
else:
    AppConfig = DevelopmentConfig

# Also check FLASK_DEBUG for convenience during development startup
if os.getenv('FLASK_DEBUG', 'False').lower() == 'true':
    AppConfig = DevelopmentConfig
