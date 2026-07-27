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
    def __init__(
        self, store, hz: float, air_store=None, bus_store=None, train_store=None,
        tube_store=None, incident_store=None, fire_store=None,
    ) -> None:
        self._store = store
        self._air_store = air_store  # optional AircraftStore (ADS-B domain)
        self._fire_store = fire_store  # optional FireStore (NASA FIRMS domain)
        self._bus_store = bus_store  # optional BusStore (land domain)
        self._train_store = train_store  # optional TrainStore (rail domain)
        self._tube_store = tube_store  # optional TubeStore (London Underground)
        self._incident_store = incident_store  # optional IncidentStore (Argus spine)
        self._interval = 1.0 / max(hz, 0.1)
        self._clients: set[WebSocket] = set()
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        # Track what each entity looked like last tick to send only changes.
        self._last_sent: dict[int, float] = {}  # mmsi -> ts last broadcast
        self._last_sent_air: dict[str, float] = {}  # hex -> ts last broadcast
        self._last_sent_bus: dict[str, float] = {}  # bus id -> ts last broadcast
        self._last_sent_train: dict[str, float] = {}  # train id -> ts last broadcast
        self._last_sent_tube: dict[str, float] = {}  # tube train id -> ts last broadcast
        self._last_sent_incident: dict[str, float] = {}  # incident id -> updated last broadcast
        self._last_sent_fire: dict[str, float] = {}  # detection id -> ts last broadcast
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
        if self._bus_store is not None:
            buses = await self._bus_store.snapshot()
            await ws.send_json(
                {"type": "bus_snapshot", "buses": [b.model_dump() for b in buses]}
            )
        if self._train_store is not None:
            trains = await self._train_store.snapshot()
            await ws.send_json(
                {"type": "train_snapshot", "trains": [t.model_dump() for t in trains]}
            )
        if self._tube_store is not None:
            tubes = await self._tube_store.snapshot()
            await ws.send_json(
                {"type": "tube_snapshot", "trains": [t.model_dump() for t in tubes]}
            )
        if self._incident_store is not None:
            incs = await self._incident_store.snapshot()
            await ws.send_json(
                {"type": "incident_snapshot", "incidents": [i.model_dump() for i in incs]}
            )
        if self._fire_store is not None:
            fires = await self._fire_store.snapshot()
            await ws.send_json(
                {"type": "fire_snapshot", "fires": [f.model_dump() for f in fires]}
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
        if self._bus_store is not None:
            await self._tick_buses()
        if self._train_store is not None:
            await self._tick_trains()
        if self._tube_store is not None:
            await self._tick_tube()
        if self._incident_store is not None:
            await self._tick_incidents()
        if self._fire_store is not None:
            await self._tick_fires()

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

    async def _tick_buses(self) -> None:
        buses = await self._bus_store.snapshot()
        current_ids = {b.id for b in buses}

        changed = [b for b in buses if self._last_sent_bus.get(b.id) != b.ts]
        removed = [i for i in self._last_sent_bus if i not in current_ids]

        for b in buses:
            self._last_sent_bus[b.id] = b.ts
        for i in removed:
            self._last_sent_bus.pop(i, None)

        if not changed and not removed:
            return

        await self._broadcast(
            {
                "type": "bus_update",
                "buses": [b.model_dump() for b in changed],
                "removed": removed,
            }
        )

    async def _tick_trains(self) -> None:
        trains = await self._train_store.snapshot()
        current_ids = {t.id for t in trains}

        changed = [t for t in trains if self._last_sent_train.get(t.id) != t.ts]
        removed = [i for i in self._last_sent_train if i not in current_ids]

        for t in trains:
            self._last_sent_train[t.id] = t.ts
        for i in removed:
            self._last_sent_train.pop(i, None)

        if not changed and not removed:
            return

        await self._broadcast(
            {
                "type": "train_update",
                "trains": [t.model_dump() for t in changed],
                "removed": removed,
            }
        )

    async def _tick_tube(self) -> None:
        tubes = await self._tube_store.snapshot()
        current_ids = {t.id for t in tubes}

        changed = [t for t in tubes if self._last_sent_tube.get(t.id) != t.ts]
        removed = [i for i in self._last_sent_tube if i not in current_ids]

        for t in tubes:
            self._last_sent_tube[t.id] = t.ts
        for i in removed:
            self._last_sent_tube.pop(i, None)

        if not changed and not removed:
            return

        await self._broadcast(
            {
                "type": "tube_update",
                "trains": [t.model_dump() for t in changed],
                "removed": removed,
            }
        )

    async def _tick_incidents(self) -> None:
        incs = await self._incident_store.snapshot()
        current_ids = {i.id for i in incs}
        changed = [i for i in incs if self._last_sent_incident.get(i.id) != i.updated]
        removed = [i for i in self._last_sent_incident if i not in current_ids]
        for i in incs:
            self._last_sent_incident[i.id] = i.updated
        for i in removed:
            self._last_sent_incident.pop(i, None)
        if not changed and not removed:
            return
        await self._broadcast({
            "type": "incident_update",
            "incidents": [i.model_dump() for i in changed],
            "removed": removed,
        })

    async def _tick_fires(self) -> None:
        fires = await self._fire_store.snapshot()
        current_ids = {f.id for f in fires}
        # A detection never changes, so ts differs only for genuinely new pixels.
        changed = [f for f in fires if self._last_sent_fire.get(f.id) != f.ts]
        removed = [i for i in self._last_sent_fire if i not in current_ids]
        for f in fires:
            self._last_sent_fire[f.id] = f.ts
        for i in removed:
            self._last_sent_fire.pop(i, None)
        if not changed and not removed:
            return
        await self._broadcast(
            {
                "type": "fire_update",
                "fires": [f.model_dump() for f in changed],
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
