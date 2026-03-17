from app import create_app, socketio
import os
# Support running both as a script (python run.py) and as a package (python -m backend.run)
try:
    from backend.app.services.order_processor import start_order_processor
except ModuleNotFoundError:
    # If 'backend' isn't on sys.path (script mode), import the sibling package directly
    from app.services.order_processor import start_order_processor


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "t", "y", "yes"}


def _should_start_order_processor(app) -> bool:
    if not _env_flag("ENABLE_ORDER_PROCESSOR", default=False):
        return False

    if app.config.get("DEBUG", False):
        return True

    return _env_flag("BACKGROUND_SERVICE_OWNER", default=False)

app = create_app()

if __name__ == "__main__":
    # Background worker (Render-safe): do NOT rely on Werkzeug reloader env vars.
    # Set ENABLE_ORDER_PROCESSOR=1 on Render to turn this on.
    if _should_start_order_processor(app):
        start_order_processor(app=app)

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 5000))

    # ✅ Use explicit debug mode
    debug_mode = app.config.get("DEBUG", False)
    
    print(f"🌐 Server starting on http://{host}:{port}")
    print(f"🔧 Debug mode: {debug_mode}")
    # Run via SocketIO to ensure WebSocket transports and background thread emits work reliably
    socketio.run(
        app, 
        host=host, 
        port=port, 
        debug=debug_mode, 
        use_reloader=False,
        allow_unsafe_werkzeug=True,
        log_output=not app.config.get("SUPPRESS_SOCKET_LOGS", True)
    )
