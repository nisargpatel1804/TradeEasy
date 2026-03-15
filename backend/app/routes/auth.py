import logging
import re
import time
import secrets
import hmac
import hashlib
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, session, current_app
from flask_login import login_user, logout_user, login_required, current_user
from mongoengine.errors import NotUniqueError
from app.models import User, Watchlist
from app import bcrypt  # Imported from the app factory in __init__.py

# --- Configuration ---
logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

# --- Constants for Validation and Security ---
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
MOBILE_REGEX = re.compile(r"^\+91\d{10}$")  # +91 followed by any 10 digits
PASSWORD_MIN_LENGTH = 8
LOGIN_ATTEMPT_WINDOW_SECONDS = 300  # 5 minutes
LOGIN_ATTEMPT_THRESHOLD = 5
LOGIN_RETRY_AFTER_SECONDS = 300


def _hash_reset_token(token: str) -> str:
    """Return an HMAC-SHA256 hash of the reset token using the app's secret key.

    Uses `RESET_TOKEN_HMAC_KEY` from config if present, otherwise falls back to
    Flask `SECRET_KEY`. The returned value is hex-encoded for storage.
    """
    key = current_app.config.get('RESET_TOKEN_HMAC_KEY', current_app.config.get('SECRET_KEY', ''))
    if isinstance(key, str):
        key = key.encode('utf-8')
    return hmac.new(key, token.encode('utf-8'), hashlib.sha256).hexdigest()

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
            # Respect the remember_me flag from the client; default to False for security
            remember = bool(data.get('remember_me', False))
            # Prevent session fixation: clear previous session data before login
            # and set the last activity timestamp in one shot to avoid two
            # separate writes to the session store.
            session.clear()
            session['last_activity'] = time.time()
            login_user(user, remember=remember)
            session.pop('login_attempts', None)  # Clear attempts on successful login
            session.modified = True
            logger.info(f"User {user.client_id} logged in successfully (remember={remember}, ip={request.remote_addr}).")
            # Audit log (no secrets): successful login
            logger.info(f'AUDIT: login_success client_id={user.client_id} ip={request.remote_addr} user_agent={request.headers.get("User-Agent")}')
            return jsonify({
                "success": True,
                "message": "Login successful.",
                "user": {"client_id": user.client_id, "username": user.username}
            }), 200
        else:
            attempts.append(now)
            # keep the list trimmed to the window length to avoid ever-growing
            session['login_attempts'] = [ts for ts in attempts if now - ts < LOGIN_ATTEMPT_WINDOW_SECONDS]
            logger.warning(f"Failed login attempt for Client ID: {client_id} from IP: {request.remote_addr}")
            # Audit log (no secrets): failed login
            logger.info(f'AUDIT: login_failed client_id={client_id} ip={request.remote_addr} user_agent={request.headers.get("User-Agent")}')
            return jsonify({"success": False, "message": "Invalid Client ID or password."}), 401

    except Exception as e:
        logger.error(f"Error during login: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Logs out the current user and clears the session.

    This endpoint is intentionally idempotent: calling it when the session is
    already expired/logged out should still return 200 so clients can safely
    clear local state without getting stuck in 401 loops.
    """
    try:
        user_id = current_user.client_id if current_user.is_authenticated else None

        if current_user.is_authenticated:
            logout_user()

        # Remove application-specific session data while preserving
        # Flask-Login's internal markers (e.g. _remember) so the
        # framework can properly clear persistent cookies.
        for key in list(session.keys()):
            if not key.startswith('_'):
                session.pop(key, None)

        session.modified = True
        if user_id:
            logger.info(f"User {user_id} logged out.")
        return jsonify({"success": True, "message": "You have been successfully logged out."}), 200
    except Exception as e:
        logger.error(f"Error during logout: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred during logout."}), 500

@auth_bp.route('/check-auth', methods=['GET'])
def check_auth():
    """Verify whether the client's session is still valid.

    This endpoint intentionally returns 200 even when the user is not
    authenticated to avoid noisy 401 console/network errors during normal
    logged-out states.

    Returning the profile here allows the front-end to skip a follow-up
    `/profile` request on page load, saving a network round trip.
    """
    if not current_user.is_authenticated:
        return jsonify({"isAuthenticated": False, "user": None, "profile": None}), 200

    # import here to avoid any potential circular import during module load
    from app.routes.profile import _serialize_profile

    return jsonify({
        "isAuthenticated": True,
        "user": {
            "client_id": current_user.client_id,
            "username": current_user.username,
        },
        "profile": _serialize_profile(current_user),
    }), 200

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """
    Initiates password reset process by generating a secure token.
    In production, this would send an email. For now, it returns the token.
    """
    try:
        data = request.get_json()
        if not data or not data.get('email'):
            return jsonify({"success": False, "message": "Email is required."}), 400
        
        email = data.get('email').strip().lower()
        user = User.objects(email=email).first()
        
        if not user:
            # Don't reveal if email exists - security best practice
            return jsonify({
                "success": True,
                "message": "If this email exists, a reset link has been sent."
            }), 200
        
        # Generate secure reset token and store only its hash
        reset_token = secrets.token_urlsafe(32)
        token_hash = _hash_reset_token(reset_token)
        user.reset_token = token_hash
        user.reset_token_expiry = datetime.utcnow() + timedelta(hours=1)
        user.save()
        
        # Audit: password reset requested (do not include token in logs)
        logger.info(f"Password reset requested for user: {user.client_id} from IP: {request.remote_addr}")
        
        # Note: We intentionally do NOT return the reset token in API responses.
        return jsonify({
            "success": True,
            "message": "If this email exists, a reset link has been sent."
        }), 200
        
    except Exception as e:
        logger.error(f"Error during password reset request: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """
    Resets user password using a valid reset token.
    """
    try:
        data = request.get_json()
        if not data or not all([data.get('token'), data.get('password')]):
            return jsonify({"success": False, "message": "Token and new password are required."}), 400
        
        token = data.get('token')
        new_password = data.get('password')
        
        # Validate password strength
        if len(new_password) < PASSWORD_MIN_LENGTH:
            return jsonify({
                "success": False,
                "message": f"Password must be at least {PASSWORD_MIN_LENGTH} characters."
            }), 400
        
        # Find user with valid hashed token
        token_hash = _hash_reset_token(token)
        user = User.objects(
            reset_token=token_hash,
            reset_token_expiry__gte=datetime.utcnow()
        ).first()
        
        if not user:
            logger.warning(f"Failed password reset attempt with invalid/expired token from IP: {request.remote_addr}")
            logger.info(f'AUDIT: password_reset_failed ip={request.remote_addr}')
            return jsonify({
                "success": False,
                "message": "Invalid or expired reset token."
            }), 400
        
        # Update password and clear reset token
        user.password = bcrypt.generate_password_hash(new_password).decode('utf-8')
        user.reset_token = None
        user.reset_token_expiry = None
        user.save()
        
        logger.info(f"Password reset successful for user: {user.client_id}")
        logger.info(f'AUDIT: password_reset_success client_id={user.client_id} ip={request.remote_addr}')
        return jsonify({
            "success": True,
            "message": "Password reset successful. Please log in with your new password."
        }), 200
        
    except Exception as e:
        logger.error(f"Error during password reset: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
