"""Live London buses (land domain) via the Bus Open Data Service (SIRI-VM).

BODS publishes real vehicle GPS for buses across England — including TfL's red
buses — updated every ~10s. We poll the SIRI-VM location feed over a London
bounding box; each ``VehicleActivity`` carries the route number, destination,
GPS and bearing inline (no timetable join needed). Like the AIS/ADS-B feeds this
reuses ``Source``'s supervisor/backoff/health but writes into a ``BusStore``.
Requires a free BODS API key (``BODS_API_KEY``).
"""
from __future__ import annotations

import asyncio
import logging
import time
import xml.etree.ElementTree as ET

import httpx

from ..config import Settings
from ..models import Bus
from ..store.bus import BusStore
from .base import Source, _valid_position

log = logging.getLogger("source")

_UA = "ais-tracker/1.0 (+https://github.com/spwizard/ais-tracker)"
_NS = {"s": "http://www.siri.org.uk/siri"}


def _text(el, path: str) -> str | None:
    x = el.find(path, _NS)
    return x.text if x is not None else None


def _num(s: str | None) -> float | None:
    try:
        return float(s) if s is not None else None
    except ValueError:
        return None


def parse_vehicles(xml_bytes: bytes, now: float) -> list[Bus]:
    """Parse a SIRI-VM response into Bus records. Drops entries without a usable
    position or vehicle reference."""
    out: list[Bus] = []
    root = ET.fromstring(xml_bytes)
    for va in root.iterfind(".//s:VehicleActivity", _NS):
        mvj = va.find(".//s:MonitoredVehicleJourney", _NS)
        if mvj is None:
            continue
        loc = mvj.find("s:VehicleLocation", _NS)
        if loc is None:
            continue
        lat = _num(_text(loc, "s:Latitude"))
        lon = _num(_text(loc, "s:Longitude"))
        if not _valid_position(lat, lon):
            continue
        vref = _text(mvj, "s:VehicleRef")
        if not vref:
            continue
        op = _text(mvj, "s:OperatorRef")
        dest = _text(mvj, "s:DestinationName")
        out.append(
            Bus(
                id=f"{op or '?'}:{vref}",
                route=_text(mvj, "s:PublishedLineName") or _text(mvj, "s:LineRef"),
                destination=dest.replace("_", " ") if dest else None,
                operator=op,
                lat=lat,
                lon=lon,
                bearing=_num(_text(mvj, "s:Bearing")),
                ts=now,
            )
        )
    return out


class BodsSource(Source):
    name = "bods"

    def __init__(self, store: BusStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._url = settings.bods_url.rstrip("/")
        self._key = settings.bods_api_key
        self._bbox = settings.bus_bbox
        self._poll = settings.bus_poll_sec
        self._ttl = settings.bus_ttl_sec

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def _consume(self) -> None:
        if not self._key:
            await self._stop.wait()  # no key → stay idle (amber in the UI)
            return
        params = {"api_key": self._key, "boundingBox": self._bbox}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                resp = await client.get(f"{self._url}/datafeed/", params=params)
                resp.raise_for_status()
                now = time.time()
                for bus in parse_vehicles(resp.content, now):
                    self.messages_seen += 1
                    self.last_msg_ts = now
                    await self._store.upsert(bus)
                await self._store.evict_stale(self._ttl)
                await asyncio.sleep(self._poll)
