"""Tests for the ferry service-status eye (app/sources/ferries.py). Sample
payloads mirror real CalMac GraphQL / NorthLink opsnews responses (2026-07-28).
"""
from __future__ import annotations

from app.sources.ferries import parse_calmac, parse_northlink

NOW = 1_785_230_000.0


def _routes_body():
    return {"data": {"routes": [
        {
            "id": "route-2bc9256e",
            "name": "Gourock - Dunoon",
            "status": "NORMAL",
            "ports": [
                {"name": "Dunoon", "latitude": 55.9454927, "longitude": -4.921472343},
                {"name": "Gourock", "latitude": 55.96073259, "longitude": -4.814684154},
            ],
        },
        {
            "id": "route-88680d8c",
            "name": "Ullapool - Stornoway",
            "status": "DISRUPTIONS",
            "ports": [
                {"name": "Ullapool", "latitude": 57.895, "longitude": -5.16},
                {"name": "Stornoway", "latitude": 58.207, "longitude": -6.387},
            ],
        },
        {   # a route with unusable ports never renders
            "id": "route-bad",
            "name": "Broken",
            "status": "NORMAL",
            "ports": [{"name": "X", "latitude": "nope", "longitude": 0}],
        },
    ]}}


def _statuses_body():
    return {"data": {"routeStatuses": [
        # Standing boilerplate on the disrupted route — must NOT win…
        {"route": {"id": "route-88680d8c"}, "status": "SERVICE",
         "title": "Freight Service", "detail": "Freight rules boilerplate."},
        # …over the actual warning.
        {"route": {"id": "route-88680d8c"}, "status": "WARNING",
         "title": "Sailings cancelled", "detail": "<p>Due to adverse weather, sailings are cancelled.</p>"},
        # Notice on a NORMAL route — ignored entirely (year-round info noise).
        {"route": {"id": "route-2bc9256e"}, "status": "INFORMATION",
         "title": "Timetable info", "detail": "Winter timetable applies."},
    ]}}


def test_calmac_status_join_and_filtering():
    out = parse_calmac(_routes_body(), _statuses_body(), NOW)
    assert [r.id for r in out] == ["calmac:2bc9256e", "calmac:88680d8c"]  # bad-port route dropped

    normal, disrupted = out
    assert normal.status == "normal"
    assert normal.title is None and normal.detail is None  # info noise suppressed

    assert disrupted.status == "disruptions" and disrupted.operator == "CalMac"
    assert disrupted.title == "Sailings cancelled"  # WARNING beat SERVICE
    assert "adverse weather" in (disrupted.detail or "")
    assert "<p>" not in (disrupted.detail or "")  # HTML flattened
    assert len(disrupted.ports) == 2 and disrupted.ports[1].name == "Stornoway"


def test_northlink_route_matching_and_wording():
    posts = [
        {"title": {"rendered": "Pentland Firth Arrivals and Departures"},
         "content": {"rendered": "<p><strong>M.V Hamnavoe</strong></p><ul><li>Departed on time.</li></ul>"}},
        {"title": {"rendered": "Aberdeen Arrivals and Departures"},
         "content": {"rendered": "<p>MV Hjaltland is unable to sail due to adverse weather.</p>"}},
    ]
    out = parse_northlink(posts, NOW)
    assert len(out) == 2
    pentland = next(r for r in out if r.id == "northlink:pentland")
    aberdeen = next(r for r in out if r.id == "northlink:aberdeen")

    assert pentland.status == "normal"  # nothing disruption-ish in the post
    assert "Hamnavoe" in (pentland.detail or "")

    assert aberdeen.status == "be_aware"  # "unable to sail" wording
    assert aberdeen.operator == "NorthLink"
    assert len(aberdeen.ports) == 3  # Aberdeen, Kirkwall, Lerwick legs


def test_northlink_no_matching_post_is_calm():
    out = parse_northlink([], NOW)
    assert all(r.status == "normal" and r.detail is None for r in out)
