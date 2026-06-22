"""Base class for AIS data sources.

Owns the long-lived task, auto-reconnect with exponential backoff, and the
``emit`` path into the store. Subclasses implement ``_consume`` — open one
connection, set ``self.connected``, read messages, and ``await self.emit(update)``
for each. Returning from ``_consume`` (a clean disconnect) triggers a reconnect.
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod

from ..models import VesselUpdate
from ..store.base import VesselStore

log = logging.getLogger("source")

# A source that's connected but has had no message for this long is "stale" —
# the socket is open but no data is flowing (e.g. AISStream accepting the
# connection while delivering nothing). Reported separately from `connected`.
STALE_AFTER_SEC = 60.0


def _valid_position(lat: float | None, lon: float | None) -> bool:
    """True for a usable fix. Rejects AIS 'not available' sentinels (lat 91 /
    lon 181), out-of-range values, and null-island (0, 0) — all junk on a map."""
    if lat is None or lon is None:
        return False
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        return False
    if lat == 0.0 and lon == 0.0:
        return False
    return True


class Source(ABC):
    name: str = "source"

    def __init__(self, store: VesselStore) -> None:
        self._store = store
        self._registry = None  # set by create_sources; backfills static details
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.connected = False
        self.messages_seen = 0
        self.last_msg_ts = 0.0  # epoch seconds of the most recent message

    @property
    def receiving(self) -> bool:
        """Connected AND actually delivering data (not a silent/zombie socket)."""
        return self.connected and (time.time() - self.last_msg_ts) < STALE_AFTER_SEC

    @property
    def configured(self) -> bool:
        """False when required credentials/config are missing (source stays idle)."""
        return True

    def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._supervise(), name=f"src-{self.name}")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def emit(self, update: VesselUpdate | None) -> None:
        """Normalize → store. Subclasses call this for every parsed message."""
        if update is None:
            return
        self.messages_seen += 1
        self.last_msg_ts = time.time()  # proves the feed is alive, even if junk
        # Drop unusable positions so vessels never render at (0,0) or the 91/181
        # "not available" sentinels; static fields in the message still merge.
        if update.lat is not None and not _valid_position(update.lat, update.lon):
            update.lat = None
            update.lon = None
        if self._registry is not None:
            self._registry.record(update)  # remember any static in this message
            self._registry.enrich(update)  # backfill missing static from history
        await self._store.upsert(update)

    async def _supervise(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            try:
                await self._consume()
                backoff = 1.0  # clean disconnect — reset backoff
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — log & retry any upstream failure
                log.warning("[%s] connection error: %s", self.name, exc)
            finally:
                self.connected = False
            if self._stop.is_set():
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    @abstractmethod
    async def _consume(self) -> None:
        """Open one upstream connection and read until it closes."""
