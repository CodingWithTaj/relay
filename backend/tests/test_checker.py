"""One HTTP check, against fake websites."""
import httpx

from relay.checker import is_private_host, run_check


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_success_measures_latency():
    r = await run_check(client(lambda req: httpx.Response(200, text="ok")), "https://x.example/")
    assert r.ok and r.status_code == 200 and r.latency_ms is not None and r.error is None


async def test_http_errors_and_expected_status():
    r = await run_check(client(lambda req: httpx.Response(503)), "https://x.example/")
    assert not r.ok and r.error == "HTTP 503"
    r = await run_check(client(lambda req: httpx.Response(200)), "https://x.example/", expected_status=204)
    assert not r.ok and r.error == "HTTP 200, expected 204"
    r = await run_check(client(lambda req: httpx.Response(404)), "https://x.example/", expected_status=404)
    assert r.ok


async def test_keyword_must_appear():
    c = client(lambda req: httpx.Response(200, text="all systems go"))
    assert (await run_check(c, "https://x.example/", keyword="systems go")).ok
    r = await run_check(c, "https://x.example/", keyword="database ok")
    assert not r.ok and "not found" in r.error


async def test_timeouts_and_connection_failures():
    def timeout(req):
        raise httpx.ReadTimeout("slow", request=req)

    def refused(req):
        raise httpx.ConnectError("connection refused", request=req)

    r = await run_check(client(timeout), "https://x.example/", timeout_s=5)
    assert not r.ok and r.error == "timed out after 5 s"
    r = await run_check(client(refused), "https://x.example/")
    assert not r.ok and r.error.startswith("connection failed")


async def test_redirects_are_followed():
    def handler(req):
        if req.url.path == "/old":
            return httpx.Response(301, headers={"Location": "https://x.example/new"})
        return httpx.Response(200)
    r = await run_check(client(handler), "https://x.example/old")
    assert r.ok and r.status_code == 200


async def test_private_addresses_are_blocked_when_asked():
    assert is_private_host("127.0.0.1") and is_private_host("10.0.0.5") and is_private_host("169.254.169.254")
    assert is_private_host("localhost")
    assert not is_private_host("8.8.8.8")
    r = await run_check(client(lambda req: httpx.Response(200)), "http://169.254.169.254/latest/meta-data", allow_private=False)
    assert not r.ok and r.error.startswith("blocked")
