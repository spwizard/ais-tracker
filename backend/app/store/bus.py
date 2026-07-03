"""In-memory bus store (land domain, BODS SIRI-VM).

The bus analogue of ``AircraftStore``: each poll is a complete snapshot, so no
partial-merge and (for v1) no server-side trails. Keyed by the vehicle id.
"""
from __future__ import annotations

import asyncio
import time

from ..models import Bus


class BusStore:
    def __init__(self) -> None:
        self._buses: dict[str, Bus] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return

    async def close(self) -> None:
        return

    async def upsert(self, bus: Bus) -> Bus:
        async with self._lock:
            self._buses[bus.id] = bus
        return bus

    async def get(self, bus_id: str) -> Bus | None:
        return self._buses.get(bus_id)

    async def snapshot(self) -> list[Bus]:
        return [b for b in self._buses.values() if b.lat is not None]

    async def evict_stale(self, ttl_sec: int) -> int:
        cutoff = time.time() - ttl_sec
        async with self._lock:
            stale = [i for i, b in self._buses.items() if b.ts < cutoff]
            for i in stale:
                self._buses.pop(i, None)
        return len(stale)

    async def count(self) -> int:
        return len(self._buses)
