"""Tests for the hazards eye (app/sources/hazards.py). BGS sample is a real
feed item (2026-07-28); SEPA/Met Office samples are synthetic but match the
documented shapes (both feeds were empty when captured — summer)."""
from __future__ import annotations

from app.sources.hazards import parse_bgs, parse_metoffice, parse_sepa

NOW = 1_785_230_000.0  # 2026-07-28-ish

BGS_XML = """<?xml version="1.0"?>
<rss version="2.0" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#">
<channel><title>Recent earthquakes around the UK</title>
<item>
<title>UK Earthquake alert : M  2.5 :SPEAN BRIDGE,HIGHLAND, Tue, 28 Jul 2026 03:09:54</title>
<description>Origin date/time: Tue, 28 Jul 2026 03:09:54 ; Location: SPEAN BRIDGE,HIGHLAND ; Lat/long: 56.870,-4.894 ; Depth: 5 km ; Magnitude:  2.5</description>
<link>http://earthquakes.bgs.ac.uk/earthquakes/recent_events/20260728030953.html</link>
<pubDate>Tue, 28 Jul 2026 03:09:54</pubDate>
<geo:lat>56.870</geo:lat><geo:long>-4.894</geo:long>
</item>
<item>
<title>UK Earthquake alert : M  1.1 :OLD, EVENT, Mon, 01 Jan 2026 00:00:00</title>
<description>Origin date/time: Mon, 01 Jan 2026 00:00:00 ; Location: OLD,EVENT ; Lat/long: 55.0,-3.0 ; Depth: 8 km ; Magnitude:  1.1</description>
<link>http://earthquakes.bgs.ac.uk/earthquakes/recent_events/20260101000000.html</link>
<pubDate>Mon, 01 Jan 2026 00:00:00</pubDate>
<geo:lat>55.0</geo:lat><geo:long>-3.0</geo:long>
</item>
</channel></rss>"""


def test_bgs_real_item_and_age_filter():
    out = parse_bgs(BGS_XML, NOW)
    assert len(out) == 1  # January event dropped by the 14-day window
    q = out[0]
    assert q.id == "quake:20260728030953"
    assert q.kind == "quake" and q.magnitude == 2.5
    assert q.severity == "moderate"  # 2.5 ≤ M < 4
    assert q.title == "M2.5 earthquake — Spean Bridge,Highland"
    assert q.lat == 56.870 and q.lon == -4.894
    assert "depth 5 km" in (q.detail or "")
    assert q.ts < NOW


METOFFICE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Met Office warnings for Highlands &amp; Eilean Siar</title>
<item>
<title>Amber warning of wind affecting Highlands &amp; Eilean Siar</title>
<description>Valid from 06:00 Tue to 18:00 Tue. Gusts of 80 mph expected.</description>
<link>https://www.metoffice.gov.uk/weather/warnings-and-advice/uk-warnings</link>
</item>
<item>
<title>Yellow warning of rain affecting Highlands &amp; Eilean Siar</title>
<description>Heavy rain may cause disruption.</description>
</item>
</channel></rss>"""


def test_metoffice_levels_and_region_pin():
    out = parse_metoffice(METOFFICE_XML, "he", NOW)
    assert len(out) == 2
    amber, yellow = out
    assert amber.severity == "moderate" and yellow.severity == "minor"
    assert amber.kind == "weather"
    assert amber.region == "Highlands & Eilean Siar"
    assert amber.lat == 57.5 and amber.lon == -4.9  # region centroid pin
    assert "80 mph" in (amber.detail or "")


def test_metoffice_empty_feed_is_no_hazards():
    empty = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>'
    assert parse_metoffice(empty, "st", NOW) == []


def test_sepa_polygon_flood_warning():
    body = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {
            "fwa_name": "River Ness at Inverness",
            "severity": "Flood Warning",
            "message": "River levels are rising after heavy rain.",
            "local_authority": "Highland",
        },
        "geometry": {"type": "Polygon", "coordinates": [[
            [-4.24, 57.47], [-4.20, 57.47], [-4.20, 57.49], [-4.24, 57.49], [-4.24, 57.47],
        ]]},
    }]}
    out = parse_sepa(body, NOW)
    assert len(out) == 1
    f = out[0]
    assert f.kind == "flood" and f.severity == "moderate"  # Warning (not Severe)
    assert f.title.startswith("Flood Warning: River Ness")
    assert abs(f.lat - 57.48) < 0.001 and abs(f.lon - -4.22) < 0.001  # bbox centre
    assert f.geometry is not None and f.geometry["type"] == "Polygon"
    assert f.region == "Highland"


def test_sepa_severe_and_empty():
    severe = {"features": [{
        "properties": {"fwa_name": "X", "severity": "Severe Flood Warning"},
        "geometry": {"type": "Polygon", "coordinates": [[[0.0, 55.0], [0.1, 55.0], [0.1, 55.1], [0.0, 55.0]]]},
    }]}
    assert parse_sepa(severe, NOW)[0].severity == "serious"
    assert parse_sepa({"features": []}, NOW) == []
