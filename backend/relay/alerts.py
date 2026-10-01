"""Incident alerts to a Discord or Slack incoming webhook."""
from __future__ import annotations

import logging

import httpx

from .engine import Event

log = logging.getLogger("relay.alerts")


def alert_text(event: Event) -> str:
    if event.kind == "incident_opened":
        return f"🔴 {event.monitor_name} is down: {event.detail}"
    return f"🟢 {event.monitor_name} is up again ({event.detail})"


async def send_alert(client: httpx.AsyncClient, webhook_url: str, event: Event) -> bool:
    text = alert_text(event)
    try:
        # Discord reads "content", Slack reads "text"; each ignores the other key.
        r = await client.post(webhook_url, json={"content": text, "text": text}, timeout=10)
        r.raise_for_status()
        return True
    except httpx.HTTPError as e:
        log.warning("alert webhook failed: %s", e)
        return False
