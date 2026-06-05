"""Base class for AIS data sources.

Owns the long-lived task, auto-reconnect with exponential backoff, and the
``emit`` path into the store. Subclasses implement ``_consume`` — open one
connection, set ``self.connected``, read messages, and ``await self.emit(update)``
for each. Returning from ``_consume`` (a clean disconnect) triggers a reconnect.
"""
from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod

from ..models import VesselUpdate
from ..store.base import VesselStore

log = logging.getLogger("source")


class Source(ABC):
    name: str = "source"

    def __init__(self, store: VesselStore) -> None:
        self._store = store
        self._registry = None  # set by create_sources; backfills static details
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.connected = False
        self.messages_seen = 0

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
