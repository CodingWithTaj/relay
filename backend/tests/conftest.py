import httpx
import pytest
from fastapi.testclient import TestClient

from relay.api import create_app
from relay.clock import FakeClock
from relay.config import Settings

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


class FakeWeb:
    """Pretend websites whose behaviour each test controls."""

    def __init__(self):
        self.down: set[str] = set()       # paths answering 503
        self.timeout: set[str] = set()    # paths that time out
        self.body = "hello from the service"
        self.webhooks: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "geo.test":
            # a stand-in for ip-api.com: an empty path means "where am I?"
            where = request.url.path.rsplit("/", 1)[-1]
            spots = {"": (43.65, -79.38, "Toronto", "Canada"), "shop.example": (50.11, 8.68, "Frankfurt", "Germany"),
                     "site.example": (35.68, 139.69, "Tokyo", "Japan")}
            lat, lon, city, country = spots.get(where, (38.9, -77.0, "Ashburn", "United States"))
            return httpx.Response(200, json={"status": "success", "lat": lat, "lon": lon, "city": city, "country": country})
        if request.url.host == "hooks.example":
            self.webhooks.append(__import__("json").loads(request.content))
            return httpx.Response(204)
        path = request.url.path
        if path in self.timeout:
            raise httpx.ReadTimeout("timed out", request=request)
        if path in self.down:
            return httpx.Response(503, text="unavailable")
        return httpx.Response(200, text=self.body)


@pytest.fixture
def web():
    return FakeWeb()


def make(tmp_path, web, database_url=None, **overrides):
    options = dict(database_url=database_url or f"sqlite:///{tmp_path}/test.db", admin_token=TOKEN,
                   admin_token_generated=False, run_scheduler=False, allow_private_targets=True,
                   alert_webhook_url="https://hooks.example/relay", geo_url="http://geo.test/json")
    settings = Settings(**{**options, **overrides})
    clock = FakeClock()
    client = httpx.AsyncClient(transport=httpx.MockTransport(web.handler))
    app = create_app(settings, clock, client, static_dir=None if settings.static_dir else tmp_path / "no-static")

    async def fake_certificate(host, port, timeout, context):
        return clock.now() + __import__("datetime").timedelta(days=40), None
    app.state.scheduler.cert_fetcher = fake_certificate
    return app, clock


@pytest.fixture
def app_env(tmp_path, web):
    app, clock = make(tmp_path, web)
    with TestClient(app) as tc:
        yield tc, app, clock
