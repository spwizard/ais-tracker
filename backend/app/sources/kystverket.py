"""Norwegian Coastal Administration (Kystverket) source.

A free, open, no-auth TCP stream of raw AIVDM/AIVDO NMEA sentences for the
Norwegian EEZ. We open a socket, strip optional NMEA tag blocks, reassemble
multipart sentences, decode with pyais, and normalize via the shared mapper.
(This is the same NMEA/TCP shape a commercial stream like Kpler would use.)
"""
from __future__ import annotations

import asyncio
import logging

from pyais import decode as ais_decode

from ..config import Settings
from ..store.base import VesselStore
from .ais_nmea import msg_to_update
from .base import Source

log = logging.getLogger("source.kystverket")

MAX_PENDING_PARTS = 20_000  # safety cap on the multipart reassembly buffer


class KystverketSource(Source):
    name = "kystverket"

    def __init__(self, store: VesselStore, settings: Settings) -> None:
        super().__init__(store)
        self._settings = settings
        self._parts: dict[tuple[bytes, bytes], dict[int, bytes]] = {}

    async def _consume(self) -> None:
        host, port = self._settings.kystverket_host, self._settings.kystverket_port
        reader, writer = await asyncio.open_connection(host, port)
        self.connected = True
        log.info("kystverket connected (tcp %s:%s)", host, port)
        try:
            while not self._stop.is_set():
                raw = await reader.readline()
                if not raw:  # server closed the connection
                    break
                await self._handle_line(raw)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass

    async def _handle_line(self, raw: bytes) -> None:
        line = raw.strip()
        if not line:
            return
        # Strip an optional \tag-block\ prefix (IEC 62320 style).
        if line.startswith(b"\\"):
            end = line.find(b"\\", 1)
            if end != -1:
                line = line[end + 1 :]
        # Kystverket relays as !BSVDM (base-station VDM); accept any talker and
        # normalize it to !AIVDM/!AIVDO so pyais decodes it (payload is identical).
        if len(line) < 6 or not line.startswith(b"!") or line[3:6] not in (b"VDM", b"VDO"):
            return
        if line[1:3] != b"AI":
            line = b"!AI" + line[3:]

        fields = line.split(b",")
        if len(fields) < 6:
            return
        try:
            total, num = int(fields[1]), int(fields[2])
        except ValueError:
            return

        if total == 1:
            frags: list[bytes] | None = [line]
        else:
            key = (fields[3], fields[4])  # sequence id + channel
            buf = self._parts.setdefault(key, {})
            buf[num] = line
            if len(buf) >= total:
                frags = [buf[i] for i in sorted(buf)]
                self._parts.pop(key, None)
            else:
                frags = None
                if len(self._parts) > MAX_PENDING_PARTS:
                    self._parts.clear()  # drop stale half-assembled messages

        if frags is None:
            return
        try:
            msg = ais_decode(*frags)
        except Exception:  # noqa: BLE001 — skip malformed/unsupported sentences
            return
        await self.emit(msg_to_update(msg))
