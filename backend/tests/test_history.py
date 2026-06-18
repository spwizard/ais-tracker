"""Tests for the replay position-history store (app/history.py)."""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app import history
from app.history import TrackHistory, _decimate


def vessel(mmsi, lon, lat, ts, sog=10.0, cog=90.0, heading=88, ship_type=70):
    return SimpleNamespace(
        mmsi=mmsi, lon=lon, lat=lat, sog=sog, cog=cog, heading=heading,
        ship_type=ship_type, ts=ts,
    )


@pytest.fixture()
def store(tmp_path):
    h = TrackHistory(str(tmp_path / "positions.sqlite"), window_sec=3600)
    h.open()
    yield h
    h.close()


def test_sample_and_group_into_tracks(store):
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 120), vessel(2, 5.0, 55.0, now - 120)])
    store.sample([vessel(1, 0.1, 50.0, now - 60), vessel(2, 5.0, 55.0, now - 60)])

    tracks = {t["mmsi"]: t for t in store.tracks(now - 3600, now)}
    assert set(tracks) == {1, 2}
    assert len(tracks[1]["path"]) == 2
    # path point shape: [lon, lat, ts, sog, cog, heading]
    assert tracks[1]["path"][0][:3] == [0.0, 50.0, now - 120]
    assert tracks[1]["ship_type"] == 70


def test_dedup_same_mmsi_ts(store):
    """Re-sampling a vessel that hasn't sent a new fix is a no-op (INSERT OR IGNORE)."""
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 60)])
    store.sample([vessel(1, 0.0, 50.0, now - 30)])
    store.sample([vessel(1, 0.0, 50.0, now - 30)])  # duplicate (mmsi, ts)

    track = store.tracks(now - 3600, now)[0]
    assert len(track["path"]) == 2  # not 3


def test_bbox_filters_out_of_area(store):
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 60), vessel(2, 5.0, 55.0, now - 60)])
    store.sample([vessel(1, 0.05, 50.0, now - 30), vessel(2, 5.0, 55.0, now - 30)])

    inside = store.tracks(now - 3600, now, bbox=(-1.0, 49.0, 1.0, 51.0))
    assert {t["mmsi"] for t in inside} == {1}


def test_prune_drops_points_past_window(store):
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 60), vessel(1, 0.1, 50.0, now - 30)])
    # A point older than the 3600s window should be pruned on the next sample.
    store.sample([vessel(9, 0.0, 50.0, now - 99999)])
    mmsis = {t["mmsi"] for t in store.tracks(now - 200000, now)}
    assert 9 not in mmsis
    assert 1 in mmsis


def test_tracks_need_two_points(store):
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 60)])  # single fix only
    assert store.tracks(now - 3600, now) == []


def test_time_window_excludes_outside_range(store):
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 5000), vessel(1, 0.1, 50.0, now - 4900)])
    store.sample([vessel(2, 0.0, 50.0, now - 100), vessel(2, 0.1, 50.0, now - 50)])
    # Window only covers the last 200s.
    mmsis = {t["mmsi"] for t in store.tracks(now - 200, now)}
    assert mmsis == {2}


def test_span(store):
    assert store.span() is None
    now = int(time.time())
    store.sample([vessel(1, 0.0, 50.0, now - 100), vessel(1, 0.1, 50.0, now - 40)])
    lo, hi = store.span()
    assert lo == now - 100 and hi == now - 40


def test_max_tracks_cap_keeps_longest(store, monkeypatch):
    monkeypatch.setattr(history, "MAX_TRACKS", 2)
    now = int(time.time())
    # 4 vessels with increasing path lengths (2,3,4,5 points).
    for mmsi, n in [(1, 2), (2, 3), (3, 4), (4, 5)]:
        for i in range(n):
            store.sample([vessel(mmsi, 0.01 * i, 50.0, now - 1000 + mmsi * 100 + i)])
    tracks = store.tracks(now - 3600, now)
    assert len(tracks) == 2
    # The two longest tracks (mmsi 3 and 4) survive.
    assert {t["mmsi"] for t in tracks} == {3, 4}


def test_decimate_caps_and_keeps_endpoints():
    path = [[i, i, i] for i in range(5000)]
    out = _decimate(path, 1500)
    assert len(out) == 1500
    assert out[0] == path[0]
    assert out[-1] == path[-1]


def test_decimate_noop_when_under_limit():
    path = [[0, 0, 0], [1, 1, 1]]
    assert _decimate(path, 1500) == path
