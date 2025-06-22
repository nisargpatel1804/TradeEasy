import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Retrieve API Key
ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY")

class Config:
    """Base configuration for Flask app."""

    # 🔑 Secret Key (Required)
    SECRET_KEY = os.getenv('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("❌ ERROR: SECRET_KEY is missing. Set it in your environment variables.")

    # ⚙️ Session Configuration  
    SESSION_PROTECTION = 'strong'  # Prevent session tampering
    SESSION_TYPE = 'filesystem'  # Store session data on the server
    SESSION_FILE_DIR = os.path.join(os.getcwd(), 'flask_session')  # Directory for session files
    os.makedirs(SESSION_FILE_DIR, exist_ok=True)  # Create directory if it doesn't exist
    SESSION_PERMANENT = True  # Make sessions permanent
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=int(os.getenv("SESSION_LIFETIME", 30)))  # Default: 30 mins
    SESSION_USE_SIGNER = True  # Encrypt session cookies
    SESSION_COOKIE_HTTPONLY = True  # Prevent client-side script access to the cookie
    SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', 'False').lower() == 'true'  # HTTPS only in production
    SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')  # Prevent CSRF attacks
    SESSION_COOKIE_DOMAIN = os.getenv('SESSION_COOKIE_DOMAIN', None)  # For cross-domain cookies

    # 🛠️ Database Configuration
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URI')
    if not SQLALCHEMY_DATABASE_URI:
        raise ValueError("❌ ERROR: DATABASE_URI is missing. Check your `.env` file.")

    SQLALCHEMY_TRACK_MODIFICATIONS = False  # Disable modification tracking to save resources
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'  # Enable debug mode based on environment

    # 🔒 AES Encryption Config
    ENCRYPTION_SALT = os.getenv('ENCRYPTION_SALT', 'tradeeasy')  # Default encryption salt

    # 🌐 Enhanced CORS Configuration
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(',')
    CORS_METHODS = os.getenv('CORS_METHODS', 'GET,POST,PUT,DELETE,OPTIONS,PATCH')
    CORS_ALLOW_HEADERS = os.getenv('CORS_ALLOW_HEADERS', 'Content-Type,Authorization,X-Requested-With')
    CORS_EXPOSE_HEADERS = os.getenv('CORS_EXPOSE_HEADERS', 'Content-Type,X-CSRFToken')
    CORS_SUPPORTS_CREDENTIALS = True  # Allow cookies and authentication headers
    CORS_MAX_AGE = int(os.getenv('CORS_MAX_AGE', 86400))  # 24 hours for preflight cache

    # 🚫 API Rate Limiting / Blocking
    API_BLOCKED = os.getenv('API_BLOCKED', 'False').lower() == 'true'  # Block API access if set to True
    
    # 📊 Market Data Configuration
    USE_ALTERNATIVE_SOURCES = os.getenv('USE_ALTERNATIVE_SOURCES', 'True').lower() == 'true'  # Enable alternative sources
    MAX_RETRIES = int(os.getenv('MAX_RETRIES', '5'))  # Increased maximum number of retries for API calls
    CACHE_TIMEOUT = int(os.getenv('CACHE_TIMEOUT', '7200'))  # Increased timeout for cached data to 2 hours
    REQUEST_TIMEOUT = int(os.getenv('REQUEST_TIMEOUT', '20'))  # Increased timeout for API requests in seconds
    
    # 🔄 Batch processing settings
    BATCH_SIZE = int(os.getenv('BATCH_SIZE', '10'))  # Number of stocks to process in one batch
    BATCH_DELAY = int(os.getenv('BATCH_DELAY', '5'))  # Delay between batches in seconds
    MAX_CONCURRENT_REQUESTS = int(os.getenv('MAX_CONCURRENT_REQUESTS', '5'))  # Maximum concurrent requests
    
    # 🌐 Alternative data sources configuration
    NSE_INDIA_URL = os.getenv('NSE_INDIA_URL', 'https://www.nseindia.com/api/quote-equity?symbol=')
    MONEY_CONTROL_URL = os.getenv('MONEY_CONTROL_URL', 'https://www.moneycontrol.com/india/stockpricequote/')
    INVESTING_URL = os.getenv('INVESTING_URL', 'https://in.investing.com/indices/')


class DevelopmentConfig(Config):
    """Configuration for development environment."""
    DEBUG = True  # Enable debug mode
    SESSION_COOKIE_SECURE = False  # Allow HTTP for local development
    SQLALCHEMY_ECHO = True  # Log SQL queries for debugging
    CORS_ORIGINS = ['*']  # Allow all origins in development
    CORS_SUPPORTS_CREDENTIALS = True
    USE_ALTERNATIVE_SOURCES = True  # Always use alternative sources in development


class ProductionConfig(Config):
    """Configuration for production environment."""
    DEBUG = False  # Disable debug mode
    SESSION_COOKIE_SECURE = True  # Enforce HTTPS for security
    SESSION_PERMANENT = True  # Ensure sessions persist
    SQLALCHEMY_ECHO = False  # Disable SQL query logging in production
    CORS_ORIGINS = os.getenv('CORS_ORIGINS', '').split(',')  # Strict origin control
    # In production, rely on .env setting for alternative sources
    USE_ALTERNATIVE_SOURCES = os.getenv('USE_ALTERNATIVE_SOURCES', 'True').lower() == 'true'


# 🔁 Configuration selection based on environment
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}

# 🚀 Automatically select config based on FLASK_ENV (Default: Development)
FLASK_ENV = os.getenv('FLASK_ENV', 'development').lower()
AppConfig = config.get(FLASK_ENV, DevelopmentConfig)