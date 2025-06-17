from flask import Blueprint, request, jsonify, session
from app.models import User, db
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask Blueprint
bp = Blueprint('profile', __name__)

@bp.route('/profile', methods=['GET'])
def get_profile():
    """Fetch the authenticated user's profile."""
    try:
        # Check if the user is authenticated
        if 'user_id' not in session:
            logger.warning("Unauthorized access attempt to /profile")
            return jsonify({"error": "Unauthorized"}), 401

        # Fetch the user from the database
        user = User.query.get(session['user_id'])
        if not user:
            logger.error(f"User not found for session user_id: {session['user_id']}")
            return jsonify({"error": "User not found"}), 404

        # Return the user's profile data
        logger.info(f"Profile fetched for user: {user.client_id}")
        return jsonify({
            "client_id": user.client_id,
            "email": user.email,
            "mobile": user.mobile,
            "balance": user.balance
        }), 200

    except Exception as e:
        logger.error(f"Error fetching profile: {e}")
        return jsonify({"error": "Internal server error"}), 500

@bp.route('/profile/update', methods=['PUT'])
def update_profile():
    """Update the authenticated user's profile."""
    try:
        # Check if the user is authenticated
        if 'user_id' not in session:
            logger.warning("Unauthorized access attempt to /profile/update")
            return jsonify({"error": "Unauthorized"}), 401

        # Fetch the user from the database
        user = User.query.get(session['user_id'])
        if not user:
            logger.error(f"User not found for session user_id: {session['user_id']}")
            return jsonify({"error": "User not found"}), 404

        # Validate and update profile data
        data = request.json
        if not data:
            logger.warning("No data provided for profile update")
            return jsonify({"error": "No data provided"}), 400

        # Update email if provided
        if 'email' in data:
            if not isinstance(data['email'], str) or "@" not in data['email']:
                logger.warning(f"Invalid email format: {data['email']}")
                return jsonify({"error": "Invalid email format"}), 400
            user.email = data['email']

        # Update mobile if provided
        if 'mobile' in data:
            if not isinstance(data['mobile'], str) or not data['mobile'].isdigit():
                logger.warning(f"Invalid mobile format: {data['mobile']}")
                return jsonify({"error": "Invalid mobile format"}), 400
            user.mobile = data['mobile']

        # Commit changes to the database
        db.session.commit()
        logger.info(f"Profile updated for user: {user.client_id}")
        return jsonify({"message": "Profile updated successfully"}), 200

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating profile: {e}")
        return jsonify({"error": "Internal server error"}), 500