from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from app.models import User
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bp = Blueprint('profile', __name__)

@bp.route('/profile', methods=['GET'])
@login_required
def get_profile():
    """Fetch the authenticated user's profile data securely."""
    try:
        # current_user is the secure way to access the logged-in user object
        return jsonify({
            "client_id": current_user.client_id,
            "username": current_user.username,
            "email": current_user.email,
            "mobile": current_user.mobile,
            "balance": float(current_user.balance),
            "created_at": current_user.created_at.isoformat()
        }), 200
    except Exception as e:
        logger.error(f"Error fetching profile for user {current_user.client_id}: {e}")
        return jsonify({"error": "Internal server error"}), 500

@bp.route('/profile/update', methods=['PUT'])
@login_required
def update_profile():
    """Update the authenticated user's profile information."""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided for update."}), 400

        # Update fields if they exist in the request
        if 'email' in data:
            current_user.email = data['email']
        if 'mobile' in data:
            current_user.mobile = data['mobile']
        
        # Add more updatable fields here as needed, e.g., username
        if 'username' in data:
            current_user.username = data['username']

        current_user.save()
        logger.info(f"Profile updated for user {current_user.client_id}")
        return jsonify({"message": "Profile updated successfully."}), 200

    except Exception as e:
        logger.error(f"Error updating profile for user {current_user.client_id}: {e}")
        return jsonify({"error": "Failed to update profile."}), 500
