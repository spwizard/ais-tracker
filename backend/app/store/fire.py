"""In-memory fire store (NASA FIRMS / fire domain).

The fire analogue of ``AircraftStore``, and simpler still: a thermal detection
is a fixed point in space and time, so there's no movement, no merge, no trail.
Keyed by a stable detection hash — re-polling the same window just re-upserts
the same records. Detections age out after their TTL (a fire "cools" off the map
once no satellite has re-detected it within the window).
"""
from __future__ import annotations

import asyncio
import time

from ..models import FireDetection


class FireStore:
    def __init__(self) -> None:
        self._fires: dict[str, FireDetection] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:  # nothing to open
        return

    async def close(self) -> None:  # nothing to release
        return

    async def upsert(self, d: FireDetection) -> FireDetection:
        async with self._lock:
            self._fires[d.id] = d
        return d

    async def get(self, fire_id: str) -> FireDetection | None:
        return self._fires.get(fire_id)

    async def snapshot(self) -> list[FireDetection]:
        return list(self._fires.values())

    async def evict_stale(self, ttl_sec: int) -> int:
        """Drop detections whose acquisition is older than ``ttl_sec`` — the fire
        has cooled (no satellite re-detected it within the window)."""
        cutoff = time.time() - ttl_sec
        async with self._lock:
            stale = [k for k, d in self._fires.items() if d.acq < cutoff]
            for k in stale:
                self._fires.pop(k, None)
        return len(stale)

    async def count(self) -> int:
        return len(self._fires)
