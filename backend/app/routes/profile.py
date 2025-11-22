import logging
import re
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine.errors import NotUniqueError
from app.models import User

# --- Configuration ---
logger = logging.getLogger(__name__)
profile_bp = Blueprint('profile', __name__)

# --- Constants for Validation ---
USERNAME_REGEX = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
MOBILE_REGEX = re.compile(r"^\+91[6-9]\d{9}$")

# --- API Routes ---

@profile_bp.route('/profile', methods=['GET'])
@login_required
def get_profile():
    """
    Fetches and returns the profile information for the currently authenticated user.
    The @login_required decorator ensures that only logged-in users can access this.
    """
    try:
        # The `current_user` proxy is the secure way to access the logged-in user's data
        user_data = {
            "client_id": current_user.client_id,
            "username": current_user.username,
            "email": current_user.email,
            "mobile": current_user.mobile,
            "balance": float(current_user.balance),
            "reserved_balance": float(current_user.reserved_balance),
            "available_balance": float(current_user.balance - current_user.reserved_balance),
            "member_since": current_user.created_at.strftime("%B %Y")
        }
        return jsonify({"success": True, "profile": user_data}), 200

    except Exception as e:
        logger.error(f"Error fetching profile for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500

@profile_bp.route('/profile', methods=['PUT'])
@login_required
def update_profile():
    """
    Updates the profile information for the currently authenticated user.
    Performs validation on all incoming data before applying changes.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "Invalid request body."}), 400

        user = User.objects.get(id=current_user.id)
        updated_fields = []

        # --- Validate and Update Username ---
        if 'username' in data:
            username = str(data['username']).strip()
            if not USERNAME_REGEX.match(username):
                return jsonify({"success": False, "message": "Username must be 3-20 characters and can only contain letters, numbers, and underscores."}), 400
            user.username = username
            updated_fields.append('username')

        # --- Validate and Update Email ---
        if 'email' in data:
            email = str(data['email']).strip().lower()
            if not EMAIL_REGEX.match(email):
                return jsonify({"success": False, "message": "Please provide a valid email address."}), 400
            user.email = email
            updated_fields.append('email')

        # --- Validate and Update Mobile ---
        if 'mobile' in data:
            mobile = str(data['mobile']).strip()
            if not MOBILE_REGEX.match(mobile):
                return jsonify({"success": False, "message": "Mobile number must be in +91XXXXXXXXXX format."}), 400
            user.mobile = mobile
            updated_fields.append('mobile')

        if not updated_fields:
            return jsonify({"success": False, "message": "No valid fields provided for update."}), 400

        user.save()
        logger.info(f"User {user.client_id} updated their profile. Fields: {', '.join(updated_fields)}")

        return jsonify({
            "success": True,
            "message": "Profile updated successfully.",
            "updated_fields": updated_fields
        }), 200

    except NotUniqueError:
        logger.warning(f"Profile update failed for user {current_user.client_id} due to duplicate email/mobile.")
        return jsonify({"success": False, "message": "The email or mobile number you entered is already in use by another account."}), 409
    except Exception as e:
        logger.error(f"Error updating profile for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500
