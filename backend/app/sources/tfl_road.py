"""TfL road-disruption source — the first official eye of the incident spine.

Polls /Road/all/Disruption (keyless), keeps the meaningful ones (collisions,
breakdowns, hazards, network delays, and anything Serious/Moderate — the bulk
of the feed is minor roadworks we drop), normalises them to Incidents, and
replaces the source's set each poll so resolved disruptions clear.
"""
from __future__ import annotations

import asyncio
import json
import time

import httpx

from ..config import Settings
from ..models import Incident
from ..store.incident import IncidentStore
from .base import Source

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 120.0

_SEVERITY = {
    "serious": "serious", "severe": "serious",
    "moderate": "moderate",
    "minimal": "minor", "minor": "minor", "low": "minor",
}
_CATEGORY = {
    "collisions": "collision",
    "breakdowns": "breakdown",
    "hazards": "hazard",
    "network delays": "delay",
    "asset issues": "hazard",
    "works": "works",
    "planned events": "event",
}
# Categories always worth surfacing regardless of severity.
_ALWAYS = {"collision", "breakdown", "hazard", "delay"}


def _point(s: str | None) -> tuple[float, float] | None:
    """Parse TfL's "[lon,lat]" point string."""
    if not s:
        return None
    try:
        lon, lat = json.loads(s)
        return float(lat), float(lon)
    except (ValueError, TypeError):
        return None


def parse_disruptions(items: list[dict], now: float) -> list[Incident]:
    out: list[Incident] = []
    for d in items:
        sev = _SEVERITY.get((d.get("severity") or "").lower(), "minor")
        cat = _CATEGORY.get((d.get("category") or "").lower(), "other")
        # Skip the noise: minor roadworks/events that aren't inherently notable.
        if cat not in _ALWAYS and sev == "minor":
            continue
        pt = _point(d.get("point"))
        if pt is None:
            continue
        did = d.get("id") or f"{pt[0]},{pt[1]}"
        loc = d.get("location") or ""
        title = loc.split(" (")[0][:80] or cat.title()
        detail = d.get("currentUpdate") or d.get("comments")
        started = d.get("startDateTime")
        try:
            ts = time.mktime(time.strptime(started, "%Y-%m-%dT%H:%M:%SZ")) if started else now
        except (ValueError, TypeError):
            ts = now
        out.append(Incident(
            id=f"tfl-road:{did}",
            source="tfl-road",
            category=cat,
            severity=sev,
            confidence="official",
            title=title,
            detail=detail,
            location=loc or None,
            lat=pt[0],
            lon=pt[1],
            url=d.get("url"),
            ts=ts,
            updated=now,
        ))
    return out


class TflRoadSource(Source):
    name = "tfl-road"

    def __init__(self, store: IncidentStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._app_key = settings.tfl_app_key
        self.new_ids: list[str] = []  # ids first seen on the latest poll (app toasts these)

    @property
    def configured(self) -> bool:
        return True

    async def _consume(self) -> None:
        params = {"app_key": self._app_key} if self._app_key else {}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                resp = await client.get(
                    "https://api.tfl.gov.uk/Road/all/Disruption", params=params
                )
                resp.raise_for_status()
                now = time.time()
                incidents = parse_disruptions(resp.json(), now)
                self.new_ids = await self._store.replace_source("tfl-road", incidents)
                self.messages_seen += len(incidents)
                self.last_msg_ts = now
                await asyncio.sleep(POLL_SEC)
