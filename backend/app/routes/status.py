from flask import Blueprint, jsonify
from app.utils.status_utils import is_api_blocked

# Blueprint for status routes with API prefix
status_bp = Blueprint("status", __name__, url_prefix="/api")

@status_bp.route("/status", methods=["GET"])
def api_status():
    """
    Endpoint to check if the API is blocked.
    Returns:
        JSON: {"api_blocked": bool, "status": "OK"}
    """
    try:
        return jsonify({
            "status": "OK",
            "api_blocked": is_api_blocked()
        }), 200
    except Exception as e:
        return jsonify({"error": "Failed to fetch API status", "details": str(e)}), 500
