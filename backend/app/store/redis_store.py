"""Redis-backed vessel store (opt-in via ``REDIS_URL``).

Layout per vessel:
  * ``vessel:<mmsi>``        Hash   — full current state (JSON-encoded values)
  * ``trail:<mmsi>``         List   — capped recent positions "lon,lat,ts"
  * ``vessels:geo``          GeoSet — MMSI indexed by position for viewport queries
  * ``vessels:active``       ZSet   — MMSI -> last-seen ts, used for stale eviction

State survives backend restarts and is ready for multi-instance fan-out later
(via Redis pub/sub) without changing any callers.
"""
from __future__ import annotations

import json
import time

import redis.asyncio as redis

from ..config import get_settings
from ..models import Vessel, VesselUpdate
from .base import VesselStore


def _key(mmsi: int) -> str:
    return f"vessel:{mmsi}"


def _trail_key(mmsi: int) -> str:
    return f"trail:{mmsi}"


GEO_KEY = "vessels:geo"
ACTIVE_KEY = "vessels:active"


class RedisVesselStore(VesselStore):
    def __init__(self, url: str) -> None:
        self._url = url
        self._r: redis.Redis | None = None
        settings = get_settings()
        self._trail_len = settings.trail_len
        self._ttl = settings.vessel_ttl_sec

    async def start(self) -> None:
        self._r = redis.from_url(self._url, decode_responses=True)
        await self._r.ping()

    async def close(self) -> None:
        if self._r is not None:
            await self._r.aclose()

    async def upsert(self, update: VesselUpdate) -> Vessel:
        assert self._r is not None
        raw = await self._r.hgetall(_key(update.mmsi))
        vessel = _vessel_from_hash(update.mmsi, raw) if raw else Vessel(mmsi=update.mmsi)
        vessel.merge(update)
        vessel.ts = update.ts

        pipe = self._r.pipeline()
        pipe.hset(_key(update.mmsi), mapping=_vessel_to_hash(vessel))
        pipe.expire(_key(update.mmsi), self._ttl)
        pipe.zadd(ACTIVE_KEY, {str(update.mmsi): update.ts})
        if update.lat is not None and update.lon is not None:
            pipe.geoadd(GEO_KEY, (update.lon, update.lat, str(update.mmsi)))
            tkey = _trail_key(update.mmsi)
            pipe.rpush(tkey, f"{update.lon},{update.lat},{update.ts}")
            pipe.ltrim(tkey, -self._trail_len, -1)
            pipe.expire(tkey, self._ttl)
        await pipe.execute()
        return vessel

    async def get(self, mmsi: int) -> Vessel | None:
        assert self._r is not None
        raw = await self._r.hgetall(_key(mmsi))
        return _vessel_from_hash(mmsi, raw) if raw else None

    async def snapshot(self) -> list[Vessel]:
        assert self._r is not None
        mmsis = await self._r.zrange(ACTIVE_KEY, 0, -1)
        if not mmsis:
            return []
        pipe = self._r.pipeline()
        for m in mmsis:
            pipe.hgetall(_key(int(m)))
        rows = await pipe.execute()
        vessels = []
        for m, raw in zip(mmsis, rows):
            if raw:
                v = _vessel_from_hash(int(m), raw)
                if v.lat is not None:
                    vessels.append(v)
        return vessels

    async def trail(self, mmsi: int) -> list[list[float]]:
        assert self._r is not None
        items = await self._r.lrange(_trail_key(mmsi), 0, -1)
        out = []
        for item in items:
            lon, lat, ts = item.split(",")
            out.append([float(lon), float(lat), float(ts)])
        return out

    async def evict_stale(self, ttl_sec: int) -> int:
        assert self._r is not None
        cutoff = time.time() - ttl_sec
        stale = await self._r.zrangebyscore(ACTIVE_KEY, 0, cutoff)
        if not stale:
            return 0
        pipe = self._r.pipeline()
        for m in stale:
            pipe.delete(_key(int(m)), _trail_key(int(m)))
            pipe.zrem(ACTIVE_KEY, m)
            pipe.zrem(GEO_KEY, m)
        await pipe.execute()
        return len(stale)

    async def count(self) -> int:
        assert self._r is not None
        return await self._r.zcard(ACTIVE_KEY)


# --- (de)serialisation helpers ------------------------------------------------
# Hash values are stored as JSON so numbers/None round-trip cleanly.

def _vessel_to_hash(v: Vessel) -> dict[str, str]:
    return {k: json.dumps(val) for k, val in v.model_dump().items() if val is not None}


def _vessel_from_hash(mmsi: int, raw: dict[str, str]) -> Vessel:
    data = {"mmsi": mmsi}
    for k, val in raw.items():
        try:
            data[k] = json.loads(val)
        except (json.JSONDecodeError, TypeError):
            data[k] = val
    return Vessel(**data)
