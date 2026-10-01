from .main import app  # noqa: F401
import os
import uvicorn

uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
