from flask import Blueprint, request, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from mongoengine.queryset.visitor import Q
from app.models import User, Watchlist
from app import bcrypt
import logging

# Configure logging for this blueprint
logger = logging.getLogger(__name__)

bp = Blueprint('auth', __name__)


@bp.route('/signup', methods=['POST'])
def signup():
    """
    Handles new user registration.
    Validates input, checks for existing users, and securely hashes the password.
    """
    try:
        data = request.json
        email = data.get('email')
        mobile = data.get('mobile')
        password = data.get('password')
        # Standardize on snake_case for API consistency
        confirm_password = data.get('confirm_password')

        if not all([email, mobile, password, confirm_password]):
            return jsonify({"error": "All fields are required"}), 400
        if password != confirm_password:
            return jsonify({"error": "Passwords do not match"}), 400

        # Check if a user with the same email or mobile already exists
        if User.objects(Q(email=email) | Q(mobile=mobile)).first():
            return jsonify({"error": "An account with this email or mobile already exists"}), 409

        # Hash the password securely using bcrypt before storing
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

        new_user = User(
            email=email,
            mobile=mobile,
            password=hashed_password,
            username=email  # Default username to email for simplicity
        )
        
        # Create a default, non-deletable watchlist for a better user experience
        default_watchlist = Watchlist(name="Main", is_deletable=False, stocks=[])
        new_user.watchlists = [default_watchlist]
        
        new_user.save()

        logger.info(f"New user account created. Client ID: {new_user.client_id}")
        return jsonify({
            "success": True,
            "message": "Account created successfully. Please log in with your Client ID.",
            "client_id": new_user.client_id
        }), 201

    except Exception as e:
        logger.error(f"Error during signup: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500


@bp.route('/login', methods=['POST'])
def login():
    """
    Handles user login.
    Verifies credentials against the stored hash and creates a session.
    """
    try:
        data = request.json
        client_id = data.get('client_id')
        password = data.get('password')

        if not client_id or not password:
            return jsonify({"error": "Client ID and password are required"}), 400

        user = User.objects(client_id=client_id).first()

        # Securely check the provided password against the stored hash
        if not user or not bcrypt.check_password_hash(user.password, password):
            return jsonify({"error": "Invalid client ID or password"}), 401

        # Log the user in, creating a secure session
        login_user(user, remember=True)
        
        return jsonify({
            "success": True,
            "message": "Logged in successfully",
            "client_id": user.client_id,
            "username": user.username
        }), 200

    except Exception as e:
        logger.error(f"Error during login: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500


@bp.route('/logout', methods=['POST'])
def logout():
    """
    Handles user logout.
    Securely invalidates the current user's session.
    Note: This endpoint doesn't require authentication to allow logout even with expired sessions.
    """
    try:
        # Check if user is authenticated before trying to get their info
        if current_user.is_authenticated:
            user_client_id = current_user.client_id
            logout_user()  # Invalidates the Flask-Login session
            logger.info(f"User '{user_client_id}' logged out successfully.")
        else:
            logger.info("Logout called with no active session (possibly expired).")
        
        session.clear()  # Ensures any session data is removed regardless
        return jsonify({"success": True, "message": "You have been logged out"}), 200
        
    except Exception as e:
        logger.error(f"Error during logout: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500


@bp.route('/check-auth', methods=['GET'])
@login_required
def check_auth():
    """
    Verifies if the current user has an active, authenticated session.
    The @login_required decorator handles the verification. If the user is not
    authenticated, it will automatically return a 401 Unauthorized response.
    """
    logger.info(f"Auth check for user: {current_user.client_id}")
    return jsonify({
        "isAuthenticated": True,
        "client_id": current_user.client_id,
        "username": current_user.username
    }), 200