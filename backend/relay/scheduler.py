"""Runs every due check, concurrently, and records the results."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

import httpx
from sqlalchemy import delete, select

from .alerts import send_alert
from urllib.parse import urlsplit

from .checker import CheckResult, fetch_certificate, geolocate, run_check
from .config import Settings
from .db import Check, Monitor
from .engine import Event, apply_result
from .events import EventBus

log = logging.getLogger("relay.scheduler")


class Scheduler:
    def __init__(self, sessions, settings: Settings, clock, client: httpx.AsyncClient, bus: EventBus):
        self.sessions = sessions
        self.settings = settings
        self.clock = clock
        self.client = client
        self.bus = bus
        self.alerts_sent: list[Event] = []
        self._sem = asyncio.Semaphore(settings.max_concurrent_checks)
        self._last_prune = None
        self.origin: dict | None = None      # where this server is, for the globe
        self._origin_tried = None
        self.cert_fetcher = fetch_certificate  # replaceable in tests
        self.ssl_context = None

    async def _check(self, m: dict) -> CheckResult:
        async with self._sem:
            return await run_check(self.client, m["url"], m["method"], m["timeout_s"], m["expected_status"],
                                   m["keyword"], allow_private=self.settings.allow_private_targets)

    def _due(self, now, only_id: int | None = None) -> list[dict]:
        with self.sessions() as s:
            q = select(Monitor)
            q = q.where(Monitor.id == only_id) if only_id else q.where(Monitor.paused.is_(False), Monitor.next_check_at <= now)
            return [{"id": m.id, "url": m.url, "method": m.method, "timeout_s": m.timeout_s,
                     "expected_status": m.expected_status, "keyword": m.keyword} for m in s.scalars(q)]

    def _record(self, results: list[tuple[dict, CheckResult]], now) -> list[Event]:
        events: list[Event] = []
        with self.sessions() as s:
            for m, result in results:
                monitor = s.get(Monitor, m["id"])
                if monitor is None:
                    continue  # deleted while its check was running
                events += apply_result(s, monitor, result, now, self.settings.fail_threshold, self.settings.recover_threshold)
            if self._last_prune is None or now - self._last_prune > timedelta(hours=1):
                s.execute(delete(Check).where(Check.at < now - timedelta(days=self.settings.retention_days)))
                self._last_prune = now
            s.commit()
        return events

    async def _locate_self(self) -> None:
        """Where this server is: looked up once, retried hourly until it works."""
        now = self.clock.now()
        if self.settings.geolocate and self.origin is None and (self._origin_tried is None or now - self._origin_tried > timedelta(hours=1)):
            self._origin_tried = now
            found = await geolocate(self.client, self.settings.geo_url)
            if found:
                self.origin = {"name": found["place"], "lat": found["lat"], "lon": found["lon"]}
                self.bus.publish({"type": "origin", "monitor_id": 0})

    async def _enrich(self) -> None:
        """Slow, occasional work: where servers are, and when certificates expire."""
        now = self.clock.now()
        await self._locate_self()
        if self.settings.geolocate:

            def unlocated():
                with self.sessions() as s:
                    return [(m.id, urlsplit(m.url).hostname or "") for m in
                            s.scalars(select(Monitor).where(Monitor.geo_checked.is_(None)).limit(10))]
            for mid, host in await asyncio.to_thread(unlocated):
                found = await geolocate(self.client, self.settings.geo_url, host)
                await asyncio.to_thread(self._save, mid, geo_checked=True, **(found or {}))
                self.bus.publish({"type": "monitor_changed", "monitor_id": mid})

        stale = now - timedelta(hours=self.settings.cert_check_hours)

        def need_certs():
            with self.sessions() as s:
                q = select(Monitor).where(Monitor.url.like("https://%"), Monitor.paused.is_(False),
                                          (Monitor.cert_checked_at.is_(None)) | (Monitor.cert_checked_at < stale)).limit(20)
                return [(m.id, urlsplit(m.url)) for m in s.scalars(q)]
        todo = await asyncio.to_thread(need_certs)
        results = await asyncio.gather(*(self.cert_fetcher(u.hostname or "", u.port or 443, 10, self.ssl_context) for _, u in todo))
        for (mid, _), (expires, error) in zip(todo, results):
            await asyncio.to_thread(self._save, mid, cert_expires_at=expires, cert_error=error, cert_checked_at=now)

    def _save(self, monitor_id: int, **fields) -> None:
        with self.sessions() as s:
            m = s.get(Monitor, monitor_id)
            if m is not None:
                for k, v in fields.items():
                    setattr(m, k, v)
                s.commit()

    async def run_due(self, only_id: int | None = None) -> list[Event]:
        """Check every monitor that's due (or just `only_id`). Returns the events produced."""
        now = self.clock.now()
        due = await asyncio.to_thread(self._due, now, only_id)
        if not due:
            await self._locate_self()  # even an empty install should know where it is
            return []
        results = await asyncio.gather(*(self._check(m) for m in due))
        events = await asyncio.to_thread(self._record, list(zip(due, results)), now)
        for ev in events:
            self.bus.publish(ev.json())
            if ev.kind != "check" and self.settings.alert_webhook_url:
                if await send_alert(self.client, self.settings.alert_webhook_url, ev):
                    self.alerts_sent.append(ev)
        await self._enrich()
        return events

    async def run_forever(self) -> None:
        while True:
            try:
                await self.run_due()
            except Exception:  # one bad cycle must never stop monitoring
                log.exception("check cycle failed")
            await asyncio.sleep(1)  # ponytail: 1 s polling; a priority queue only matters at many thousands of monitors
