"""The ``VesselStore`` interface.

A deliberately small surface so the in-memory and Redis implementations stay
interchangeable. When a second data source or history layer arrives later, this
is the seam new behaviour hangs off — no caller changes required.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from ..models import Vessel, VesselUpdate


class VesselStore(ABC):
    @abstractmethod
    async def start(self) -> None:
        """Open connections / warm caches. Safe to call once at startup."""

    @abstractmethod
    async def close(self) -> None:
        """Release resources at shutdown."""

    @abstractmethod
    async def upsert(self, update: VesselUpdate) -> Vessel:
        """Merge a partial update and return the full current vessel state."""

    @abstractmethod
    async def get(self, mmsi: int) -> Vessel | None:
        ...

    @abstractmethod
    async def snapshot(self) -> list[Vessel]:
        """All currently-known vessels (used to warm-start new clients)."""

    @abstractmethod
    async def trail(self, mmsi: int) -> list[list[float]]:
        """Recent track for one vessel as ``[[lon, lat, ts], ...]`` (oldest first)."""

    @abstractmethod
    async def evict_stale(self, ttl_sec: int) -> int:
        """Drop vessels silent for longer than ``ttl_sec``. Returns count removed."""

    @abstractmethod
    async def count(self) -> int:
        ...
