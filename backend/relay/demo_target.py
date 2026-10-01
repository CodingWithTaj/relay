"""A deliberately unreliable website, so a fresh install has interesting things to monitor.

    uvicorn relay.demo_target:app --port 8001
"""
import asyncio
import random
import time

from fastapi import FastAPI, Response

app = FastAPI(title="Relay demo target")


@app.get("/healthy")
async def healthy():
    return {"ok": True}


@app.get("/slow")
async def slow():
    await asyncio.sleep(random.uniform(0.2, 1.2))
    return {"ok": True}


@app.get("/flaky")
async def flaky(response: Response):
    # fails about one request in five: mostly blips, occasionally a real outage
    if random.random() < 0.2:
        response.status_code = 503
        return {"ok": False}
    return {"ok": True}


@app.get("/scheduled-outage")
async def scheduled_outage(response: Response):
    # down for the first 3 minutes of every 15
    if (time.time() // 60) % 15 < 3:
        response.status_code = 500
        return {"ok": False, "reason": "scheduled outage"}
    return {"ok": True}
