"""In-memory train store (rail / land domain).

Mirrors ``BusStore``: each source tick recomputes complete positions, so no
partial-merge. Keyed by service id (Darwin RID or sim id).
"""
from __future__ import annotations

import asyncio
import time

from ..models import Train


class TrainStore:
    def __init__(self) -> None:
        self._trains: dict[str, Train] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return

    async def close(self) -> None:
        return

    async def upsert(self, train: Train) -> Train:
        async with self._lock:
            self._trains[train.id] = train
        return train

    async def get(self, train_id: str) -> Train | None:
        return self._trains.get(train_id)

    async def snapshot(self) -> list[Train]:
        return [t for t in self._trains.values() if t.lat is not None]

    async def evict_stale(self, ttl_sec: int) -> int:
        cutoff = time.time() - ttl_sec
        async with self._lock:
            stale = [i for i, t in self._trains.items() if t.ts < cutoff]
            for i in stale:
                self._trains.pop(i, None)
        return len(stale)

    async def remove(self, train_id: str) -> None:
        async with self._lock:
            self._trains.pop(train_id, None)

    async def count(self) -> int:
        return len(self._trains)
