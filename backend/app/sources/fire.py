"""Live wildfire detections via NASA FIRMS — the fire-domain "eye".

FIRMS publishes near-real-time thermal anomalies (active fire pixels) from the
VIIRS (375 m) and MODIS (1 km) instruments. Like ADS-B this is a *poll*: we ask
the Area API for a CSV of detections inside each region bbox over the last few
days, parse each hot pixel into a ``FireDetection``, and upsert. It reuses the
``Source`` supervisor/backoff/health machinery and shows up in the same
source-health UI. Idles (amber) until ``FIRMS_MAP_KEY`` is set.

Endpoint:
  GET {url}/api/area/csv/{MAP_KEY}/{SOURCE}/{W,S,E,N}/{DAY_RANGE}
Docs: https://firms.modaps.eosdis.nasa.gov/api/area/  (5000 req / 10 min)
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
import time
from datetime import datetime, timezone

import httpx

from ..config import Settings
from ..models import FireDetection
from ..store.fire import FireStore
from .base import Source

log = logging.getLogger("source")

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"

# Satellite code → human label (FIRMS "satellite" column varies by dataset).
_SAT = {
    "N": "S-NPP", "1": "S-NPP", "N20": "NOAA-20", "N21": "NOAA-21",
    "T": "Terra", "A": "Aqua", "Terra": "Terra", "Aqua": "Aqua",
}


def _confidence(raw: str, instrument: str) -> str:
    """Normalise FIRMS confidence. VIIRS is l/n/h; MODIS is an integer 0–100."""
    v = (raw or "").strip().lower()
    if v in ("l", "n", "h"):
        return {"l": "low", "n": "nominal", "h": "high"}[v]
    try:
        pct = int(float(v))
    except (ValueError, TypeError):
        return "nominal"
    return "low" if pct < 30 else ("high" if pct >= 80 else "nominal")


def _acq_epoch(acq_date: str, acq_time: str) -> float:
    """FIRMS gives acq_date=YYYY-MM-DD and acq_time as an unpadded HHMM (UTC)."""
    try:
        hhmm = (acq_time or "0").strip().zfill(4)
        dt = datetime.strptime(f"{acq_date} {hhmm}", "%Y-%m-%d %H%M")
        return dt.replace(tzinfo=timezone.utc).timestamp()
    except (ValueError, TypeError):
        return time.time()


def parse_detection(row: dict, instrument_hint: str) -> FireDetection | None:
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        frp = float(row.get("frp") or 0.0)
    except (KeyError, ValueError, TypeError):
        return None
    instrument = (row.get("instrument") or instrument_hint or "").upper()
    # VIIRS reports brightness in bright_ti4; MODIS in brightness.
    bright = row.get("bright_ti4") or row.get("brightness")
    try:
        brightness = float(bright) if bright else None
    except (ValueError, TypeError):
        brightness = None
    acq = _acq_epoch(row.get("acq_date", ""), row.get("acq_time", ""))
    sat_raw = (row.get("satellite") or "").strip()
    key = f"{lat:.5f},{lon:.5f},{row.get('acq_date','')},{row.get('acq_time','')},{sat_raw}"
    return FireDetection(
        id=hashlib.md5(key.encode()).hexdigest()[:16],
        lat=lat,
        lon=lon,
        frp=round(frp, 1),
        brightness=round(brightness, 1) if brightness is not None else None,
        confidence=_confidence(row.get("confidence", ""), instrument),
        satellite=_SAT.get(sat_raw, sat_raw or "—"),
        instrument="MODIS" if "MODIS" in instrument else "VIIRS",
        daynight=(row.get("daynight") or "D").strip()[:1].upper() or "D",
        acq=acq,
        ts=acq,
    )


class FireSource(Source):
    name = "firms"

    def __init__(self, store: FireStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._url = settings.firms_url.rstrip("/")
        self._key = settings.firms_map_key
        self._sources = settings.fire_sources  # ["VIIRS_NOAA20_NRT", ...]
        self._regions = settings.fire_regions  # [(W, S, E, N), ...]
        self._days = settings.fire_day_range
        self._poll = settings.fire_poll_sec
        self._ttl = settings.fire_ttl_sec
        # Healthy = a message within the last two poll cycles (one missed poll
        # of grace) — not the streaming default of 60 s.
        self.stale_after = self._poll * 2 + 60.0

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def _consume(self) -> None:
        if not self._key:
            await self._stop.wait()  # no map key → idle (amber in the UI)
            return
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(40.0), headers={"User-Agent": _UA}, follow_redirects=True
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                for src in self._sources:
                    for (w, s, e, n) in self._regions:
                        area = f"{w},{s},{e},{n}"
                        url = f"{self._url}/api/area/csv/{self._key}/{src}/{area}/{self._days}"
                        try:
                            resp = await client.get(url)
                            resp.raise_for_status()
                        except httpx.HTTPError as exc:
                            log.warning("[firms] %s fetch failed: %s", src, exc)
                            continue
                        text = resp.text
                        # An invalid key or throttle returns an HTML/error body,
                        # not CSV — guard so we don't parse garbage.
                        if not text.startswith("latitude"):
                            log.warning("[firms] %s unexpected response: %s", src, text[:120])
                            continue
                        now = time.time()
                        for row in csv.DictReader(io.StringIO(text)):
                            det = parse_detection(row, src)
                            if det is None:
                                continue
                            self.messages_seen += 1
                            self.last_msg_ts = now
                            await self._store.upsert(det)
                await self._store.evict_stale(self._ttl)
                await asyncio.sleep(self._poll)
