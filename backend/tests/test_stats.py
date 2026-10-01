from datetime import date, datetime, timedelta

from relay.db import Check, Incident, Monitor, make_engine, make_sessionmaker
from relay.stats import daily_bars, latency_series, latency_summary, percentile, uptime


def test_percentile_nearest_rank():
    v = list(range(1, 101))
    assert percentile(v, 50) == 50 and percentile(v, 95) == 95 and percentile(v, 100) == 100
    assert percentile([7.0], 95) == 7.0 and percentile([], 50) is None


def test_uptime_latency_bars_and_series(tmp_path):
    s = make_sessionmaker(make_engine(f"sqlite:///{tmp_path}/s.db"))()
    m = Monitor(name="m", url="https://x", next_check_at=datetime(2026, 3, 1), created_at=datetime(2026, 3, 1))
    s.add(m)
    s.commit()
    day1, day2 = datetime(2026, 3, 1), datetime(2026, 3, 2)
    for i in range(100):  # day 1: all fine
        s.add(Check(monitor_id=m.id, at=day1 + timedelta(minutes=i), ok=True, status_code=200, latency_ms=float(i + 1)))
    for i in range(100):  # day 2: 10 failures
        s.add(Check(monitor_id=m.id, at=day2 + timedelta(minutes=i), ok=i >= 10, status_code=200, latency_ms=100.0))
    s.add(Incident(monitor_id=m.id, started_at=day2, detected_at=day2 + timedelta(minutes=2),
                   resolved_at=day2 + timedelta(minutes=10), cause="HTTP 503"))
    s.commit()
    assert uptime(s, m.id, day1) == 95.0
    assert uptime(s, m.id, day2) == 90.0
    assert uptime(s, m.id, day2 + timedelta(days=1)) is None
    lat = latency_summary(s, m.id, day1)
    assert lat["samples"] == 190 and lat["p50"] == 95.0 and lat["p95"] == 100.0
    bars = daily_bars(s, m.id, 3, date(2026, 3, 3))
    assert [b["level"] for b in bars] == ["up", "down", "none"]
    assert bars[1]["uptime"] == 90.0 and bars[1]["incident"]
    series = latency_series(s, m.id, day2, 4, day2 + timedelta(hours=4))
    assert series[0]["failures"] == 10 and series[0]["avg"] == 100.0 and series[3]["avg"] is None
