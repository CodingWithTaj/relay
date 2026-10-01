"""The HTTP API, the live event stream, and the built frontend."""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import logging
from html import escape
from datetime import timedelta
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from . import __version__
from .checker import is_private_host
from .clock import SystemClock
from .config import Settings
from .db import Check, Incident, Monitor, make_engine, make_sessionmaker
from .engine import duration_text, open_incident
from .events import EventBus
from .scheduler import Scheduler
from .stats import daily_bars, latency_series, latency_summary, uptime

log = logging.getLogger("relay")


class MonitorIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(max_length=2000)
    method: Literal["GET", "HEAD", "POST"] = "GET"
    interval_s: int = Field(60, ge=10, le=86400)
    timeout_s: float = Field(10, ge=1, le=60)
    expected_status: int | None = Field(None, ge=100, le=599)
    keyword: str | None = Field(None, max_length=200)
    public: bool = True

    @field_validator("name", "url", "keyword", mode="before")
    @classmethod
    def strip(cls, v):  # before the length checks, so "   " counts as empty
        return v.strip() if isinstance(v, str) else v

    @field_validator("url")
    @classmethod
    def http_url(cls, v: str) -> str:
        parts = urlsplit(v)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("enter a full http:// or https:// address")
        return v


class MonitorPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)

    @field_validator("name", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    paused: bool | None = None
    public: bool | None = None
    interval_s: int | None = Field(None, ge=10, le=86400)


def create_app(settings: Settings | None = None, clock=None, client: httpx.AsyncClient | None = None,
               static_dir: str | Path | None = None) -> FastAPI:
    settings = settings or Settings()
    clock = clock or SystemClock()
    engine = make_engine(settings.database_url)
    sessions = make_sessionmaker(engine)
    bus = EventBus()
    # no connection reuse: every check opens a fresh connection, as a visitor's
    # browser would, so the connect and TLS stages are measured every time
    http = client or httpx.AsyncClient(headers={"User-Agent": f"Relay/{__version__} uptime monitor"},
                                       limits=httpx.Limits(max_keepalive_connections=0))
    scheduler = Scheduler(sessions, settings, clock, http, bus)

    if settings.seed_demo_url:
        with sessions() as s:
            if s.scalar(select(func.count(Monitor.id))) == 0:
                now, base = clock.now(), settings.seed_demo_url.rstrip("/")
                for name, path, interval in [("Healthy page", "/healthy", 30), ("Slow page", "/slow", 30),
                                             ("Flaky page", "/flaky", 20), ("Scheduled outage", "/scheduled-outage", 30)]:
                    s.add(Monitor(name=name, url=base + path, interval_s=interval, timeout_s=1 if path == "/slow" else 10,
                                  next_check_at=now, created_at=now))
                s.commit()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.admin_token_generated:
            log.warning("ADMIN_TOKEN not set; generated one for this run: %s", settings.admin_token)
        task = asyncio.create_task(scheduler.run_forever()) if settings.run_scheduler else None
        yield
        if task:
            task.cancel()
        if client is None:
            await http.aclose()

    app = FastAPI(title="Relay", version=__version__, lifespan=lifespan)
    app.state.scheduler = scheduler
    app.state.sessions = sessions
    app.state.bus = bus

    def db():
        with sessions() as s:
            yield s

    def is_admin(authorization: str | None = Header(None)) -> bool:
        token = (authorization or "").removeprefix("Bearer ").strip()
        return bool(token) and hmac.compare_digest(token, settings.admin_token)

    def require_admin(admin: bool = Depends(is_admin)) -> None:
        if not admin:
            raise HTTPException(401, "This needs the admin token.")

    def get_monitor(s, monitor_id: int, admin: bool) -> Monitor:
        m = s.get(Monitor, monitor_id)
        if m is None or (not m.public and not admin):
            raise HTTPException(404, "No monitor with that id.")
        return m

    def summary(s, m: Monitor, now) -> dict:
        recent = list(s.execute(select(Check.ok, Check.latency_ms).where(Check.monitor_id == m.id)
                                .order_by(Check.at.desc()).limit(30)))[::-1]
        return {
            "id": m.id, "name": m.name, "url": m.url, "method": m.method, "interval_s": m.interval_s,
            "timeout_s": m.timeout_s, "expected_status": m.expected_status, "keyword": m.keyword,
            "paused": m.paused, "public": m.public, "status": "paused" if m.paused else m.status,
            "last_checked_at": iso(m.last_checked_at),
            "uptime_24h": uptime(s, m.id, now - timedelta(hours=24)),
            "uptime_30d": uptime(s, m.id, now - timedelta(days=30)),
            "latency_p50": latency_summary(s, m.id, now - timedelta(hours=24))["p50"],
            "recent": [{"ok": ok, "ms": lat} for ok, lat in recent],
            "place": {"name": m.place, "lat": m.lat, "lon": m.lon} if m.lat is not None else None,
            "cert": None if not m.url.startswith("https://") or m.cert_checked_at is None else {
                "expires_at": iso(m.cert_expires_at), "error": m.cert_error,
                "days_left": None if m.cert_expires_at is None else round((m.cert_expires_at - now).total_seconds() / 86400, 1)},
            "last_timings": last_timings(s, m.id),
        }

    def incident_json(i: Incident, name: str, now) -> dict:
        end = i.resolved_at or now
        return {"id": i.id, "monitor_id": i.monitor_id, "monitor_name": name, "started_at": iso(i.started_at),
                "detected_at": iso(i.detected_at), "resolved_at": iso(i.resolved_at), "cause": i.cause,
                "duration": duration_text(end - i.started_at), "ongoing": i.resolved_at is None}

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    @app.get("/api/monitors")
    def list_monitors(s=Depends(db), admin: bool = Depends(is_admin)):
        now = clock.now()
        q = select(Monitor).order_by(Monitor.id)
        if not admin:
            q = q.where(Monitor.public.is_(True))
        return [summary(s, m, now) for m in s.scalars(q)]

    @app.post("/api/monitors", status_code=201, dependencies=[Depends(require_admin)])
    def create_monitor(body: MonitorIn, s=Depends(db)):
        host = urlsplit(body.url).hostname or ""
        if not settings.allow_private_targets and is_private_host(host):
            raise HTTPException(422, "That address is private or internal, so it can't be monitored from here.")
        now = clock.now()
        m = Monitor(**body.model_dump(), next_check_at=now, created_at=now)
        s.add(m)
        s.commit()
        bus.publish({"type": "monitor_changed", "monitor_id": m.id})
        return summary(s, m, now)

    @app.get("/api/monitors/{monitor_id}")
    def monitor_detail(monitor_id: int, s=Depends(db), admin: bool = Depends(is_admin)):
        now = clock.now()
        m = get_monitor(s, monitor_id, admin)
        checks = s.scalars(select(Check).where(Check.monitor_id == m.id).order_by(Check.at.desc()).limit(25))
        incidents = s.scalars(select(Incident).where(Incident.monitor_id == m.id).order_by(Incident.started_at.desc()).limit(20))
        return {
            **summary(s, m, now),
            "uptime_7d": uptime(s, m.id, now - timedelta(days=7)),
            "latency_24h": latency_summary(s, m.id, now - timedelta(hours=24)),
            "series_24h": latency_series(s, m.id, now - timedelta(hours=24), 48, now),
            "days": daily_bars(s, m.id, 90, now.date()),
            "incidents": [incident_json(i, m.name, now) for i in incidents],
            "checks": [{"at": iso(c.at), "ok": c.ok, "status_code": c.status_code, "ms": c.latency_ms, "error": c.error,
                        "timings": json.loads(c.timings) if c.timings else None} for c in checks],
            "anatomy_24h": anatomy(s, m.id, now - timedelta(hours=24)),
        }

    @app.patch("/api/monitors/{monitor_id}", dependencies=[Depends(require_admin)])
    def update_monitor(monitor_id: int, body: MonitorPatch, s=Depends(db)):
        m = get_monitor(s, monitor_id, True)
        for k, v in body.model_dump(exclude_none=True).items():
            setattr(m, k, v)
        if body.paused is False:
            m.next_check_at = clock.now()
        s.commit()
        bus.publish({"type": "monitor_changed", "monitor_id": m.id})
        return summary(s, m, clock.now())

    @app.delete("/api/monitors/{monitor_id}", status_code=204, dependencies=[Depends(require_admin)])
    def delete_monitor(monitor_id: int, s=Depends(db)):
        m = get_monitor(s, monitor_id, True)
        s.delete(m)
        s.commit()
        bus.publish({"type": "monitor_changed", "monitor_id": monitor_id})

    @app.post("/api/monitors/{monitor_id}/check", dependencies=[Depends(require_admin)])
    async def check_now(monitor_id: int):
        with sessions() as s:
            get_monitor(s, monitor_id, True)
        events = await scheduler.run_due(only_id=monitor_id)
        return {"events": [e.json() for e in events]}

    @app.get("/api/incidents")
    def incidents(s=Depends(db), admin: bool = Depends(is_admin)):
        now = clock.now()
        q = select(Incident, Monitor.name).join(Monitor).order_by(Incident.started_at.desc()).limit(50)
        if not admin:
            q = q.where(Monitor.public.is_(True))
        return [incident_json(i, name, now) for i, name in s.execute(q)]

    @app.get("/api/origin")
    def origin():
        """Where this Relay server is, for the globe (null until it's known)."""
        return scheduler.origin

    @app.get("/api/incidents/{incident_id}")
    def incident_replay(incident_id: int, s=Depends(db), admin: bool = Depends(is_admin)):
        """Everything needed to replay an incident: the checks around it, in order."""
        now = clock.now()
        i = s.get(Incident, incident_id)
        if i is None:
            raise HTTPException(404, "No incident with that id.")
        m = get_monitor(s, i.monitor_id, admin)
        step = timedelta(seconds=m.interval_s)
        start, end = i.started_at - step * 6, (i.resolved_at or now) + step * 4
        checks = s.scalars(select(Check).where(Check.monitor_id == m.id, Check.at >= start, Check.at <= end)
                           .order_by(Check.at).limit(400))
        return {**incident_json(i, m.name, now), "monitor": {"id": m.id, "name": m.name, "url": m.url, "interval_s": m.interval_s},
                "fail_threshold": settings.fail_threshold, "recover_threshold": settings.recover_threshold,
                "alerts": bool(settings.alert_webhook_url),
                "checks": [{"at": iso(c.at), "ok": c.ok, "status_code": c.status_code, "ms": c.latency_ms, "error": c.error} for c in checks]}

    @app.get("/api/monitors/{monitor_id}/badge.svg")
    def badge(monitor_id: int, metric: Literal["uptime", "status"] = "uptime",
              window: Literal["24h", "7d", "30d", "90d"] = "30d", s=Depends(db)):
        """A README badge, like shields.io's: uptime over a window, or current status."""
        m = get_monitor(s, monitor_id, False)
        if metric == "status":
            label, value = m.name, {"up": "up", "down": "down", "pending": "pending"}[m.status] if not m.paused else "paused"
            color = {"up": "#1e9a63", "down": "#cf3a32"}.get(value, "#6b7580")
        else:
            span = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30), "90d": timedelta(days=90)}[window]
            u = uptime(s, m.id, clock.now() - span)
            label = f"uptime {window}"
            value = "no data" if u is None else f"{u:.2f}%" if u < 100 else "100%"
            color = "#6b7580" if u is None else "#1e9a63" if u >= 99.5 else "#b7791f" if u >= 95 else "#cf3a32"
        return Response(badge_svg(label, value, color), media_type="image/svg+xml",
                        headers={"Cache-Control": "max-age=60"})

    @app.get("/api/status")
    def status_page(s=Depends(db)):
        """The public status page: only monitors marked public."""
        now = clock.now()
        monitors = list(s.scalars(select(Monitor).where(Monitor.public.is_(True), Monitor.paused.is_(False)).order_by(Monitor.id)))
        rows = []
        for m in monitors:
            rows.append({"id": m.id, "name": m.name, "status": m.status,
                         "uptime_90d": uptime(s, m.id, now - timedelta(days=90)),
                         "days": daily_bars(s, m.id, 90, now.date())})
        down = [r for r in rows if r["status"] == "down"]
        overall = "operational" if not down else "major_outage" if len(down) == len(rows) else "partial_outage"
        recent = s.execute(select(Incident, Monitor.name).join(Monitor)
                           .where(Monitor.public.is_(True), Incident.started_at >= now - timedelta(days=14))
                           .order_by(Incident.started_at.desc())).all()
        return {"title": settings.public_title, "overall": overall, "monitors": rows,
                "incidents": [incident_json(i, name, now) for i, name in recent], "generated_at": iso(now)}

    @app.get("/api/events")
    async def events(request: Request):
        q = bus.subscribe()

        async def stream():
            try:
                yield ": connected\n\n"
                while not await request.is_disconnected():
                    try:
                        ev = await asyncio.wait_for(q.get(), timeout=15)
                        yield f"data: {json.dumps(ev)}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
            finally:
                bus.unsubscribe(q)

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    static = Path(static_dir or settings.static_dir or Path(__file__).resolve().parent.parent / "static")
    if static.is_dir():
        app.mount("/", StaticFiles(directory=static, html=True), name="site")
    return app


