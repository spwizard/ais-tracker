"""In-memory aircraft store (ADS-B / air domain).

The air-traffic analogue of ``MemoryVesselStore``, but simpler: adsb.lol polls
return a complete record per aircraft, so there's no partial-merge and (for v1)
no trails. Keyed by the ICAO24 hex. Single backend instance, zero infra.
"""
from __future__ import annotations

import asyncio
import time

from ..models import Aircraft


class AircraftStore:
    def __init__(self) -> None:
        self._aircraft: dict[str, Aircraft] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:  # nothing to open
        return

    async def close(self) -> None:  # nothing to release
        return

    async def upsert(self, ac: Aircraft) -> Aircraft:
        """Replace the record for this aircraft (each poll is a full snapshot)."""
        async with self._lock:
            self._aircraft[ac.hex] = ac
        return ac

    async def get(self, hexid: str) -> Aircraft | None:
        return self._aircraft.get(hexid.lower())

    async def snapshot(self) -> list[Aircraft]:
        # Only aircraft with a known position are useful to render.
        return [a for a in self._aircraft.values() if a.lat is not None]

    async def evict_stale(self, ttl_sec: int) -> int:
        """Drop aircraft not heard from within ``ttl_sec`` (they've left coverage).
        Aircraft update ~1/sec, so this TTL is far shorter than the vessel one."""
        cutoff = time.time() - ttl_sec
        async with self._lock:
            stale = [h for h, a in self._aircraft.items() if a.ts < cutoff]
            for h in stale:
                self._aircraft.pop(h, None)
        return len(stale)

    async def count(self) -> int:
        return len(self._aircraft)
