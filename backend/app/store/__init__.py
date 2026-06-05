"""Vessel state store selection.

Chooses the concrete implementation based on configuration: Redis when
``REDIS_URL`` is set, otherwise the zero-dependency in-memory store.
"""
from __future__ import annotations

from ..config import get_settings
from .base import VesselStore
from .memory import MemoryVesselStore


def create_store() -> VesselStore:
    settings = get_settings()
    if settings.use_redis:
        from .redis_store import RedisVesselStore

        return RedisVesselStore(settings.redis_url)
    return MemoryVesselStore()


__all__ = ["VesselStore", "create_store", "MemoryVesselStore"]
