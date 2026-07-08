"""In-memory incident store (the Argus spine).

Keyed by incident id. Full-snapshot sources (like TfL road disruptions) call
``replace_source`` so resolved incidents drop atomically; incremental sources
can ``upsert``. Tracks which ids are newly-seen so the app can toast them once.
"""
from __future__ import annotations

import asyncio

from ..models import Incident


class IncidentStore:
    def __init__(self) -> None:
        self._incidents: dict[str, Incident] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return

    async def close(self) -> None:
        return

    async def upsert(self, inc: Incident) -> bool:
        """Add/update one incident. Returns True if it was newly seen."""
        async with self._lock:
            new = inc.id not in self._incidents
            self._incidents[inc.id] = inc
        return new

    async def replace_source(self, source: str, incidents: list[Incident]) -> list[str]:
        """Swap in the full current set for one source; returns newly-seen ids."""
        async with self._lock:
            keep = {i.id: i for i in incidents}
            existing = {i for i, v in self._incidents.items() if v.source == source}
            new_ids = [i for i in keep if i not in self._incidents]
            # Drop this source's incidents that are gone, keep others untouched.
            for iid in existing:
                if iid not in keep:
                    self._incidents.pop(iid, None)
            self._incidents.update(keep)
        return new_ids

    async def snapshot(self) -> list[Incident]:
        return list(self._incidents.values())

    async def get(self, iid: str) -> Incident | None:
        return self._incidents.get(iid)

    async def count(self) -> int:
        return len(self._incidents)
