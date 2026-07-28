"""Tests for the Traffic Scotland road eye (app/sources/scot_road.py).

Sample rows are trimmed copies of real /tsis/ responses captured 2026-07-28.
"""
from __future__ import annotations

from app.sources.scot_road import (
    parse_bridges,
    parse_incidents,
    parse_roadworks,
    parse_snowgates,
)

NOW = 1_785_230_000.0


def test_parse_incident_real_shape():
    rows = [{
        "sid": "11",
        "start_time": "1785228763",
        "last_modified": "1785228868",
        "road_name": "A720",
        "lat": "55.911422965813",
        "lng": "-3.283523535104",
        "location_name": "A720(W) Calder",
        "region_name": "SW Scotland, Lothian and Borders",
        "description": "The A720 is currently restricted westbound due to debris.",
        "direction_name": "Westbound",
        "incident_id": "c498878",
        "incident_type_name": "Hazard",
    }]
    out = parse_incidents(rows, NOW)
    assert len(out) == 1
    i = out[0]
    assert i.id == "scot-road:c498878"
    assert i.source == "scot-road" and i.confidence == "official"
    assert i.category == "hazard" and i.severity == "moderate"
    assert i.title == "A720(W) Calder"
    assert i.lat == 55.911422965813 and i.lon == -3.283523535104
    assert i.ts == 1_785_228_763.0 and i.updated == 1_785_228_868.0
    assert "Westbound" in (i.location or "")


def test_parse_incident_rejects_bad_coords():
    # Junk / out-of-Scotland coordinates never become pins.
    rows = [
        {"incident_id": "x1", "lat": "0", "lng": "0", "incident_type_name": "Queue"},
        {"incident_id": "x2", "lat": "51.5", "lng": "-0.1", "incident_type_name": "Queue"},
        {"incident_id": "x3", "lat": "not-a-number", "lng": "-4", "incident_type_name": "Queue"},
    ]
    assert parse_incidents(rows, NOW) == []


def test_roadworks_keep_only_delaying():
    base = {"lat": "56.3739", "lng": "-4.0058", "location_name": "A85 Tullybannocher",
            "direction_text": "Westbound", "sid": "279"}
    quiet = {**base, "delay_information": "No reported delay.", "roadwork_id": "q1"}
    slow = {**base, "delay_information": "Delays likely.", "roadwork_id": "d1",
            "description": "Works:<br>Carriageway Patching<br><br>Traffic Management:<br>TTLS."}
    out = parse_roadworks([quiet, slow], NOW)
    assert len(out) == 1
    w = out[0]
    assert w.id == "scot-road:rw:d1" and w.category == "works" and w.severity == "minor"
    assert "Delays likely." in (w.detail or "")
    assert "<br>" not in (w.detail or "")  # HTML flattened


def test_snowgates_only_closed_surface():
    gates = [
        {"sid": "32", "lat": "56.680283", "lng": "-5.094964", "currentStatus": "Open",
         "route": "A82", "realWorldLocation": "Glencoe", "direction": "North and South"},
        {"sid": "33", "lat": "56.9", "lng": "-4.2", "currentStatus": "Closed",
         "route": "A9", "realWorldLocation": "Drumochter", "direction": "Both"},
    ]
    out = parse_snowgates(gates, NOW)
    assert len(out) == 1
    g = out[0]
    assert g.id == "scot-road:gate:33"
    assert g.severity == "serious" and g.category == "hazard"
    assert "Snow gate closed" in g.title and "Drumochter" in g.title


def test_bridges_only_restricted_surface():
    bridges = [
        {"id": "1", "name": "Clackmannanshire Bridge", "road_name": "A876",
         "lat": "56.070643", "lng": "-3.736123", "current_status": "Open"},
        {"id": "4", "name": "Queensferry Crossing", "road_name": "M90",
         "lat": "56.0009", "lng": "-3.4045",
         "current_status": "Closed to high sided vehicles"},
    ]
    out = parse_bridges(bridges, NOW)
    assert len(out) == 1
    b = out[0]
    assert b.id == "scot-road:bridge:4" and b.severity == "serious"
    assert b.title.startswith("Queensferry Crossing:")
    assert "high sided" in b.title
