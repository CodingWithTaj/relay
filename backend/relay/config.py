"""Settings, read from environment variables."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", "sqlite:///relay.db"))
    # Required for anything that changes data. If unset, a random one is generated and logged at startup.
    admin_token: str = field(default_factory=lambda: os.environ.get("ADMIN_TOKEN") or secrets.token_urlsafe(24))
    admin_token_generated: bool = field(default_factory=lambda: not os.environ.get("ADMIN_TOKEN"))
    # An incident opens after this many failed checks in a row, so one blip doesn't page anyone...
    fail_threshold: int = field(default_factory=lambda: int(os.environ.get("FAIL_THRESHOLD", "3")))
    # ...and closes after this many successes in a row, so a flapping service doesn't spam alerts.
    recover_threshold: int = field(default_factory=lambda: int(os.environ.get("RECOVER_THRESHOLD", "2")))
    max_concurrent_checks: int = field(default_factory=lambda: int(os.environ.get("MAX_CONCURRENT_CHECKS", "20")))
    # Checks older than this are deleted, so the database doesn't grow forever.
    retention_days: int = field(default_factory=lambda: int(os.environ.get("RETENTION_DAYS", "90")))
    # Discord or Slack incoming-webhook URL for incident alerts.
    alert_webhook_url: str | None = field(default_factory=lambda: os.environ.get("ALERT_WEBHOOK_URL") or None)
    # Refuse to monitor private, loopback and cloud-metadata addresses (SSRF protection).
    # Turn this off only for local demos where the targets are on a private network.
    allow_private_targets: bool = field(default_factory=lambda: _bool("ALLOW_PRIVATE_TARGETS", False))
    run_scheduler: bool = field(default_factory=lambda: _bool("RUN_SCHEDULER", True))
    public_title: str = field(default_factory=lambda: os.environ.get("STATUS_PAGE_TITLE", "Service status"))
    # look up where monitored servers (and this one) are, for the globe
    geolocate: bool = field(default_factory=lambda: _bool("GEOLOCATE", True))
    geo_url: str = field(default_factory=lambda: os.environ.get("GEO_URL", "http://ip-api.com/json"))
    # how often to re-read each site's TLS certificate
    cert_check_hours: float = field(default_factory=lambda: float(os.environ.get("CERT_CHECK_HOURS", "12")))
    # where the built frontend lives (served at /)
    static_dir: str | None = field(default_factory=lambda: os.environ.get("RELAY_STATIC") or None)
    # base URL of the bundled demo target; if set, a fresh database gets four demo monitors
    seed_demo_url: str | None = field(default_factory=lambda: os.environ.get("SEED_DEMO_URL") or None)
