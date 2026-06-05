"""Fintraffic Digitraffic source — free, open AIS for Finnish/Baltic waters,
delivered as decoded JSON over MQTT-over-WebSockets (no auth, CC-BY 4.0)."""
from __future__ import annotations

import json
import logging
import os

import aiomqtt

from ..config import Settings
from ..store.base import VesselStore
from .base import Source
from .digitraffic_parser import parse_location, parse_metadata

log = logging.getLogger("source.digitraffic")


class DigitrafficSource(Source):
    name = "digitraffic"

    def __init__(self, store: VesselStore, settings: Settings) -> None:
        super().__init__(store)
        self._settings = settings

    async def _consume(self) -> None:
        host = self._settings.digitraffic_host
        async with aiomqtt.Client(
            hostname=host,
            port=443,
            transport="websockets",
            websocket_path="/mqtt",
            tls_params=aiomqtt.TLSParameters(),
            identifier=f"ais-tracker-{os.getpid()}",
            keepalive=60,
        ) as client:
            # `vessels-v2/<mmsi>/<location|metadata>` — `+/+` matches both kinds
            # while skipping the 2-level `vessels-v2/status` topic.
            await client.subscribe("vessels-v2/+/+", qos=0)
            self.connected = True
            log.info("digitraffic connected (MQTT wss://%s/mqtt)", host)

            async for message in client.messages:
                parts = str(message.topic).split("/")
                if len(parts) != 3:
                    continue
                _, mmsi_str, kind = parts
                try:
                    mmsi = int(mmsi_str)
                except ValueError:
                    continue
                try:
                    payload = json.loads(message.payload)
                except (json.JSONDecodeError, TypeError):
                    continue

                if kind.startswith("location"):  # "location" / "locations"
                    await self.emit(parse_location(mmsi, payload))
                elif kind == "metadata":
                    await self.emit(parse_metadata(mmsi, payload))
