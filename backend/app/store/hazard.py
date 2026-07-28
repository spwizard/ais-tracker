"""In-memory hazard store: floods + weather warnings + quakes, replaced
wholesale each poll (the whole point of the layer is what's in force *now*)."""
from __future__ import annotations

import asyncio

from ..models import Hazard


class HazardStore:
    def __init__(self) -> None:
        self._hazards: list[Hazard] = []
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return

    async def close(self) -> None:
        return

    async def replace(self, hazards: list[Hazard]) -> None:
        async with self._lock:
            self._hazards = hazards

    async def snapshot(self) -> list[Hazard]:
        return list(self._hazards)

    async def count(self) -> int:
        return len(self._hazards)
