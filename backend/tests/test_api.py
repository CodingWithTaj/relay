"""The HTTP API, end to end, including a whole outage."""
from conftest import AUTH, make
from fastapi.testclient import TestClient


def create(tc, **kw):
    body = {"name": "Checkout API", "url": "https://shop.example/health", "interval_s": 60, **kw}
    return tc.post("/api/monitors", json=body, headers=AUTH)


def test_writes_need_the_admin_token(app_env):
    tc, _, _ = app_env
    assert tc.post("/api/monitors", json={"name": "x", "url": "https://x.example"}).status_code == 401
    assert tc.post("/api/monitors", json={"name": "x", "url": "https://x.example"},
                   headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert create(tc).status_code == 201


def test_validation(app_env):
    tc, _, _ = app_env
    assert create(tc, url="ftp://files.example").status_code == 422
    assert create(tc, url="not a url").status_code == 422
    assert create(tc, interval_s=1).status_code == 422
    assert create(tc, name="   ").status_code == 422


def test_private_targets_rejected_in_production_mode(tmp_path, web):
    app, _ = make(tmp_path, web, allow_private_targets=False)
    with TestClient(app) as tc:
        r = create(tc, url="http://169.254.169.254/latest/meta-data")
        assert r.status_code == 422 and "private" in r.json()["detail"]


async def test_an_outage_from_start_to_finish(app_env, web):
    tc, app, clock = app_env
    mid = create(tc).json()["id"]
    sched = app.state.scheduler
    seen = []
    bus = app.state.bus.subscribe()

    # 10 healthy minutes, a 5-minute outage, then healthy again
    for minute in range(20):
        if minute == 10:
            web.down.add("/health")
        if minute == 15:
            web.down.discard("/health")
        seen += [e.kind for e in await sched.run_due() if e.kind != "check"]
        clock.advance(minutes=1)

    assert seen == ["incident_opened", "incident_resolved"]
    detail = tc.get(f"/api/monitors/{mid}").json()
    assert detail["status"] == "up"
    assert detail["uptime_24h"] == 75.0                    # 5 of 20 checks failed
    inc = detail["incidents"][0]
    assert inc["cause"] == "HTTP 503" and not inc["ongoing"]
    assert inc["started_at"].endswith("12:10:00Z")          # dated from the first failure
    assert inc["duration"] == "6 min"                       # until the 2nd success in a row
    assert [w["content"][0] for w in web.webhooks] == ["🔴", "🟢"]  # one alert each way
    assert web.webhooks[0]["content"] == "🔴 Checkout API is down: HTTP 503" and web.webhooks[0]["text"] == web.webhooks[0]["content"]
    events = []
    while not bus.empty():
        events.append(bus.get_nowait()["type"])
    assert events.count("check") == 20 and "incident_opened" in events
    assert tc.get("/api/incidents").json()[0]["monitor_name"] == "Checkout API"


async def test_status_page_counts_only_public_unpaused_monitors(app_env, web):
    tc, app, clock = app_env
    a = create(tc, name="Website", url="https://site.example/").json()["id"]
    create(tc, name="Internal admin", url="https://admin.example/", public=False)
    web.down.add("/")  # both use "/", so both go down
    for _ in range(3):
        await app.state.scheduler.run_due()
        clock.advance(minutes=1)
    page = tc.get("/api/status").json()
    assert [m["name"] for m in page["monitors"]] == ["Website"]
    assert page["overall"] == "major_outage" and len(page["incidents"]) == 1
    assert len(page["monitors"][0]["days"]) == 90
    # private monitors are hidden from anonymous readers, visible to the admin
    assert len(tc.get("/api/monitors").json()) == 1
    assert len(tc.get("/api/monitors", headers=AUTH).json()) == 2
    # pausing removes it from the page and stops its checks
    assert tc.patch(f"/api/monitors/{a}", json={"paused": True}, headers=AUTH).json()["status"] == "paused"
    assert tc.get("/api/status").json()["monitors"] == []


async def test_check_now_and_delete(app_env, web):
    tc, app, clock = app_env
    mid = create(tc, keyword="hello").json()["id"]
    r = tc.post(f"/api/monitors/{mid}/check", headers=AUTH).json()
    assert r["events"][0]["type"] == "check"
    detail = tc.get(f"/api/monitors/{mid}").json()
    assert detail["checks"][0]["ok"] and detail["latency_p50"] is not None
    assert tc.delete(f"/api/monitors/{mid}", headers=AUTH).status_code == 204
    assert tc.get(f"/api/monitors/{mid}").status_code == 404
    assert tc.post(f"/api/monitors/{mid}/check", headers=AUTH).status_code == 404


async def test_a_monitor_deleted_mid_check_is_skipped(app_env, web):
    tc, app, clock = app_env
    mid = create(tc).json()["id"]
    sched = app.state.scheduler
    due = sched._due(clock.now())
    tc.delete(f"/api/monitors/{mid}", headers=AUTH)
    from relay.checker import CheckResult
    assert sched._record([(due[0], CheckResult(True, 200, 5.0, None))], clock.now()) == []


def test_demo_seeding_only_fills_an_empty_database(tmp_path, web):
    app, _ = make(tmp_path, web, seed_demo_url="http://demo-target:8001/")
    with TestClient(app) as tc:
        names = [m["name"] for m in tc.get("/api/monitors").json()]
        assert names == ["Healthy page", "Slow page", "Flaky page", "Scheduled outage"]
        assert tc.get("/api/monitors").json()[1]["url"] == "http://demo-target:8001/slow"
    app2, _ = make(tmp_path, web, seed_demo_url="http://demo-target:8001/")
    with TestClient(app2) as tc:
        assert len(tc.get("/api/monitors").json()) == 4  # not seeded twice


def test_serves_the_built_frontend(tmp_path, web):
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("<h1>relay</h1>")
    app, _ = make(tmp_path, web, static_dir=str(site))
    with TestClient(app) as tc:
        assert tc.get("/").text == "<h1>relay</h1>"
        assert tc.get("/api/health").json()["ok"]
