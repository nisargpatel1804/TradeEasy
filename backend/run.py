from app import create_app, socketio
import os
from app.tasks.order_processor import start_order_processor

app = create_app()

if __name__ == "__main__":
    # ✅ Prevent duplicate execution due to reloader
    if os.getenv("WERKZEUG_RUN_MAIN") == "true":
        start_order_processor()

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
