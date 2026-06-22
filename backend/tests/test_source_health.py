"""Tests for source position-sanitising and stale-feed health (app/sources/base.py)."""
from __future__ import annotations

import time

import pytest

from app.sources.base import Source, _valid_position, STALE_AFTER_SEC
from app.models import VesselUpdate


@pytest.mark.parametrize(
    "lat,lon,ok",
    [
        (50.2, -1.0, True),
        (-33.9, 18.4, True),
        (0.0, 0.0, False),       # null island
        (91.0, 181.0, False),    # AIS "not available" sentinel
        (95.0, 10.0, False),     # lat out of range
        (10.0, 200.0, False),    # lon out of range
        (None, 5.0, False),
        (5.0, None, False),
    ],
)
def test_valid_position(lat, lon, ok):
    assert _valid_position(lat, lon) is ok


class _StubStore:
    def __init__(self):
        self.upserts = []

    async def upsert(self, update):
        self.upserts.append(update)


class _Src(Source):
    name = "stub"

    async def _consume(self):  # pragma: no cover - not exercised
        return


async def _emit(src, update):
    await src.emit(update)


def test_emit_nulls_invalid_position():
    import asyncio

    src = _Src(_StubStore())
    asyncio.run(_emit(src, VesselUpdate(mmsi=1, lat=91.0, lon=181.0, name="GHOST")))
    stored = src._store.upserts[0]
    # Position dropped, but the static field (name) still flows through.
    assert stored.lat is None and stored.lon is None
    assert stored.name == "GHOST"
    assert src.messages_seen == 1  # still counts — the feed is alive


def test_emit_keeps_valid_position():
    import asyncio

    src = _Src(_StubStore())
    asyncio.run(_emit(src, VesselUpdate(mmsi=2, lat=60.1, lon=24.9)))
    stored = src._store.upserts[0]
    assert stored.lat == 60.1 and stored.lon == 24.9


def test_receiving_reflects_recent_message():
    src = _Src(_StubStore())
    assert src.receiving is False  # never connected/received

    src.connected = True
    src.last_msg_ts = time.time()
    assert src.receiving is True  # connected + fresh message

    src.last_msg_ts = time.time() - STALE_AFTER_SEC - 5
    assert src.receiving is False  # connected but silent → stale

    src.connected = False
    src.last_msg_ts = time.time()
    assert src.receiving is False  # fresh but not connected
