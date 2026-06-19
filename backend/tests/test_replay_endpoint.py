"""Integration tests for the /api/replay route.

Calls the route coroutine directly with a stubbed app.state, so we exercise the
flag gate, bbox parsing and registry name-join without standing up the full
lifespan (which would open the live AIS feeds)."""
from __future__ import annotations

import asyncio
import time

import pytest
from fastapi import HTTPException

from app import main
from app.history import TrackHistory


class FakeRegistry:
    def __init__(self, names: dict[int, str]) -> None:
        self._names = names

    def name(self, mmsi: int) -> str | None:
        return self._names.get(mmsi)


def vessel(mmsi, lon, lat, ts):
    from types import SimpleNamespace

    return SimpleNamespace(
        mmsi=mmsi, lon=lon, lat=lat, sog=10.0, cog=90.0, heading=88, ship_type=70, ts=ts
    )


@pytest.fixture()
def wired(tmp_path, monkeypatch):
    """A TrackHistory with two vessels + a registry, wired onto app.state."""
    hist = TrackHistory(str(tmp_path / "positions.sqlite"), window_sec=3600)
    hist.open()
    now = int(time.time())
    hist.sample([vessel(1, 0.0, 50.0, now - 120), vessel(2, 5.0, 55.0, now - 120)])
    hist.sample([vessel(1, 0.1, 50.0, now - 60), vessel(2, 5.0, 55.0, now - 60)])

    monkeypatch.setattr(main.app.state, "history", hist, raising=False)
    monkeypatch.setattr(main.app.state, "registry", FakeRegistry({1: "ALPHA"}), raising=False)
    yield now
    hist.close()


def call(start, end, bbox=None):
    return asyncio.run(main.replay(start=start, end=end, bbox=bbox))


def test_flag_off_returns_empty(wired, monkeypatch):
    monkeypatch.setattr(main, "get_flags", lambda: {"replay": False})
    out = call(wired - 3600, wired)
    assert out == {"tracks": [], "span": None}


def test_flag_on_returns_tracks_with_names_and_span(wired, monkeypatch):
    monkeypatch.setattr(main, "get_flags", lambda: {"replay": True})
    out = call(wired - 3600, wired)
    by_mmsi = {t["mmsi"]: t for t in out["tracks"]}
    assert set(by_mmsi) == {1, 2}
    assert by_mmsi[1]["name"] == "ALPHA"  # joined from the registry
    assert by_mmsi[2]["name"] is None  # unknown vessel
    assert out["span"] is not None and out["span"][0] <= out["span"][1]


def test_bbox_filters(wired, monkeypatch):
    monkeypatch.setattr(main, "get_flags", lambda: {"replay": True})
    out = call(wired - 3600, wired, bbox="-1,49,1,51")
    assert {t["mmsi"] for t in out["tracks"]} == {1}


def test_bad_bbox_is_a_400(wired, monkeypatch):
    monkeypatch.setattr(main, "get_flags", lambda: {"replay": True})
    with pytest.raises(HTTPException) as exc:
        call(wired - 3600, wired, bbox="1,2,3")  # only three components
    assert exc.value.status_code == 400
