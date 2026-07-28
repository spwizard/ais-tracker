"""Traffic Scotland road eye — official trunk-road events for the incident spine.

Polls the (undocumented, keyless) JSON API behind traffic.gov.scot's own live
map: current incidents, delaying roadworks, and the two uniquely Scottish
signals — snow gates and wind-restricted bridges — normalised to Incidents.
Like the TfL eye, each poll replaces this source's whole set so resolved events
clear atomically. Being an unofficial API it could change shape without notice;
parsers are defensive and a failed poll keeps the last good set.

Endpoints (verified 2026-07): https://www.traffic.gov.scot/tsis/{incidents,
roadworks,snowgates,bridges} — all return {"status":"ok","results":[...]} with
lat/lng as strings. Terms require crediting Traffic Scotland (we do, per-card).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

import httpx

from ..config import Settings
from ..models import Incident
from ..store.incident import IncidentStore
from .base import Source

log = logging.getLogger("source")

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
BASE = "https://www.traffic.gov.scot/tsis"
POLL_SEC = 120.0

# incident_type_name → our category. The feed is already curated (a handful of
# genuine current events), so unlike TfL we keep everything it sends.
_CATEGORY = {
    "accident": "collision",
    "collision": "collision",
    "breakdown": "breakdown",
    "hazard": "hazard",
    "queue": "congestion",
    "congestion": "congestion",
    "flooding": "hazard",
    "closure": "delay",
    "restriction": "delay",
}
_SEVERITY = {
    "collision": "serious",
    "hazard": "moderate",
    "breakdown": "moderate",
    "delay": "moderate",
    "congestion": "minor",
}

_TAG = re.compile(r"<[^>]+>")


def _clean(html: str | None) -> str | None:
    """The feed embeds <br>-formatted fragments; flatten to plain text."""
    if not html:
        return None
    text = _TAG.sub(" ", html.replace("<br>", "\n")).strip()
    return re.sub(r"[ \t]+", " ", text) or None


def _latlng(row: dict) -> tuple[float, float] | None:
    try:
        lat, lng = float(row["lat"]), float(row["lng"])
    except (KeyError, ValueError, TypeError):
        return None
    if not (54.0 <= lat <= 61.5 and -8.5 <= lng <= 0.5):
        return None  # outside Scotland — junk coordinates
    return lat, lng


def _epoch(v) -> float | None:
    try:
        ts = float(v)
        return ts if ts > 0 else None
    except (ValueError, TypeError):
        return None


def parse_incidents(items: list[dict], now: float) -> list[Incident]:
    out: list[Incident] = []
    for d in items:
        pt = _latlng(d)
        if pt is None:
            continue
        cat = _CATEGORY.get((d.get("incident_type_name") or "").strip().lower(), "other")
        rid = d.get("incident_id") or d.get("sid") or f"{pt[0]:.4f},{pt[1]:.4f}"
        out.append(Incident(
            id=f"scot-road:{rid}",
            source="scot-road",
            category=cat,
            severity=_SEVERITY.get(cat, "minor"),
            confidence="official",
            title=(d.get("location_name") or d.get("road_name") or "Incident")[:80],
            detail=_clean(d.get("description")),
            location=", ".join(x for x in (d.get("direction_name"), d.get("region_name")) if x) or None,
            lat=pt[0],
            lon=pt[1],
            ts=_epoch(d.get("start_time")) or now,
            updated=_epoch(d.get("last_modified")) or now,
        ))
    return out


def parse_roadworks(items: list[dict], now: float) -> list[Incident]:
    """Keep only roadworks actually causing delay — the feed lists every cone
    on the network (~550 sites); 'No reported delay.' ones are dropped."""
    out: list[Incident] = []
    for d in items:
        delay = (d.get("delay_information") or "").strip()
        if not delay or delay.lower().startswith("no reported delay"):
            continue
        pt = _latlng(d)
        if pt is None:
            continue
        rid = d.get("roadwork_id") or d.get("sid") or f"{pt[0]:.4f},{pt[1]:.4f}"
        out.append(Incident(
            id=f"scot-road:rw:{rid}",
            source="scot-road",
            category="works",
            severity="minor",
            confidence="official",
            title=(d.get("location_name") or "Roadworks").strip()[:80],
            detail="\n".join(x for x in (delay, _clean(d.get("description"))) if x) or None,
            location=d.get("direction_text") or None,
            lat=pt[0],
            lon=pt[1],
            ts=now,
            updated=now,
        ))
    return out


def parse_snowgates(items: list[dict], now: float) -> list[Incident]:
    """Only gates that are NOT open — a closed snow gate is a serious,
    route-severing event (and rare enough to always surface)."""
    out: list[Incident] = []
    for d in items:
        status = (d.get("currentStatus") or "").strip()
        if not status or status.lower() == "open":
            continue
        pt = _latlng(d)
        if pt is None:
            continue
        route = d.get("route") or ""
        place = d.get("realWorldLocation") or ""
        out.append(Incident(
            id=f"scot-road:gate:{d.get('sid') or place}",
            source="scot-road",
            category="hazard",
            severity="serious",
            confidence="official",
            title=f"Snow gate {status.lower()}: {route} {place}".strip()[:80],
            detail=f"The {route} snow gate at {place} is {status.lower()}.",
            location=d.get("direction") or None,
            lat=pt[0],
            lon=pt[1],
            ts=now,
            updated=now,
        ))
    return out


def parse_bridges(items: list[dict], now: float) -> list[Incident]:
    """Only bridges NOT fully open — wind restrictions/closures on the Forth,
    Tay, Erskine etc. are exactly the events people check for."""
    out: list[Incident] = []
    for d in items:
        status = (d.get("current_status") or "").strip()
        if not status or status.lower() == "open":
            continue
        pt = _latlng(d)
        if pt is None:
            continue
        name = d.get("name") or "Bridge"
        out.append(Incident(
            id=f"scot-road:bridge:{d.get('id') or name}",
            source="scot-road",
            category="delay",
            severity="serious",
            confidence="official",
            title=f"{name}: {status}"[:80],
            detail=f"{name} ({d.get('road_name') or ''}) status: {status}.".replace("() ", ""),
            lat=pt[0],
            lon=pt[1],
            ts=now,
            updated=now,
        ))
    return out


class ScotRoadSource(Source):
    name = "scot-road"

    def __init__(self, store: IncidentStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self.new_ids: list[str] = []  # ids first seen on the latest poll

    @property
    def configured(self) -> bool:
        return True

    async def _consume(self) -> None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                now = time.time()
                incidents: list[Incident] = []
                ok = False
                for path, parse in (
                    ("incidents", parse_incidents),
                    ("roadworks", parse_roadworks),
                    ("snowgates", parse_snowgates),
                    ("bridges", parse_bridges),
                ):
                    try:
                        resp = await client.get(f"{BASE}/{path}")
                        resp.raise_for_status()
                        body = resp.json()
                        if body.get("status") != "ok":
                            raise ValueError(f"status={body.get('status')}")
                        incidents.extend(parse(body.get("results") or [], now))
                        ok = True
                    except (httpx.HTTPError, ValueError, KeyError) as exc:
                        # One bad endpoint shouldn't blank the others — but if
                        # a fetch fails we must NOT replace with a partial set,
                        # so bail out of this cycle entirely.
                        log.warning("[scot-road] %s fetch failed: %s", path, exc)
                        ok = False
                        break
                if ok:
                    self.new_ids = await self._store.replace_source("scot-road", incidents)
                    self.messages_seen += len(incidents)
                    self.last_msg_ts = now
                await asyncio.sleep(POLL_SEC)
