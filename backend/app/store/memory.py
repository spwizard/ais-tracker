"""In-memory vessel store (the default).

Holds everything in plain dicts/deques guarded by an asyncio lock. Perfect for a
single backend instance with zero infra. No persistence, no cross-process
fan-out — that's what the Redis implementation is for.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque

from ..config import get_settings
from ..models import Vessel, VesselUpdate
from .base import VesselStore


class MemoryVesselStore(VesselStore):
    def __init__(self) -> None:
        self._vessels: dict[int, Vessel] = {}
        self._trails: dict[int, deque] = {}
        self._lock = asyncio.Lock()
        self._trail_len = get_settings().trail_len

    async def start(self) -> None:  # nothing to open
        return

    async def close(self) -> None:  # nothing to release
        return

    async def upsert(self, update: VesselUpdate) -> Vessel:
        async with self._lock:
            vessel = self._vessels.get(update.mmsi)
            if vessel is None:
                vessel = Vessel(mmsi=update.mmsi)
                self._vessels[update.mmsi] = vessel
            vessel.merge(update)
            vessel.ts = update.ts
            # Append to the trail only when we have a real position fix.
            if update.lat is not None and update.lon is not None:
                trail = self._trails.setdefault(
                    update.mmsi, deque(maxlen=self._trail_len)
                )
                trail.append([update.lon, update.lat, update.ts])
            return vessel

    async def get(self, mmsi: int) -> Vessel | None:
        return self._vessels.get(mmsi)

    async def snapshot(self) -> list[Vessel]:
        # Only vessels with a known position are useful to render.
        return [v for v in self._vessels.values() if v.lat is not None]

    async def trail(self, mmsi: int) -> list[list[float]]:
        return list(self._trails.get(mmsi, ()))

    async def evict_stale(self, ttl_sec: int) -> int:
        cutoff = time.time() - ttl_sec
        async with self._lock:
            stale = [m for m, v in self._vessels.items() if v.ts < cutoff]
            for mmsi in stale:
                self._vessels.pop(mmsi, None)
                self._trails.pop(mmsi, None)
        return len(stale)

    async def count(self) -> int:
        return len(self._vessels)
