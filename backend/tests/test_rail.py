"""Rail Tier-1: interpolation engine + simulated source sanity."""
import time

from app.rail.interpolate import CallingPoint, position_at
from app.rail.stations import stations_by_crs
from app.sources.rail_sim import SimRailSource
from app.config import Settings
from app.store.train import TrainStore


def _pts(t0: float) -> list[CallingPoint]:
    # Two stops 1000s apart: (50,0) -> (51,0) (due north).
    return [
        CallingPoint("AAA", "A", 50.0, 0.0, t0),
        CallingPoint("BBB", "B", 51.0, 0.0, t0 + 1000),
    ]


def test_midpoint_position_and_bearing():
    t0 = 1_000_000.0
    fix = position_at(_pts(t0), t0 + 500)
    assert abs(fix.lat - 50.5) < 1e-6
    assert abs(fix.lon) < 1e-9
    assert abs(fix.bearing - 0.0) < 1.0  # due north
    assert fix.speed_kn > 100  # 111km in 1000s is fast — sanity only
    assert fix.next_idx == 1


def test_clamps_before_and_after():
    t0 = 1_000_000.0
    before = position_at(_pts(t0), t0 - 60)
    after = position_at(_pts(t0), t0 + 5000)
    assert (before.lat, before.speed_kn) == (50.0, 0.0)
    assert (after.lat, after.speed_kn) == (51.0, 0.0)


def test_stations_load_and_sim_produces_trains():
    stations = stations_by_crs()
    assert len(stations) > 2000
    assert "PAD" in stations and "EDB" in stations

    src = SimRailSource(TrainStore(), Settings())
    trains = src._services_now(time.time())
    assert len(trains) > 10  # several routes × both directions × en-route services
    t = trains[0]
    assert t.sim and t.lat is not None and t.lon is not None
    assert len(t.stops) >= 2
    # All positions must be inside the GB bounding box.
    for tr in trains:
        assert 49.5 < tr.lat < 59.5 and -8.5 < tr.lon < 2.0
