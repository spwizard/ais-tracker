"""Live aircraft (ADS-B) via adsb.lol — a free, no-key, ADSBExchange-compatible
aggregator.

Unlike the AIS feeds (push websockets), this *polls* a point+radius every few
seconds and upserts a full ``Aircraft`` record per hit. It reuses ``Source``'s
supervisor / exponential-backoff / health machinery, but writes into an
``AircraftStore`` instead of the vessel store — so it shows up in the same
source-health UI (``/api/sources``) for free. adsb.lol asks for non-commercial
use only; the app is a research/monitoring tool.

Endpoint: ``GET {url}/v2/point/{lat}/{lon}/{radius_nm}`` → ``{"ac": [ ... ]}``.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from ..config import Settings
from ..models import Aircraft
from ..store.aircraft import AircraftStore
from .base import Source, _valid_position

log = logging.getLogger("source")

_UA = "ais-tracker (https://github.com/spwizard/ais-tracker)"


def _num(v) -> float | None:
    """Coerce a numeric field to float, or None if absent/non-numeric."""
    return float(v) if isinstance(v, (int, float)) else None


def parse_aircraft(raw: dict, now: float) -> Aircraft | None:
    """Map one adsb.lol/readsb aircraft object to an ``Aircraft``. Drops entries
    without a usable position (many hits carry only partial data)."""
    hexid = (raw.get("hex") or "").strip().lower()
    if not hexid:
        return None
    lat, lon = raw.get("lat"), raw.get("lon")
    if not _valid_position(lat, lon):
        return None
    # alt_baro is an int (feet) or the string "ground".
    alt = raw.get("alt_baro")
    on_ground = alt == "ground"
    alt_baro = _num(alt) if not on_ground else None
    flight = (raw.get("flight") or "").strip() or None
    return Aircraft(
        hex=hexid,
        callsign=flight,
        lat=float(lat),
        lon=float(lon),
        track=_num(raw.get("track")),
        gs=_num(raw.get("gs")),
        alt_baro=alt_baro,
        baro_rate=_num(raw.get("baro_rate")),
        on_ground=on_ground,
        category=raw.get("category") or None,
        ac_type=raw.get("t") or None,
        reg=raw.get("r") or None,
        squawk=raw.get("squawk") or None,
        ts=now,
    )


class AdsbLolSource(Source):
    name = "adsb.lol"

    # The base type-hints the store as VesselStore; the aircraft store shares the
    # exact same health/supervisor surface, so subclassing is the DRY choice.
    def __init__(self, store: AircraftStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._url = settings.adsb_url.rstrip("/")
        self._regions = settings.air_regions  # [(lat, lon, radius_nm), ...]
        self._poll = settings.air_poll_sec
        self._ttl = settings.air_ttl_sec

    async def _consume(self) -> None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                # Sweep every region each cycle; the store (keyed by hex) dedupes
                # aircraft that straddle two circles.
                for lat, lon, radius in self._regions:
                    resp = await client.get(f"{self._url}/v2/point/{lat}/{lon}/{radius}")
                    resp.raise_for_status()
                    now = time.time()
                    for raw in resp.json().get("ac") or []:
                        ac = parse_aircraft(raw, now)
                        if ac is None:
                            continue
                        self.messages_seen += 1
                        self.last_msg_ts = now
                        await self._store.upsert(ac)
                # Evict once per full cycle — anything not seen in any region for
                # longer than the TTL has left coverage.
                await self._store.evict_stale(self._ttl)
                await asyncio.sleep(self._poll)
