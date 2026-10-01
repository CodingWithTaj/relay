"""What a check result means: recording it, and opening or resolving incidents.

Pure logic on database objects, with no networking or clocks of its own, so
every rule here is easy to test.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .checker import CheckResult
from .db import Check, Incident, Monitor


@dataclass
class Event:
    kind: str           # "check" | "incident_opened" | "incident_resolved"
    monitor_id: int
    monitor_name: str
    detail: str = ""
    at: datetime | None = None
    data: dict = field(default_factory=dict)  # for checks: ok, ms, status_code

    def json(self) -> dict:
        return {"type": self.kind, "monitor_id": self.monitor_id, "monitor_name": self.monitor_name,
                "detail": self.detail, "at": self.at.isoformat() + "Z" if self.at else None, **self.data}


def open_incident(session: Session, monitor: Monitor) -> Incident | None:
    return (session.query(Incident)
            .filter(Incident.monitor_id == monitor.id, Incident.resolved_at.is_(None))
            .order_by(Incident.started_at.desc()).first())


def apply_result(session: Session, monitor: Monitor, result: CheckResult, now: datetime,
                 fail_threshold: int, recover_threshold: int) -> list[Event]:
    """Record a check and update the monitor's state. Returns what happened."""
    session.add(Check(monitor_id=monitor.id, at=now, ok=result.ok, status_code=result.status_code,
                      latency_ms=None if result.latency_ms is None else round(result.latency_ms, 1),
                      error=result.error, timings=json.dumps(result.timings) if result.timings else None))
    events = [Event("check", monitor.id, monitor.name, "up" if result.ok else (result.error or "failed"), now,
                    {"ok": result.ok, "ms": None if result.latency_ms is None else round(result.latency_ms, 1),
                     "status_code": result.status_code})]
    monitor.last_checked_at = now
    monitor.next_check_at = now + timedelta(seconds=monitor.interval_s)

    if result.ok:
        monitor.consecutive_failures = 0
        monitor.failing_since = None
        monitor.consecutive_successes += 1
        if monitor.status == "down":
            if monitor.consecutive_successes >= recover_threshold:
                incident = open_incident(session, monitor)
                if incident:
                    incident.resolved_at = now
                monitor.status = "up"
                duration = _duration(now - incident.started_at) if incident else ""
                events.append(Event("incident_resolved", monitor.id, monitor.name,
                                    f"back up after {duration}" if duration else "back up", now))
        else:
            monitor.status = "up"
    else:
        monitor.consecutive_successes = 0
        monitor.consecutive_failures += 1
        if monitor.failing_since is None:
            monitor.failing_since = now
        if monitor.status != "down" and monitor.consecutive_failures >= fail_threshold:
            # enough failures in a row: this is a real outage, not a blip
            session.add(Incident(monitor_id=monitor.id, started_at=monitor.failing_since, detected_at=now,
                                 cause=result.error or "check failed"))
            monitor.status = "down"
            events.append(Event("incident_opened", monitor.id, monitor.name, result.error or "check failed", now))
    return events


def _duration(d: timedelta) -> str:
    s = int(d.total_seconds())
    if s < 60:
        return f"{s} s"
    if s < 3600:
        return f"{s // 60} min"
    h, m = divmod(s // 60, 60)
    if h < 48:
        return f"{h} h {m} min" if m else f"{h} h"
    return f"{h // 24} days"


duration_text = _duration
