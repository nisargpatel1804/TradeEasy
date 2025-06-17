from flask import Blueprint, request, jsonify, session, redirect, url_for
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from app.models import User, db
from app.utils.aes_encryption import AES_Encryption
import logging
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask Blueprint and LoginManager
bp = Blueprint('auth', __name__)
login_manager = LoginManager()
login_manager.login_view = 'auth.login'  # Specify the login view

# AES Encryption Instance
aes_encryption = AES_Encryption()

@login_manager.user_loader
def load_user(user_id):
    """Load user by ID for session management."""
    try:
        return User.query.get(int(user_id))
    except (ValueError, TypeError) as e:
        logger.error(f"Error loading user: {e}")
        return None

@bp.route('/signup', methods=['POST'])
def signup():
    """Handle user signup."""
    try:
        data = request.json
        email = data.get('email')
        mobile = data.get('mobile')
        password = data.get('password')
        confirm_password = data.get('confirm_password')

        # Validate input
        if not all([email, mobile, password, confirm_password]):
            return jsonify({"error": "All fields are required"}), 400
        if password != confirm_password:
            return jsonify({"error": "Passwords do not match"}), 400

        # Check if user already exists
        existing_user = User.query.filter((User.email == email) | (User.mobile == mobile)).first()
        if existing_user:
            return jsonify({"error": "Email or mobile already in use"}), 400

        # Encrypt password
        encrypted_password = aes_encryption.aes_encrypt(password)
        if not encrypted_password:
            return jsonify({"error": "Encryption failed"}), 500

        # Create new user
        new_user = User(email=email, mobile=mobile, password=encrypted_password, username=email)
        db.session.add(new_user)
        db.session.commit()

        logger.info(f"New user created: {new_user.client_id}")
        return jsonify({
            "message": "Account created successfully",
            "client_id": new_user.client_id
        }), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f"Signup Error: {e}")
        return jsonify({"error": "Internal server error"}), 500

@bp.route('/login', methods=['POST'])
def login():
    """Handle user login."""
    try:
        data = request.json
        client_id = data.get('client_id')
        password = data.get('password')

        # Validate input
        if not client_id or not password:
            return jsonify({"error": "Client ID and password are required"}), 400

        # Find user by client_id
        user = User.query.filter_by(client_id=client_id).first()
        if not user:
            logger.warning(f"Failed login attempt for Client ID: {client_id}")
            return jsonify({"error": "Invalid client ID or password"}), 401

        # Decrypt and verify password
        decrypted_password = aes_encryption.aes_decrypt(user.password)
        if not decrypted_password or decrypted_password != password:
            logger.warning(f"Incorrect password for Client ID: {client_id}")
            return jsonify({"error": "Invalid client ID or password"}), 401

        # Log in user with Flask-Login
        login_user(user)
        session['user_id'] = user.id
        logger.info(f"User logged in: {user.client_id}")
        return jsonify({
            "message": "Logged in successfully",
            "client_id": user.client_id
        }), 200

    except Exception as e:
        logger.error(f"Login Error: {e}")
        return jsonify({"error": "Internal server error"}), 500

@bp.route('/dashboard')
def dashboard():
    """Redirect to dashboard if authenticated."""
    if current_user.is_authenticated:
        return redirect(url_for('main.dashboard'))  # Redirect to /dashboard
    else:
        return redirect(url_for('auth.login'))  # Redirect to /login if not authenticated

@bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """Handle user logout."""
    try:
        logout_user()  # Flask-Login logout
        session.clear()  # Clear any remaining session data
        logger.info(f"User logged out: {current_user.client_id}")
        return jsonify({"message": "Logged out successfully"}), 200
    except Exception as e:
        logger.error(f"Logout Error: {e}")
        return jsonify({"error": "Internal server error"}), 500

@bp.route('/check-auth', methods=['GET'])
@login_required
def check_auth():
    """Check if user is authenticated."""
    try:
        return jsonify({
            "message": "Authenticated",
            "client_id": current_user.client_id
        }), 200
    except Exception as e:
        logger.error(f"Check Auth Error: {e}")
        return jsonify({"error": "Authentication failed"}), 401

def init_app(app):
    """Initialize the auth blueprint with the Flask app."""
    login_manager.init_app(app)
    app.register_blueprint(bp, url_prefix='/api')  # Specify the URL prefix