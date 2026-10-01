"""Time, behind an interface, so tests can control it."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    # Stored without tzinfo (always UTC) so SQLite and PostgreSQL behave the same.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SystemClock:
    def now(self) -> datetime:
        return utcnow()


class FakeClock:
    """A clock that only moves when told to."""

    def __init__(self, start: datetime | None = None):
        self.t = start or datetime(2026, 1, 1, 12, 0, 0)

    def now(self) -> datetime:
        return self.t

    def advance(self, **kwargs: float) -> datetime:
        self.t += timedelta(**kwargs)
        return self.t
