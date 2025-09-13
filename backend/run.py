from app import create_app
import os
from backend.app.tasks.order_processor import start_order_processor

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

    app.run(host=host, port=port, debug=debug_mode, use_reloader=False)
