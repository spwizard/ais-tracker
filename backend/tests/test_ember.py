"""Tests for the Ember coach source (app/sources/ember.py)."""
from __future__ import annotations

import io
import zipfile

from google.transit import gtfs_realtime_pb2

from app.sources.ember import build_trip_map, parse_feed

NOW = 1_785_253_000.0


def _static_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("trips.txt", "trip_id,route_id,trip_headsign\n4Xw7u6x,E7,Aberdeen\nZLhRTWY,E1,Edinburgh\n")
        z.writestr("routes.txt", "route_id,route_short_name,route_long_name\nE7,Ember,Between Aberdeen and Inverness\n")
    return buf.getvalue()


def _feed(entries) -> bytes:
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    for i, (vid, trip_id, lat, lon, brg, ts) in enumerate(entries):
        e = feed.entity.add()
        e.id = str(i)
        v = e.vehicle
        v.vehicle.id = vid
        v.trip.trip_id = trip_id
        v.position.latitude = lat
        v.position.longitude = lon
        if brg is not None:
            v.position.bearing = brg
        v.timestamp = int(ts)
    return feed.SerializeToString()


def test_trip_map_from_static():
    m = build_trip_map(_static_zip())
    assert m["4Xw7u6x"] == ("E7", "Aberdeen")
    assert m["ZLhRTWY"] == ("E1", "Edinburgh")


def test_parse_feed_resolves_routes():
    trip_map = build_trip_map(_static_zip())
    buses = parse_feed(_feed([
        ("SG23 ORT", "4Xw7u6x", 57.358, -2.578, 131.0, NOW - 20),
        ("SG24 XYZ", "unknown-trip", 56.0, -3.4, None, 0),  # no ts, unmapped trip
    ]), trip_map, NOW)
    assert len(buses) == 2
    a, b = buses
    assert a.id == "EMBR:SG23 ORT" and a.operator == "Ember"
    assert a.route == "E7" and a.destination == "Aberdeen"
    assert abs(a.lat - 57.358) < 1e-4 and a.bearing == 131.0  # float32 wire precision
    assert a.ts == NOW - 20  # feed timestamp preferred
    assert b.route is None and b.destination is None  # unmapped stays honest
    assert b.ts == NOW  # missing timestamp falls back to poll time


def test_parse_feed_drops_junk_positions():
    buses = parse_feed(_feed([
        ("V1", "t", 0.0, 0.0, None, NOW),  # null island
        ("", "t", 56.0, -3.0, None, NOW),  # no vehicle id (entity id used)
    ]), {}, NOW)
    # Null-island dropped; the id-less one falls back to the entity id ("1").
    assert len(buses) == 1
    assert buses[0].id == "EMBR:1"
