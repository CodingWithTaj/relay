"""Check anatomy, certificates, geolocation, incident replay, badges and upgrades,
using real local HTTP and HTTPS servers where it matters."""
import asyncio
import datetime as dt
import ssl

import httpx
import pytest
import trustme
from conftest import AUTH, make
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from relay.checker import fetch_certificate, run_check
from relay.db import add_missing_columns, make_engine


async def serve(handler_delay=0.06, ssl_ctx=None):
    """A tiny real HTTP server that thinks for `handler_delay` seconds before answering."""
    async def handle(reader, writer):
        await reader.readuntil(b"\r\n\r\n")
        await asyncio.sleep(handler_delay)
        body = b"hello"
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n" + body)
        await writer.drain()
        writer.close()
    server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=ssl_ctx)
    return server, server.sockets[0].getsockname()[1]


async def test_check_anatomy_on_a_real_server():
    server, port = await serve(0.06)
    async with server, httpx.AsyncClient(limits=httpx.Limits(max_keepalive_connections=0)) as c:
        r = await run_check(c, f"http://127.0.0.1:{port}/")
    assert r.ok
    t = r.timings
    assert {"dns", "connect", "wait", "download"} <= set(t) and "tls" not in t
    assert t["wait"] >= 55            # the server's 60 ms of thinking shows up as waiting
    assert t["connect"] < 50 and sum(t.values()) <= r.latency_ms + 5


def certificate(days_left: float):
    ca = trustme.CA()
    now = dt.datetime.now(dt.timezone.utc)
    cert = ca.issue_cert("localhost", not_before=now - dt.timedelta(days=30), not_after=now + dt.timedelta(days=days_left))
    server_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    cert.configure_cert(server_ctx)
    client_ctx = ssl.create_default_context()
    ca.configure_trust(client_ctx)
    return server_ctx, client_ctx


async def test_tls_stage_and_certificate_expiry():
    server_ctx, client_ctx = certificate(days_left=10)
    server, port = await serve(0.0, server_ctx)
    async with server:
        async with httpx.AsyncClient(verify=client_ctx, limits=httpx.Limits(max_keepalive_connections=0)) as c:
            r = await run_check(c, f"https://localhost:{port}/")
        assert r.ok and r.timings["tls"] > 0
        expires, error = await fetch_certificate("localhost", port, 5, client_ctx)
    assert error is None
    days = (expires - dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)).total_seconds() / 86400
    assert 9.9 < days < 10.1


async def test_an_expired_certificate_is_reported():
    server_ctx, client_ctx = certificate(days_left=-2)
    server, port = await serve(0.0, server_ctx)
    async with server:
        expires, error = await fetch_certificate("localhost", port, 5, client_ctx)
    assert expires is None and "expired" in error


async def test_geolocation_and_origin(app_env, web):
    tc, app, clock = app_env
    a = tc.post("/api/monitors", json={"name": "Shop", "url": "https://shop.example/"}, headers=AUTH).json()["id"]
    b = tc.post("/api/monitors", json={"name": "Local", "url": "http://127.0.0.1:9/"}, headers=AUTH).json()["id"]
    assert tc.get("/api/origin").json() is None
    await app.state.scheduler.run_due()
    assert tc.get("/api/origin").json() == {"name": "Toronto, Canada", "lat": 43.65, "lon": -79.38}  # the shape the site reads
    shop = tc.get(f"/api/monitors/{a}").json()
    assert shop["place"] == {"name": "Frankfurt, Germany", "lat": 50.11, "lon": 8.68}
    assert tc.get(f"/api/monitors/{b}").json()["place"] is None   # private: never sent to the lookup service
    assert shop["cert"]["days_left"] == 40.0 and shop["cert"]["error"] is None
    assert tc.get(f"/api/monitors/{b}").json()["cert"] is None    # plain http has no certificate


async def test_incident_replay(app_env, web):
    tc, app, clock = app_env
    mid = tc.post("/api/monitors", json={"name": "API", "url": "https://shop.example/health"}, headers=AUTH).json()["id"]
    for minute in range(16):
        if minute == 8:
            web.down.add("/health")
        if minute == 12:
            web.down.discard("/health")
        await app.state.scheduler.run_due()
        clock.advance(minutes=1)
    inc = tc.get("/api/incidents").json()[0]
    replay = tc.get(f"/api/incidents/{inc['id']}").json()
    oks = [c["ok"] for c in replay["checks"]]
    assert oks == [True] * 6 + [False] * 4 + [True] * 4   # 6 checks before, the 4-minute outage, every check since
    assert replay["fail_threshold"] == 3 and replay["recover_threshold"] == 2 and replay["alerts"]
    assert tc.get("/api/incidents/999").status_code == 404


async def test_badges(app_env, web):
    tc, app, clock = app_env
    mid = tc.post("/api/monitors", json={"name": "Docs", "url": "https://docs.example/"}, headers=AUTH).json()["id"]
    hidden = tc.post("/api/monitors", json={"name": "Secret", "url": "https://x.example/", "public": False}, headers=AUTH).json()["id"]
    for i in range(4):
        if i == 3:
            web.down.add("/")
        await app.state.scheduler.run_due()
        clock.advance(minutes=1)
    r = tc.get(f"/api/monitors/{mid}/badge.svg")
    assert r.headers["content-type"] == "image/svg+xml" and "uptime 30d" in r.text and "75.00%" in r.text and "#cf3a32" in r.text
    assert ">up<" in tc.get(f"/api/monitors/{mid}/badge.svg?metric=status").text
    assert tc.get(f"/api/monitors/{hidden}/badge.svg").status_code == 404


def test_old_databases_are_upgraded(tmp_path):
    url = f"sqlite:///{tmp_path}/old.db"
    old = create_engine(url)
    with old.begin() as c:  # the 1.0 schema, with one monitor in it
        c.execute(text("CREATE TABLE monitors (id INTEGER PRIMARY KEY, name VARCHAR(120), url VARCHAR(2000), method VARCHAR(8), "
                       "interval_s INTEGER, timeout_s FLOAT, expected_status INTEGER, keyword VARCHAR(200), paused BOOLEAN, public BOOLEAN, "
                       "status VARCHAR(10), consecutive_failures INTEGER, consecutive_successes INTEGER, failing_since DATETIME, "
                       "last_checked_at DATETIME, next_check_at DATETIME, created_at DATETIME)"))
        c.execute(text("CREATE TABLE checks (id INTEGER PRIMARY KEY, monitor_id INTEGER, at DATETIME, ok BOOLEAN, "
                       "status_code INTEGER, latency_ms FLOAT, error TEXT)"))
        c.execute(text("INSERT INTO monitors (id, name, url, method, interval_s, timeout_s, paused, public, status, consecutive_failures, "
                       "consecutive_successes, next_check_at, created_at) VALUES (1, 'Kept', 'https://k.example', 'GET', 60, 10, 0, 1, "
                       "'up', 0, 0, '2026-01-01', '2026-01-01')"))
    engine = make_engine(url)
    assert add_missing_columns(engine) == []  # already done by make_engine; running again is harmless
    with engine.connect() as c:
        assert c.execute(text("SELECT name, lat, cert_error FROM monitors")).one() == ("Kept", None, None)
        c.execute(text("SELECT timings FROM checks")).all()


async def test_an_empty_install_still_finds_itself(tmp_path, web):
    app, _ = make(tmp_path, web)
    with TestClient(app) as tc:
        assert await app.state.scheduler.run_due() == []  # nothing to check yet
        assert tc.get("/api/origin").json()["name"] == "Toronto, Canada"
