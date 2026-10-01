"""Uptime, latency percentiles and daily bars, computed from stored checks."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta

from sqlalchemy import Integer, case, cast, func, select
from sqlalchemy.orm import Session

from .db import Check, Incident


def uptime(session: Session, monitor_id: int, since: datetime) -> float | None:
    """Percentage of successful checks since `since`, or None if there are none."""
    total, good = session.execute(
        select(func.count(Check.id), func.coalesce(func.sum(cast(case((Check.ok, 1), else_=0), Integer)), 0))
        .where(Check.monitor_id == monitor_id, Check.at >= since)
    ).one()
    return round(100.0 * good / total, 3) if total else None


def percentile(sorted_values: list[float], p: float) -> float | None:
    """Nearest-rank percentile of an already sorted list."""
    if not sorted_values:
        return None
    k = max(0, min(len(sorted_values) - 1, math.ceil(p / 100 * len(sorted_values)) - 1))
    return sorted_values[k]


def latency_summary(session: Session, monitor_id: int, since: datetime) -> dict:
    values = sorted(v for (v,) in session.execute(
        select(Check.latency_ms).where(Check.monitor_id == monitor_id, Check.at >= since,
                                       Check.ok, Check.latency_ms.is_not(None))))
    return {"p50": percentile(values, 50), "p95": percentile(values, 95), "samples": len(values)}


def latency_series(session: Session, monitor_id: int, since: datetime, buckets: int, now: datetime) -> list[dict]:
    """Average latency in equal time buckets, for charts. Empty buckets are None."""
    span = (now - since) / buckets
    out = [{"t": (since + span * i).isoformat() + "Z", "avg": None, "failures": 0} for i in range(buckets)]
    sums = [0.0] * buckets
    counts = [0] * buckets
    rows = session.execute(select(Check.at, Check.ok, Check.latency_ms)
                           .where(Check.monitor_id == monitor_id, Check.at >= since, Check.at <= now))
    for at, ok, lat in rows:
        i = min(buckets - 1, int((at - since) / span))
        if not ok:
            out[i]["failures"] += 1
        elif lat is not None:
            sums[i] += lat
            counts[i] += 1
    for i in range(buckets):
        if counts[i]:
            out[i]["avg"] = round(sums[i] / counts[i], 1)
    return out


def daily_bars(session: Session, monitor_id: int, days: int, today: date) -> list[dict]:
    """One entry per day for the last `days` days: uptime and a status colour."""
    start = datetime.combine(today - timedelta(days=days - 1), datetime.min.time())
    day = func.date(Check.at)
    rows = session.execute(
        select(day, func.count(Check.id), func.sum(cast(case((Check.ok, 1), else_=0), Integer)))
        .where(Check.monitor_id == monitor_id, Check.at >= start).group_by(day)).all()
    by_day = {str(d)[:10]: (total, good or 0) for d, total, good in rows}
    incidents = session.execute(
        select(Incident.started_at, Incident.resolved_at)
        .where(Incident.monitor_id == monitor_id,
               (Incident.resolved_at.is_(None)) | (Incident.resolved_at >= start))).all()
    out = []
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        key = d.isoformat()
        total, good = by_day.get(key, (0, 0))
        day_start = datetime.combine(d, datetime.min.time())
        day_end = day_start + timedelta(days=1)
        had_incident = any(s < day_end and (r is None or r > day_start) for s, r in incidents)
        if not total:
            level = "none"
        else:
            pct = 100.0 * good / total
            level = "up" if pct >= 99.9 and not had_incident else "partial" if pct >= 95 else "down"
        out.append({"date": key, "uptime": round(100.0 * good / total, 2) if total else None,
                    "checks": total, "level": level, "incident": had_incident})
    return out
