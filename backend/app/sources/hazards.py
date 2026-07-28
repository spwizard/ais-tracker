"""Hazards eye — Scottish flood warnings, severe-weather warnings, UK quakes.

Three free feeds, one normalised Hazard shape:
  - SEPA flood warnings via the public ArcGIS services behind SEPA's own
    Floodline map (undocumented but anonymously queryable; only areas with a
    live severity are fetched, so the query is empty most of the year).
  - Met Office severe-weather warnings via the regional RSS feeds for the six
    Scottish regions (text-only; pinned at region centroids).
  - BGS recent-earthquakes GeoRSS (UK-wide, kept to the last 14 days).

A healthy summer day returns zero floods, zero warnings and the odd tiny
quake — an empty layer is the expected steady state, so the source counts a
successful poll as receiving even when nothing is in force.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import httpx

from ..config import Settings
from ..models import Hazard
from ..store.hazard import HazardStore
from .base import Source

log = logging.getLogger("source")

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 900.0

SEPA_QUERY = (
    "https://services-eu1.arcgis.com/jj6fR2HO7enbrICO/arcgis/rest/services/"
    "Flood_Warning_Areas_(public)_view/FeatureServer/0/query"
)
BGS_FEED = "https://quakes.bgs.ac.uk/feeds/MhSeismology.xml"
METOFFICE_RSS = "https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/{code}"

# Scottish Met Office warning regions → rough centroid for the pin.
MET_REGIONS = {
    "he": ("Highlands & Eilean Siar", 57.5, -4.9),
    "os": ("Orkney & Shetland", 59.5, -2.4),
    "gr": ("Grampian", 57.25, -2.8),
    "ta": ("Central, Tayside & Fife", 56.4, -3.6),
    "st": ("Strathclyde", 55.7, -4.5),
    "dg": ("Dumfries, Galloway, Lothian & Borders", 55.3, -3.6),
}

QUAKE_MAX_AGE = 14 * 86_400.0

_GEO = "{http://www.w3.org/2003/01/geo/wgs84_pos#}"


def _flood_severity(raw: str | None) -> str:
    v = (raw or "").lower()
    if "severe" in v:
        return "serious"
    if "warning" in v:
        return "moderate"
    return "minor"  # alert


def _bbox_centre(geometry: dict) -> tuple[float, float] | None:
    """Centroid-ish point of a GeoJSON polygon/multipolygon (bbox middle —
    plenty for placing a marker on a warning area)."""
    lats: list[float] = []
    lons: list[float] = []

    def walk(coords) -> None:
        if isinstance(coords[0], (int, float)):
            lons.append(coords[0])
            lats.append(coords[1])
        else:
            for c in coords:
                walk(c)

    try:
        walk(geometry["coordinates"])
    except (KeyError, IndexError, TypeError):
        return None
    if not lats:
        return None
    return (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2


def parse_sepa(body: dict, now: float) -> list[Hazard]:
    out: list[Hazard] = []
    for f in body.get("features") or []:
        props = f.get("properties") or {}
        geometry = f.get("geometry")
        centre = _bbox_centre(geometry) if geometry else None
        if centre is None:
            continue
        name = props.get("fwa_name") or "Flood warning area"
        out.append(Hazard(
            id=f"flood:{props.get('fwa_name') or centre}",
            kind="flood",
            severity=_flood_severity(props.get("severity")),
            title=f"{props.get('severity') or 'Flood alert'}: {name}"[:90],
            detail=props.get("message") or None,
            region=props.get("local_authority") or None,
            lat=centre[0],
            lon=centre[1],
            geometry=geometry,
            url="https://floodline.sepa.org.uk/live-flood-information/",
            ts=now,
            updated=now,
        ))
    return out


def _weather_severity(title: str) -> str:
    t = title.lower()
    if t.startswith("red"):
        return "serious"
    if t.startswith("amber"):
        return "moderate"
    return "minor"  # yellow


def parse_metoffice(xml_text: str, code: str, now: float) -> list[Hazard]:
    region, lat, lon = MET_REGIONS[code]
    out: list[Hazard] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for i, item in enumerate(root.iter("item")):
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        out.append(Hazard(
            id=f"weather:{code}:{i}:{title[:40]}",
            kind="weather",
            severity=_weather_severity(title),
            title=title[:90],
            detail=(item.findtext("description") or "").strip() or None,
            region=region,
            lat=lat,
            lon=lon,
            url=(item.findtext("link") or "").strip() or None,
            ts=now,
            updated=now,
        ))
    return out


_QUAKE_MAG = re.compile(r"Magnitude:\s*([\d.]+)")
_QUAKE_DEPTH = re.compile(r"Depth:\s*([\d.]+)\s*km")
_QUAKE_LOC = re.compile(r"Location:\s*([^;]+);")


def _quake_severity(mag: float) -> str:
    if mag >= 4.0:
        return "serious"
    if mag >= 2.5:
        return "moderate"
    return "minor"


def parse_bgs(xml_text: str, now: float) -> list[Hazard]:
    out: list[Hazard] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    for item in root.iter("item"):
        try:
            lat = float(item.findtext(f"{_GEO}lat") or "")
            lon = float(item.findtext(f"{_GEO}long") or "")
        except ValueError:
            continue
        desc = item.findtext("description") or ""
        mag_m = _QUAKE_MAG.search(desc)
        if not mag_m:
            continue
        mag = float(mag_m.group(1))
        try:
            ts = parsedate_to_datetime(item.findtext("pubDate") or "").timestamp()
        except (ValueError, TypeError):
            ts = now
        if now - ts > QUAKE_MAX_AGE:
            continue
        loc_m = _QUAKE_LOC.search(desc)
        place = (loc_m.group(1).strip().title() if loc_m else "UK")
        depth_m = _QUAKE_DEPTH.search(desc)
        link = (item.findtext("link") or "").strip()
        out.append(Hazard(
            id=f"quake:{link.rsplit('/', 1)[-1].removesuffix('.html') or f'{lat},{lon},{ts}'}",
            kind="quake",
            severity=_quake_severity(mag),
            title=f"M{mag:g} earthquake — {place}"[:90],
            detail=(desc.strip() + (f" (depth {depth_m.group(1)} km)" if depth_m else ""))[:300],
            region=place,
            lat=lat,
            lon=lon,
            url=link or None,
            magnitude=mag,
            ts=ts,
            updated=now,
        ))
    return out


class HazardSource(Source):
    name = "hazards"

    def __init__(self, store: HazardStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self.stale_after = POLL_SEC * 2 + 60.0  # slow poller

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
                hazards: list[Hazard] = []
                any_ok = False
                try:
                    r = await client.get(SEPA_QUERY, params={
                        "where": "severity IS NOT NULL",
                        "outFields": "fwa_name,severity,message,local_authority",
                        "f": "geojson",
                        "outSR": "4326",
                    })
                    r.raise_for_status()
                    hazards.extend(parse_sepa(r.json(), now))
                    any_ok = True
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    log.warning("[hazards] sepa fetch failed: %s", exc)
                for code in MET_REGIONS:
                    try:
                        r = await client.get(METOFFICE_RSS.format(code=code))
                        r.raise_for_status()
                        hazards.extend(parse_metoffice(r.text, code, now))
                        any_ok = True
                    except httpx.HTTPError as exc:
                        log.warning("[hazards] metoffice %s fetch failed: %s", code, exc)
                try:
                    r = await client.get(BGS_FEED)
                    r.raise_for_status()
                    hazards.extend(parse_bgs(r.text, now))
                    any_ok = True
                except httpx.HTTPError as exc:
                    log.warning("[hazards] bgs fetch failed: %s", exc)
                if any_ok:
                    await self._store.replace(hazards)
                    # An empty result is a *successful* poll (nothing in force),
                    # so count the poll itself for feed health.
                    self.messages_seen += max(len(hazards), 1)
                    self.last_msg_ts = now
                await asyncio.sleep(POLL_SEC)
