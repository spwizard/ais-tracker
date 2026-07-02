"""Tests for the adsb.lol aircraft parser + store (app/sources/adsblol.py)."""
from __future__ import annotations

import asyncio
import time

from app.sources.adsblol import parse_aircraft
from app.store.aircraft import AircraftStore


def test_parse_full_record():
    now = time.time()
    ac = parse_aircraft(
        {
            "hex": "4CA4EA",
            "flight": "RYR50NB ",  # space-padded, upper hex
            "lat": 50.51,
            "lon": -4.01,
            "track": 348.25,
            "gs": 412.6,
            "alt_baro": 38000,
            "baro_rate": 64,
            "category": "A3",
            "t": "B738",
            "r": "EI-DPF",
            "squawk": "7464",
        },
        now,
    )
    assert ac is not None
    assert ac.hex == "4ca4ea"  # normalised lower-case
    assert ac.callsign == "RYR50NB"  # trimmed
    assert ac.alt_baro == 38000.0 and ac.on_ground is False
    assert ac.ac_type == "B738" and ac.reg == "EI-DPF"
    assert ac.ts == now


def test_parse_on_ground():
    ac = parse_aircraft(
        {"hex": "abc123", "lat": 51.0, "lon": -0.4, "alt_baro": "ground", "gs": 8}, 0.0
    )
    assert ac is not None
    assert ac.on_ground is True
    assert ac.alt_baro is None  # "ground" is not a numeric altitude


def test_parse_drops_positionless_and_hexless():
    # No position → dropped (many ADS-B hits carry only partial data).
    assert parse_aircraft({"hex": "abc", "flight": "X"}, 0.0) is None
    # No hex → dropped (nothing to key on).
    assert parse_aircraft({"lat": 50.0, "lon": -1.0}, 0.0) is None
    # Null-island position → rejected by the shared validity guard.
    assert parse_aircraft({"hex": "abc", "lat": 0.0, "lon": 0.0}, 0.0) is None


def test_store_upsert_snapshot_and_evict():
    async def run():
        store = AircraftStore()
        now = time.time()
        await store.upsert(parse_aircraft({"hex": "a1", "lat": 50.0, "lon": -1.0}, now))
        await store.upsert(
            parse_aircraft({"hex": "a2", "lat": 50.1, "lon": -1.1}, now - 120)
        )
        assert await store.count() == 2
        assert len(await store.snapshot()) == 2
        # a2 is 120s old; evict anything silent > 60s.
        removed = await store.evict_stale(60)
        assert removed == 1
        assert await store.count() == 1

    asyncio.run(run())