def iso(dt) -> str | None:
    return dt.isoformat() + "Z" if dt else None


STAGES = ("dns", "connect", "tls", "wait", "download")


def last_timings(s, monitor_id: int) -> dict | None:
    t = s.scalar(select(Check.timings).where(Check.monitor_id == monitor_id).order_by(Check.at.desc()).limit(1))
    return json.loads(t) if t else None


def anatomy(s, monitor_id: int, since) -> dict:
    """Average milliseconds per stage of a request, over successful checks since `since`."""
    sums = dict.fromkeys(STAGES, 0.0)
    counts = dict.fromkeys(STAGES, 0)
    n = 0
    for (t,) in s.execute(select(Check.timings).where(Check.monitor_id == monitor_id, Check.at >= since, Check.ok,
                                                      Check.timings.is_not(None))):
        n += 1
        for k, v in json.loads(t).items():
            if k in sums:
                sums[k] += v
                counts[k] += 1
    return {"samples": n, "stages": {k: round(sums[k] / counts[k], 1) if counts[k] else None for k in STAGES}}


def badge_svg(label: str, value: str, color: str) -> str:
    """A flat badge in the style of shields.io (Verdana 11px, about 6.5 px a character)."""
    lw, vw = int(len(label) * 6.5) + 12, int(len(value) * 6.5) + 12
    w = lw + vw
    label, value = escape(label), escape(value)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="20" role="img" aria-label="{label}: {value}">'
            f'<title>{label}: {value}</title><clipPath id="r"><rect width="{w}" height="20" rx="3"/></clipPath>'
            f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#33383e"/><rect x="{lw}" width="{vw}" height="20" fill="{color}"/></g>'
            f'<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">'
            f'<text x="{lw / 2}" y="14">{label}</text><text x="{lw + vw / 2}" y="14">{value}</text></g></svg>')


__all__ = ["create_app", "open_incident"]
