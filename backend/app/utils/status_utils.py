import os

def is_api_blocked():
    """
    Check if the API is blocked based on the environment variable.
    
    Returns:
        bool: True if the API is blocked, False otherwise.
    """
    try:
        # Read environment variable and convert to boolean
        return os.getenv("API_BLOCKED", "false").strip().lower() == "true"
    except Exception as e:
        print(f"Error checking API block status: {e}")
        return False
