"""Performing one HTTP check."""
from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx


@dataclass
class CheckResult:
    ok: bool
    status_code: int | None
    latency_ms: float | None
    error: str | None
    # milliseconds spent in each stage of the request (absent when unknown)
    timings: dict[str, float] = field(default_factory=dict)


class StageTimer:
    """Collects httpcore's trace events to time each stage of a request,
    like a browser's network waterfall. On redirects, the last hop counts."""

    PAIRS = {
        "connection.connect_tcp": "connect",
        "connection.start_tls": "tls",
        "http11.receive_response_body": "download",
    }

    def __init__(self) -> None:
        self.started: dict[str, float] = {}
        self.stages: dict[str, float] = {}
        self.sent_at: float | None = None

    async def __call__(self, name: str, info: dict) -> None:
        now = time.perf_counter()
        base, _, phase = name.rpartition(".")
        if phase == "started":
            self.started[base] = now
        elif phase == "complete":
            if base in self.PAIRS and base in self.started:
                self.stages[self.PAIRS[base]] = (now - self.started[base]) * 1000
            if base == "http11.send_request_body":
                self.sent_at = now
            if base == "http11.receive_response_headers" and self.sent_at is not None:
                # time to first byte: the server thinking, plus one round trip
                self.stages["wait"] = (now - self.sent_at) * 1000


def is_private_host(host: str) -> bool:
    """True if `host` is, or resolves to, a private, loopback, link-local or otherwise
    internal address. Monitoring those from a hosted service would let anyone probe
    its internal network or the cloud metadata endpoint (an SSRF attack)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False  # doesn't resolve; the check itself will report that
    for info in infos:
        addr = ipaddress.ip_address(info[4][0].split("%")[0])
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast or addr.is_unspecified:
            return True
    return False


async def run_check(client: httpx.AsyncClient, url: str, method: str = "GET", timeout_s: float = 10.0,
                    expected_status: int | None = None, keyword: str | None = None,
                    allow_private: bool = True) -> CheckResult:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not allow_private and is_private_host(host):
        return CheckResult(False, None, None, "blocked: the address is private or internal")
    timings: dict[str, float] = {}
    try:
        # time the DNS lookup on its own; the connection reuses the OS's cached answer
        t0 = time.perf_counter()
        await asyncio.wait_for(asyncio.get_running_loop().getaddrinfo(host, parts.port or (443 if parts.scheme == "https" else 80)), timeout_s)
        timings["dns"] = (time.perf_counter() - t0) * 1000
    except (socket.gaierror, asyncio.TimeoutError, OSError):
        pass  # the request itself will report the failure properly
    timer = StageTimer()
    start = time.perf_counter()
    try:
        resp = await client.request(method, url, timeout=timeout_s, follow_redirects=True, extensions={"trace": timer})
        latency = (time.perf_counter() - start) * 1000
        timings.update(timer.stages)
        timings = {k: round(v, 1) for k, v in timings.items()}
    except httpx.TimeoutException:
        return CheckResult(False, None, None, f"timed out after {timeout_s:g} s")
    except httpx.ConnectError as e:
        return CheckResult(False, None, None, f"connection failed: {_short(e)}")
    except httpx.HTTPError as e:
        return CheckResult(False, None, None, f"request failed: {_short(e)}")
    code = resp.status_code
    if expected_status is not None:
        if code != expected_status:
            return CheckResult(False, code, latency, f"HTTP {code}, expected {expected_status}", timings)
    elif not 200 <= code < 400:
        return CheckResult(False, code, latency, f"HTTP {code}", timings)
    if keyword and keyword not in resp.text:
        return CheckResult(False, code, latency, f'"{keyword}" not found in the response', timings)
    return CheckResult(True, code, latency, None, timings)


async def fetch_certificate(host: str, port: int = 443, timeout_s: float = 10,
                            context: ssl.SSLContext | None = None) -> tuple[datetime | None, str | None]:
    """When the site's TLS certificate expires, or why it can't be trusted."""
    ctx = context or ssl.create_default_context()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port, ssl=ctx, server_hostname=host), timeout_s)
    except ssl.SSLCertVerificationError as e:
        return None, (e.verify_message or "the certificate isn't trusted")
    except (OSError, asyncio.TimeoutError, ssl.SSLError) as e:
        return None, f"couldn't read the certificate: {_short(e) if str(e) else 'timed out'}"
    try:
        cert = writer.get_extra_info("peercert") or {}
        expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert["notAfter"]), timezone.utc).replace(tzinfo=None)
        return expires, None
    except (KeyError, ValueError):
        return None, "the certificate has no expiry date"
    finally:
        writer.close()


async def geolocate(client: httpx.AsyncClient, geo_url: str, host: str = "") -> dict | None:
    """Approximate location of a server (or, with no host, of this one).
    Returns {"lat", "lon", "place"}, or None for private addresses or on failure."""
    try:
        if host and ipaddress.ip_address(host).is_private:
            return None
    except ValueError:
        pass  # a name, not an address: the lookup service resolves it
    if host and is_private_host(host):
        return None
    try:
        r = await client.get(f"{geo_url.rstrip('/')}/{host}", params={"fields": "status,lat,lon,city,country"}, timeout=8)
        d = r.json()
    except (httpx.HTTPError, ValueError):
        return None
    if d.get("status") != "success":
        return None
    place = ", ".join(x for x in (d.get("city"), d.get("country")) if x)
    return {"lat": float(d["lat"]), "lon": float(d["lon"]), "place": place or None}


def _short(e: Exception) -> str:
    text = str(e) or e.__class__.__name__
    return text if len(text) < 160 else text[:157] + "…"
