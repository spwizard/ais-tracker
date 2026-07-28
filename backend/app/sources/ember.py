"""Ember coaches — the one genuinely open Scottish bus-position feed.

Ember (electric intercity coaches: Dundee–Edinburgh–Glasgow–Aberdeen–Highlands)
publishes GTFS-Realtime with no key. The realtime feed carries positions but
leaves route/label blank, so the GTFS *static* bundle is fetched on startup
(and daily) to map trip_id → route code ("E1"…"E10") and headsign — only
trips.txt/routes.txt are parsed out of the ~36 MB zip. Vehicles flow into the
existing bus domain (same store, socket frames and map layer as London buses).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
import time
import zipfile

import httpx
from google.transit import gtfs_realtime_pb2

from ..config import Settings
from ..models import Bus
from ..store.bus import BusStore
from .base import Source

log = logging.getLogger("source")

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
REALTIME_URL = "https://api.ember.to/v1/gtfs/realtime/"
STATIC_URL = "https://api.ember.to/v1/gtfs/static/"
POLL_SEC = 15.0
STATIC_REFRESH_SEC = 24 * 3600.0
TTL_SEC = 300  # drop a coach silent for 5 min


def build_trip_map(zip_bytes: bytes) -> dict[str, tuple[str, str | None]]:
    """trips.txt + routes.txt → {trip_id: (route_code, headsign)}. Ember's
    route_short_name is literally "Ember", so the route_id ("E1"…) is the
    useful display label."""
    out: dict[str, tuple[str, str | None]] = {}
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        for row in csv.DictReader(io.TextIOWrapper(z.open("trips.txt"), encoding="utf-8-sig")):
            trip_id = row.get("trip_id")
            if not trip_id:
                continue
            out[trip_id] = (row.get("route_id") or "?", row.get("trip_headsign") or None)
    return out


def parse_feed(
    feed_bytes: bytes, trip_map: dict[str, tuple[str, str | None]], now: float
) -> list[Bus]:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(feed_bytes)
    out: list[Bus] = []
    for entity in feed.entity:
        if not entity.HasField("vehicle"):
            continue
        v = entity.vehicle
        if not v.HasField("position"):
            continue
        lat, lon = v.position.latitude, v.position.longitude
        if not (-90 < lat < 90) or not (-180 < lon < 180) or (lat == 0 and lon == 0):
            continue
        vid = v.vehicle.id or entity.id
        if not vid:
            continue
        route, headsign = trip_map.get(v.trip.trip_id, (v.trip.route_id or None, None))
        out.append(Bus(
            id=f"EMBR:{vid}",
            route=route,
            destination=headsign,
            operator="Ember",
            # GTFS-RT positions are float32 — round off the artifacts (~1 m).
            lat=round(lat, 5),
            lon=round(lon, 5),
            bearing=v.position.bearing if v.position.bearing else None,
            ts=float(v.timestamp) if v.timestamp else now,
        ))
    return out


class EmberSource(Source):
    name = "ember"

    def __init__(self, store: BusStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._trip_map: dict[str, tuple[str, str | None]] = {}
        self._static_fetched = 0.0

    @property
    def configured(self) -> bool:
        return True

    async def _refresh_static(self, client: httpx.AsyncClient) -> None:
        try:
            resp = await client.get(STATIC_URL, follow_redirects=True,
                                    timeout=httpx.Timeout(120.0))
            resp.raise_for_status()
            self._trip_map = build_trip_map(resp.content)
            self._static_fetched = time.time()
            log.info("[ember] static refreshed: %d trips", len(self._trip_map))
        except (httpx.HTTPError, zipfile.BadZipFile, KeyError) as exc:
            # Positions still flow without it — routes just show unnamed.
            log.warning("[ember] static fetch failed: %s", exc)

    async def _consume(self) -> None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                if time.time() - self._static_fetched > STATIC_REFRESH_SEC:
                    await self._refresh_static(client)
                try:
                    resp = await client.get(REALTIME_URL)
                    resp.raise_for_status()
                    now = time.time()
                    for bus in parse_feed(resp.content, self._trip_map, now):
                        self.messages_seen += 1
                        self.last_msg_ts = now
                        await self._store.upsert(bus)
                    await self._store.evict_stale(TTL_SEC)
                except (httpx.HTTPError, ValueError) as exc:
                    log.warning("[ember] realtime fetch failed: %s", exc)
                await asyncio.sleep(POLL_SEC)
