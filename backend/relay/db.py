"""Database tables and sessions (SQLAlchemy 2.0). Works with SQLite and PostgreSQL."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


class Base(DeclarativeBase):
    pass


class Monitor(Base):
    __tablename__ = "monitors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(2000))
    method: Mapped[str] = mapped_column(String(8), default="GET")
    interval_s: Mapped[int] = mapped_column(Integer, default=60)
    timeout_s: Mapped[float] = mapped_column(default=10.0)
    expected_status: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None: any 2xx or 3xx
    keyword: Mapped[str | None] = mapped_column(String(200), nullable=True)      # must appear in the body
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    public: Mapped[bool] = mapped_column(Boolean, default=True)                  # shown on the status page
    status: Mapped[str] = mapped_column(String(10), default="pending")           # pending | up | down
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    consecutive_successes: Mapped[int] = mapped_column(Integer, default=0)
    failing_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_check_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    # where the site's server is, for the globe (looked up once)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    place: Mapped[str | None] = mapped_column(String(120), nullable=True)
    geo_checked: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # the site's TLS certificate
    cert_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cert_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cert_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    checks: Mapped[list["Check"]] = relationship(back_populates="monitor", cascade="all, delete-orphan", passive_deletes=True)
    incidents: Mapped[list["Incident"]] = relationship(back_populates="monitor", cascade="all, delete-orphan", passive_deletes=True)


class Check(Base):
    __tablename__ = "checks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    monitor_id: Mapped[int] = mapped_column(ForeignKey("monitors.id", ondelete="CASCADE"))
    at: Mapped[datetime] = mapped_column(DateTime)
    ok: Mapped[bool] = mapped_column(Boolean)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[float | None] = mapped_column(nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # milliseconds per stage, as JSON: {"dns", "connect", "tls", "wait", "download"}
    timings: Mapped[str | None] = mapped_column(Text, nullable=True)
    monitor: Mapped[Monitor] = relationship(back_populates="checks")
    __table_args__ = (Index("ix_checks_monitor_at", "monitor_id", "at"),)


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    monitor_id: Mapped[int] = mapped_column(ForeignKey("monitors.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime)   # the first failed check
    detected_at: Mapped[datetime] = mapped_column(DateTime)  # when the threshold was reached
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cause: Mapped[str] = mapped_column(Text)
    monitor: Mapped[Monitor] = relationship(back_populates="incidents")
    __table_args__ = (Index("ix_incidents_monitor_started", "monitor_id", "started_at"),)


def make_engine(url: str):
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, pool_pre_ping=True, **kwargs)
    if url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(conn, _record):
            cur = conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")   # make ON DELETE CASCADE work
            cur.execute("PRAGMA journal_mode=WAL")  # readers don't block the scheduler's writes
            cur.close()
    Base.metadata.create_all(engine)
    add_missing_columns(engine)
    return engine


def add_missing_columns(engine) -> list[str]:
    """Bring a database made by an older version up to date by adding any new
    columns. Every column added after 1.0 is nullable, so this is always safe.
    (ponytail: additive only; renames or type changes would need Alembic.)"""
    added = []
    existing = inspect(engine)
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            have = {c["name"] for c in existing.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have:
                    ddl = col.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}'))
                    added.append(f"{table.name}.{col.name}")
    return added


def make_sessionmaker(engine):
    return sessionmaker(engine, expire_on_commit=False)
