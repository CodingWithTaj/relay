"""The incident rules, on their own."""
from datetime import datetime, timedelta

from relay.checker import CheckResult
from relay.db import Incident, Monitor, make_engine, make_sessionmaker
from relay.engine import apply_result

OK = CheckResult(True, 200, 50.0, None)
FAIL = CheckResult(False, 503, 30.0, "HTTP 503")


def setup(tmp_path):
    s = make_sessionmaker(make_engine(f"sqlite:///{tmp_path}/e.db"))()
    m = Monitor(name="api", url="https://api.example", next_check_at=datetime(2026, 1, 1), created_at=datetime(2026, 1, 1))
    s.add(m)
    s.commit()
    return s, m


def feed(s, m, results, start=datetime(2026, 1, 1)):
    events = []
    for i, r in enumerate(results):
        events += apply_result(s, m, r, start + timedelta(minutes=i), fail_threshold=3, recover_threshold=2)
    s.commit()
    return [e.kind for e in events if e.kind != "check"]


def test_a_blip_does_not_open_an_incident(tmp_path):
    s, m = setup(tmp_path)
    assert feed(s, m, [OK, FAIL, FAIL, OK, FAIL, OK]) == []
    assert m.status == "up"
    assert s.query(Incident).count() == 0


def test_three_failures_in_a_row_open_an_incident_dated_from_the_first(tmp_path):
    s, m = setup(tmp_path)
    assert feed(s, m, [OK, FAIL, FAIL, FAIL, FAIL]) == ["incident_opened"]
    inc = s.query(Incident).one()
    assert m.status == "down"
    assert inc.started_at == datetime(2026, 1, 1, 0, 1)   # the first failure, not the third
    assert inc.detected_at == datetime(2026, 1, 1, 0, 3)
    assert inc.cause == "HTTP 503"


def test_recovery_needs_successes_in_a_row(tmp_path):
    s, m = setup(tmp_path)
    kinds = feed(s, m, [FAIL, FAIL, FAIL, OK, FAIL, OK, OK])
    assert kinds == ["incident_opened", "incident_resolved"]  # the lone OK didn't resolve it
    assert s.query(Incident).count() == 1                     # and the FAIL after it didn't open a second
    inc = s.query(Incident).one()
    assert inc.resolved_at == datetime(2026, 1, 1, 0, 6)
    assert m.status == "up"


def test_next_check_is_scheduled_by_interval(tmp_path):
    s, m = setup(tmp_path)
    m.interval_s = 300
    apply_result(s, m, OK, datetime(2026, 1, 1, 10), 3, 2)
    assert m.next_check_at == datetime(2026, 1, 1, 10, 5)
