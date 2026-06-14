import logging
import re
import time
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from mongoengine.errors import NotUniqueError
from app.models import User, Holding, Transaction, Lot, ShortPosition
from app.services.cache import cache as app_cache
from app.services.reset_guard import acquire_reset_lock

# --- Configuration ---
logger = logging.getLogger(__name__)
profile_bp = Blueprint('profile', __name__)

# --- Constants for Validation ---
USERNAME_REGEX = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")
MOBILE_REGEX = re.compile(r"^\+91\d{10}$")
WALLET_LIMITS = (1_000_000, 2_500_000, 5_000_000, 10_000_000)
WALLET_LABELS = {
    1_000_000: "₹10 Lakh",
    2_500_000: "₹25 Lakh",
    5_000_000: "₹50 Lakh",
    10_000_000: "₹1 Crore",
}


def _invalidate_user_route_caches(user_id):
    patterns = [
        f"route:get_profile:user:{user_id}",
        f"route:get_portfolio:user:{user_id}",
        f"route:get_orders:user:{user_id}",
        f"route:get_watchlists:user:{user_id}",
    ]
    for pattern in patterns:
        app_cache.invalidate_pattern(pattern)


def _take_user_reset_snapshot(user):
    return {
        "user": User.objects(id=user.id).as_pymongo().first(),
        "holdings": list(Holding.objects(user=user).as_pymongo()),
        "lots": list(Lot.objects(user=user).as_pymongo()),
        "short_positions": list(ShortPosition.objects(user=user).as_pymongo()),
        "transactions": list(Transaction.objects(user=user).as_pymongo()),
    }


def _restore_user_reset_snapshot(user_id, snapshot):
    user_doc = snapshot.get("user")
    if user_doc:
        User._get_collection().replace_one({"_id": user_doc["_id"]}, user_doc, upsert=True)

    for model, key in (
        (Holding, "holdings"),
        (Lot, "lots"),
        (ShortPosition, "short_positions"),
        (Transaction, "transactions"),
    ):
        model.objects(user=user_id).delete()
        docs = snapshot.get(key) or []
        if docs:
            model._get_collection().insert_many(docs, ordered=True)


def _serialize_profile(user: User) -> dict:
    return {
        "client_id": user.client_id,
        "username": user.username,
        "email": user.email,
        "mobile": user.mobile,
        "balance": float(user.balance),
        "reserved_balance": float(user.reserved_balance),
        "available_balance": float(user.balance - user.reserved_balance),
        "member_since": user.created_at.strftime("%B %Y")
    }

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
        return jsonify({"success": True, "profile": _serialize_profile(current_user)}), 200

    except Exception as e:
        logger.error(f"Error fetching profile for user {current_user.client_id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@profile_bp.route('/profile/wallet-limit', methods=['POST'])
@login_required
def update_wallet_limit():
    """Updates the simulated wallet balance with pre-approved limits."""
    lock_acquired = False
    snapshot = None
    user_id = None
    user_client_id = None
    try:
        data = request.get_json() or {}
        raw_amount = data.get('amount')
        if raw_amount is None:
            return jsonify({"success": False, "message": "Target amount is required."}), 400

        try:
            amount_value = float(str(raw_amount).replace(',', '').strip())
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "Provide a valid numeric amount."}), 400

        if amount_value not in WALLET_LIMITS:
            return jsonify({"success": False, "message": "Amount must be one of the supported wallet limits."}), 400

        user = User.objects.get(id=current_user.id)
        user_id = user.id
        user_client_id = user.client_id
        lock_result, stale_lock_cleared = acquire_reset_lock(user.id)
        if not lock_result:
            return jsonify({
                "success": False,
                "message": "A portfolio reset is already in progress. Please retry in a few seconds."
            }), 409

        if stale_lock_cleared:
            logger.warning("Recovered stale reset lock while processing reset for user %s", user.client_id)

        lock_acquired = True
        user.reload()
        logger.info("Reset lock acquired for user %s", user.client_id)

        # Ensure no in-flight execution mutates state during reset snapshot/delete.
        wait_deadline = time.time() + 5.0
        inflight = Transaction.objects(user=user, is_processing=True).count()
        while inflight > 0 and time.time() < wait_deadline:
            time.sleep(0.1)
            inflight = Transaction.objects(user=user, is_processing=True).count()

        if inflight > 0:
            User.objects(id=user.id).update_one(
                set__reset_in_progress=False,
                unset__reset_started_at=1
            )
            lock_acquired = False
            logger.info("Reset rejected for user %s due to in-flight transactions", user.client_id)
            return jsonify({
                "success": False,
                "message": "Orders are still being processed. Please retry reset in a few seconds."
            }), 409

        snapshot = _take_user_reset_snapshot(user)
        logger.info("Reset snapshot captured for user %s", user.client_id)

        reset_timestamp = datetime.utcnow()

        # Finalize open/in-flight orders before hard-delete so downstream readers don't
        # observe partially processed states.
        Transaction.objects(user=user, status="PENDING").update(
            set__status="CANCELLED",
            set__is_processing=False,
            set__metadata="Cancelled due to portfolio reset",
            set__execution_date=reset_timestamp
        )
        Transaction.objects(user=user, is_processing=True).update(set__is_processing=False)

        user.balance = amount_value
        user.reserved_balance = 0.0
        user.last_portfolio_reset_at = reset_timestamp
        user.realized_pnl = 0.0
        user.realized_pnl_synced_at = reset_timestamp
        user.realized_pnl_sell_count = 0

        user.save()

        # Clear data surfaces associated with portfolio state.
        Holding.objects(user=user).delete()
        Lot.objects(user=user).delete()
        ShortPosition.objects(user=user).delete()
        Transaction.objects(user=user).delete()
        logger.info("Reset data clear completed for user %s", user.client_id)

        _invalidate_user_route_caches(user.id)

        User.objects(id=user.id).update_one(
            set__reset_in_progress=False,
            unset__reset_started_at=1
        )
        lock_acquired = False
        user.reload()

        friendly_amount = WALLET_LABELS.get(int(amount_value), f"₹{int(amount_value):,}")
        logger.info("User %s reset their account with wallet limit %s", user.client_id, friendly_amount)

        profile_payload = _serialize_profile(user)
        message = f"Wallet reset to {friendly_amount}. Positions, orders, and performance were cleared. Watchlists were kept unchanged."

        return jsonify({
            "success": True,
            "message": message,
            "profile": profile_payload,
            "reset_performed": True
        }), 200
    except Exception as e:
        if snapshot and user_id:
            try:
                _restore_user_reset_snapshot(user_id, snapshot)
                _invalidate_user_route_caches(user_id)
                logger.warning("Portfolio reset rollback restored user %s state", user_client_id or "unknown")
            except Exception as rollback_err:
                logger.error("Rollback failed for user %s: %s", user_client_id or "unknown", rollback_err, exc_info=True)

        if lock_acquired and user_id:
            try:
                User.objects(id=user_id).update_one(
                    set__reset_in_progress=False,
                    unset__reset_started_at=1
                )
            except Exception:
                logger.error("Failed to release reset lock for user %s", user_client_id or "unknown", exc_info=True)

        logger.error("Error updating wallet limit for user %s: %s", user_client_id or "unknown", e, exc_info=True)
        return jsonify({
            "success": False,
            "message": "Reset failed and was rolled back. Please try again."
        }), 500

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
