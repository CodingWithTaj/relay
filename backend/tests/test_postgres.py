"""The same outage scenario against a real PostgreSQL (embedded via pgserver)."""
import pytest
from conftest import AUTH, make
from fastapi.testclient import TestClient

pgserver = pytest.importorskip("pgserver")


@pytest.fixture(scope="module")
def pg_url(tmp_path_factory):
    srv = pgserver.get_server(str(tmp_path_factory.mktemp("pg")), cleanup_mode="stop")
    yield srv.get_uri().replace("postgresql://", "postgresql+psycopg://")
    srv.cleanup()


async def test_outage_on_postgres(tmp_path, web, pg_url):
    app, clock = make(tmp_path, web, database_url=pg_url)
    with TestClient(app) as tc:
        mid = tc.post("/api/monitors", json={"name": "PG", "url": "https://pg.example/up"}, headers=AUTH).json()["id"]
        kinds = []
        for minute in range(12):
            if minute == 4:
                web.down.add("/up")
            if minute == 8:
                web.down.discard("/up")
            kinds += [e.kind for e in await app.state.scheduler.run_due() if e.kind != "check"]
            clock.advance(minutes=1)
        assert kinds == ["incident_opened", "incident_resolved"]
        d = tc.get(f"/api/monitors/{mid}").json()
        assert d["uptime_24h"] == round(100 * 8 / 12, 3)
        assert d["days"][-1]["level"] == "down" and d["days"][-1]["checks"] == 12
        assert tc.get("/api/status").json()["overall"] == "operational"
        tc.delete(f"/api/monitors/{mid}", headers=AUTH)
