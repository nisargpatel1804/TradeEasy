import logging
import re
import time
from flask import Blueprint, request, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from mongoengine.errors import NotUniqueError
from app.models import User, Watchlist
from app import bcrypt  # Imported from the app factory in __init__.py

# --- Configuration ---
logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# --- Constants for Validation and Security ---
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
MOBILE_REGEX = re.compile(r"^\+91[6-9]\d{9}$") # Indian mobile number format
PASSWORD_MIN_LENGTH = 8
LOGIN_ATTEMPT_WINDOW_SECONDS = 300  # 5 minutes
LOGIN_ATTEMPT_THRESHOLD = 5
LOGIN_RETRY_AFTER_SECONDS = 300

# --- Routes ---

@auth_bp.route('/signup', methods=['POST'])
def signup():
    """
    Handles new user registration with robust validation and secure password hashing.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Invalid request body."}), 400

        email = str(data.get('email', '')).strip().lower()
        mobile = str(data.get('mobile', '')).strip()
        password = data.get('password')

        # --- Input Validation ---
        if not all([email, mobile, password]):
            return jsonify({"success": False, "message": "Email, mobile, and password are required."}), 400
        if not EMAIL_REGEX.match(email):
            return jsonify({"success": False, "message": "Invalid email format."}), 400
        if not MOBILE_REGEX.match(mobile):
            return jsonify({"success": False, "message": "Mobile number must be in +91XXXXXXXXXX format."}), 400
        if len(password) < PASSWORD_MIN_LENGTH:
            return jsonify({"success": False, "message": f"Password must be at least {PASSWORD_MIN_LENGTH} characters."}), 400
        if password != data.get('confirm_password'):
            return jsonify({"success": False, "message": "Passwords do not match."}), 400

        # --- User Creation ---
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        
        new_user = User(
            email=email,
            mobile=mobile,
            password=hashed_password,
            username=email.split('@')[0] # Default username from email prefix
        )
        
        # Every new user gets a default watchlist for a better first-time experience
        new_user.watchlists.append(Watchlist(name="My Watchlist", is_deletable=False))
        
        new_user.save()

        logger.info(f"New user signed up: {new_user.client_id} ({new_user.email})")
        return jsonify({
            "success": True,
            "message": "Account created successfully. Please log in.",
            "client_id": new_user.client_id
        }), 201

    except NotUniqueError:
        logger.warning(f"Signup attempt with existing email/mobile: {email}/{mobile}")
        return jsonify({"success": False, "message": "An account with this email or mobile already exists."}), 409
    except Exception as e:
        logger.error(f"Error during signup: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Handles user login with credential verification and brute-force protection.
    """
    try:
        now = time.time()
        attempts = [ts for ts in session.get('login_attempts', []) if now - ts < LOGIN_ATTEMPT_WINDOW_SECONDS]

        if len(attempts) >= LOGIN_ATTEMPT_THRESHOLD:
            logger.warning(f"Login rate limit hit for IP: {request.remote_addr}")
            return jsonify({"success": False, "message": "Too many login attempts. Please try again later."}), 429

        data = request.get_json()
        if not data or not data.get('client_id') or not data.get('password'):
            return jsonify({"success": False, "message": "Client ID and password are required."}), 400

        client_id = data.get('client_id').strip().upper()
        password = data.get('password')
        
        user = User.objects(client_id=client_id).first()

        if user and user.is_active and bcrypt.check_password_hash(user.password, password):
            login_user(user, remember=True)
            session.pop('login_attempts', None) # Clear attempts on successful login
            logger.info(f"User {user.client_id} logged in successfully.")
            return jsonify({
                "success": True,
                "message": "Login successful.",
                "user": {"client_id": user.client_id, "username": user.username}
            }), 200
        else:
            attempts.append(now)
            session['login_attempts'] = attempts
            logger.warning(f"Failed login attempt for Client ID: {client_id}")
            return jsonify({"success": False, "message": "Invalid Client ID or password."}), 401

    except Exception as e:
        logger.error(f"Error during login: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """Logs out the current user and clears the session."""
    try:
        user_id = current_user.client_id
        logout_user()

        # Remove application-specific session data while preserving
        # Flask-Login's internal markers (e.g. _remember) so the
        # framework can properly clear persistent cookies.
        for key in list(session.keys()):
            if not key.startswith('_'):
                session.pop(key, None)

        session.modified = True
        logger.info(f"User {user_id} logged out.")
        return jsonify({"success": True, "message": "You have been successfully logged out."}), 200
    except Exception as e:
        logger.error(f"Error during logout: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred during logout."}), 500

@auth_bp.route('/check-auth', methods=['GET'])
@login_required
def check_auth():
    """
    A protected endpoint to verify if the client's session is still valid.
    The @login_required decorator handles the authentication check.
    """
    return jsonify({
        "isAuthenticated": True,
        "user": {
            "client_id": current_user.client_id,
            "username": current_user.username
        }
    }), 200
