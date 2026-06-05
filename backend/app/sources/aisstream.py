"""AISStream.io source — the original single-WebSocket feed, now an adapter."""
from __future__ import annotations

import json
import logging

import websockets

from ..ais.parser import parse_message
from ..config import Settings
from ..store.base import VesselStore
from .base import Source

log = logging.getLogger("source.aisstream")


class AisStreamSource(Source):
    name = "aisstream"

    def __init__(self, store: VesselStore, settings: Settings) -> None:
        super().__init__(store)
        self._settings = settings

    @property
    def configured(self) -> bool:
        return bool(self._settings.aisstream_api_key)

    @property
    def subscription(self) -> dict:
        return {
            "APIKey": self._settings.aisstream_api_key,
            "BoundingBoxes": self._settings.ais_bbox,
            "FilterMessageTypes": [
                "PositionReport",
                "StandardClassBPositionReport",
                "ShipStaticData",
            ],
        }

    async def _consume(self) -> None:
        if not self._settings.aisstream_api_key:
            log.warning(
                "AISSTREAM_API_KEY not set — aisstream source idle. "
                "Add a key to backend/.env to receive its data."
            )
            await self._stop.wait()  # idle until shutdown (don't busy-reconnect)
            return

        async with websockets.connect(
            self._settings.aisstream_url,
            ping_interval=20,
            ping_timeout=20,
            max_size=2**22,
        ) as ws:
            await ws.send(json.dumps(self.subscription))
            self.connected = True
            log.info("aisstream connected; subscribed to %s", self._settings.ais_bbox)
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if "error" in msg:
                    log.error("AISStream error: %s", msg["error"])
                    continue
                await self.emit(parse_message(msg))
