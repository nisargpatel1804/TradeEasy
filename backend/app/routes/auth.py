from flask import Blueprint, request, jsonify, session
from flask_login import login_user, logout_user, login_required, current_user
from mongoengine.queryset.visitor import Q
from app.models import User
from app import bcrypt  # Import bcrypt from the main __init__.py
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask Blueprint
bp = Blueprint('auth', __name__)

@bp.route('/signup', methods=['POST'])
def signup():
    """Handle new user registration with secure password hashing."""
    try:
        data = request.json
        email = data.get('email')
        mobile = data.get('mobile')
        password = data.get('password')
        confirm_password = data.get('confirm_password')

        # --- Input Validation ---
        if not all([email, mobile, password, confirm_password]):
            return jsonify({"error": "All fields are required"}), 400
        if password != confirm_password:
            return jsonify({"error": "Passwords do not match"}), 400

        # --- Check for Existing User ---
        if User.objects(Q(email=email) | Q(mobile=mobile)).first():
            return jsonify({"error": "An account with this email or mobile number already exists"}), 409

        # --- Secure Password Hashing ---
        # Generate a hash of the user's password using bcrypt.
        # This is a one-way process; the original password cannot be recovered.
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

        # --- Create and Save New User ---
        new_user = User(
            email=email,
            mobile=mobile,
            password=hashed_password,
            username=email  # Default username to email
        )
        new_user.save()

        logger.info(f"New user account created successfully. Client ID: {new_user.client_id}")
        return jsonify({
            "message": "Account created successfully. Please log in.",
            "client_id": new_user.client_id
        }), 201

    except Exception as e:
        logger.error(f"An unexpected error occurred during signup: {e}")
        return jsonify({"error": "Internal server error during signup"}), 500

@bp.route('/login', methods=['POST'])
def login():
    """Handle user login by verifying credentials against the stored hash."""
    try:
        data = request.json
        client_id = data.get('client_id')
        password = data.get('password')

        if not client_id or not password:
            return jsonify({"error": "Client ID and password are required"}), 400

        # --- Find User and Verify Password ---
        user = User.objects(client_id=client_id).first()

        # Use bcrypt's check_password_hash to securely compare the provided password
        # with the stored hash. This prevents timing attacks.
        if not user or not bcrypt.check_password_hash(user.password, password):
            logger.warning(f"Failed login attempt for Client ID: {client_id}")
            return jsonify({"error": "Invalid client ID or password"}), 401

        # --- Log In User and Create Session ---
        login_user(user)
        session['user_id'] = str(user.id) # Ensure user_id is stored in session
        logger.info(f"User '{user.client_id}' logged in successfully.")
        return jsonify({
            "message": "Logged in successfully",
            "client_id": user.client_id,
            "username": user.username
        }), 200

    except Exception as e:
        logger.error(f"An unexpected error occurred during login: {e}")
        return jsonify({"error": "Internal server error during login"}), 500

@bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """Handle user logout and clear the session."""
    try:
        user_client_id = current_user.client_id
        logout_user()  # Clears user from Flask-Login session
        session.clear()  # Ensures all session data is removed
        logger.info(f"User '{user_client_id}' logged out successfully.")
        return jsonify({"message": "You have been logged out successfully"}), 200
    except Exception as e:
        logger.error(f"An unexpected error occurred during logout: {e}")
        return jsonify({"error": "Internal server error during logout"}), 500

@bp.route('/check-auth', methods=['GET'])
@login_required
def check_auth():
    """An endpoint to verify if the current user's session is active."""
    return jsonify({
        "isAuthenticated": True,
        "client_id": current_user.client_id,
        "username": current_user.username
    }), 200
