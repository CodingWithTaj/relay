"""Entry point: `python -m relay` or `uvicorn relay.main:app`."""
import logging
import os

import uvicorn

from .api import create_app

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()

if __name__ == "__main__":
    uvicorn.run("relay.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), proxy_headers=True)
