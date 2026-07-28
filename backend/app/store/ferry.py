"""In-memory ferry-route store: a small, slow-changing list of routes with
service status. Replaced wholesale each poll (routes don't come and go), so
there's no per-entity merge — the simplest store in the app."""
from __future__ import annotations

import asyncio

from ..models import FerryRoute


class FerryStore:
    def __init__(self) -> None:
        self._routes: list[FerryRoute] = []
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        return

    async def close(self) -> None:
        return

    async def replace(self, routes: list[FerryRoute]) -> None:
        async with self._lock:
            self._routes = routes

    async def snapshot(self) -> list[FerryRoute]:
        return list(self._routes)

    async def count(self) -> int:
        return len(self._routes)
