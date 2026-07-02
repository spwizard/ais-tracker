"""Fan-out of vessel updates to all connected browser clients.

A single async loop ticks at ``BROADCAST_HZ`` and pushes one batched frame to
every client — far cheaper than forwarding each upstream AIS message. New
clients first receive a full snapshot so their map is warm immediately.

Wire frame format (JSON):
  {"type": "snapshot", "vessels": [ ... ]}                 # on connect
  {"type": "update",   "vessels": [ ... ], "removed": [..]}# every tick

When an aircraft (ADS-B) store is attached, the air domain is fanned out on the
same socket with parallel, independently-diffed frames:
  {"type": "air_snapshot", "aircraft": [ ... ]}                  # on connect
  {"type": "air_update",   "aircraft": [ ... ], "removed": [..]} # every tick
"""
from __future__ import annotations

import asyncio
import logging
from typing import Callable

from fastapi import WebSocket

log = logging.getLogger("ws.broadcaster")

# Frame types that represent a persistable alert.
_ALERT_FRAMES = ("geofence_event", "risk_event")


class Broadcaster:
    def __init__(self, store, hz: float, air_store=None) -> None:
        self._store = store
        self._air_store = air_store  # optional AircraftStore (ADS-B domain)
        self._interval = 1.0 / max(hz, 0.1)
        self._clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        # Track what each vessel/aircraft looked like last tick to send only changes.
        self._last_sent: dict[int, float] = {}  # mmsi -> ts last broadcast
        self._last_sent_air: dict[str, float] = {}  # hex -> ts last broadcast
        # Optional sink that persists alert frames (set by the app).
        self.alert_sink: Callable[[dict], None] | None = None

    # --- lifecycle --------------------------------------------------------
    def start(self) -> None:
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="broadcaster")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    # --- client registry --------------------------------------------------
    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)
        # Warm start: send the full current picture immediately.
        vessels = await self._store.snapshot()
        await ws.send_json(
            {"type": "snapshot", "vessels": [v.model_dump() for v in vessels]}
        )
        if self._air_store is not None:
            aircraft = await self._air_store.snapshot()
            await ws.send_json(
                {"type": "air_snapshot", "aircraft": [a.model_dump() for a in aircraft]}
            )

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    @property
    def client_count(self) -> int:
        return len(self._clients)

    # --- broadcast loop ---------------------------------------------------
    async def _loop(self) -> None:
        while not self._stop.is_set():
            await asyncio.sleep(self._interval)
            if not self._clients:
                continue
            try:
                await self._tick()
            except Exception as exc:  # noqa: BLE001
                log.warning("broadcast tick failed: %s", exc)

    async def _tick(self) -> None:
        await self._tick_vessels()
        if self._air_store is not None:
            await self._tick_aircraft()

    async def _tick_vessels(self) -> None:
        vessels = await self._store.snapshot()
        current_ids = {v.mmsi for v in vessels}

        # Only send vessels whose timestamp advanced since we last sent them.
        changed = [v for v in vessels if self._last_sent.get(v.mmsi) != v.ts]
        removed = [m for m in self._last_sent if m not in current_ids]

        for v in vessels:
            self._last_sent[v.mmsi] = v.ts
        for m in removed:
            self._last_sent.pop(m, None)

        if not changed and not removed:
            return

        frame = {
            "type": "update",
            "vessels": [v.model_dump() for v in changed],
            "removed": removed,
        }
        await self._broadcast(frame)

    async def _tick_aircraft(self) -> None:
        aircraft = await self._air_store.snapshot()
        current_ids = {a.hex for a in aircraft}

        changed = [a for a in aircraft if self._last_sent_air.get(a.hex) != a.ts]
        removed = [h for h in self._last_sent_air if h not in current_ids]

        for a in aircraft:
            self._last_sent_air[a.hex] = a.ts
        for h in removed:
            self._last_sent_air.pop(h, None)

        if not changed and not removed:
            return

        await self._broadcast(
            {
                "type": "air_update",
                "aircraft": [a.model_dump() for a in changed],
                "removed": removed,
            }
        )

    async def send_frame(self, frame: dict) -> None:
        """Push an out-of-band frame (e.g. a geofence event) to all clients now,
        persisting it first if it's an alert."""
        if self.alert_sink is not None and frame.get("type") in _ALERT_FRAMES:
            try:
                self.alert_sink(frame)
            except Exception as exc:  # noqa: BLE001
                log.warning("alert sink failed: %s", exc)
        await self._broadcast(frame)

    async def _broadcast(self, frame: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_json(frame)
            except Exception:  # noqa: BLE001 — client gone / slow
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
