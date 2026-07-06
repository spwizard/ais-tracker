"""Tube position inference — the trickiest new logic, driven synthetically.

A fake north–south line: Alpha (50.0) → Beta Junction (50.1) → Gamma Cross
(50.2), all at lon 0, with the path polyline running straight up the meridian.
Due north = bearing 0, due south = 180.
"""
from app.land.tube import LineGeo, infer_position, norm_name


def make_geo() -> LineGeo:
    geo = LineGeo("test", "Test")
    geo.paths = [[(0.0, 50.0 + i * 0.025) for i in range(9)]]  # 50.0 … 50.2
    for name, lat in [("Alpha", 50.0), ("Beta Junction", 50.1), ("Gamma Cross", 50.2)]:
        geo.stations[norm_name(name)] = (name, lat, 0.0)
    return geo


def test_norm_name_strips_suffixes_and_punctuation():
    assert norm_name("King's Cross St. Pancras Underground Station") == "kings cross st pancras"
    assert norm_name("Highbury & Islington Underground Station") == "highbury and islington"
    assert norm_name("Edgware Road (Circle Line)") == "edgware road"


def test_station_prefix_matches_truncated_currentlocation():
    geo = make_geo()
    # TfL truncates currentLocation at ~50 chars: "…and Beta Junc"
    assert geo.station_by_prefix("Beta Junc")[0] == "Beta Junction"
    assert geo.station_by_prefix("Alpha")[0] == "Alpha"
    assert geo.station_by_prefix("Zeta") is None


def test_between_places_on_segment_facing_travel():
    geo = make_geo()
    fix = infer_position(geo, "Between Alpha and Beta Junction", "Beta Junction", tts=60)
    lat, lon, brg, kn = fix
    assert 50.0 < lat < 50.1 and abs(lon) < 1e-9
    assert brg < 10 or brg > 350  # heading north toward Beta
    assert kn > 0


def test_at_platform_faces_along_track_toward_destination():
    geo = make_geo()
    # Sitting at Beta, "next station" is Beta itself — direction must come from
    # the track + destination. Toward Gamma (north) vs toward Alpha (south).
    north = infer_position(geo, "At Beta Junction Platform 2", "Beta Junction", 0, towards="Gamma Cross")
    south = infer_position(geo, "At Beta Junction Platform 1", "Beta Junction", 0, towards="Alpha")
    assert north[2] < 10 or north[2] > 350
    assert 170 < south[2] < 190
    assert north[3] == 0.0  # stationary — no dead-reckon glide off the platform


def test_unparseable_location_falls_back_to_next_station_along_track():
    geo = make_geo()
    fix = infer_position(geo, "", "Gamma Cross", 45, towards="Alpha")
    lat, lon, brg, _ = fix
    assert abs(lat - 50.2) < 1e-9  # placed at the next station
    assert 170 < brg < 190  # facing down the line toward its destination


def test_unknown_everything_is_unplaceable():
    geo = make_geo()
    assert infer_position(geo, "In sidings", "Nowhere Halt", 0) is None


def test_along_bearing_rejects_far_points():
    geo = make_geo()
    assert geo.along_bearing((1.0, 50.1), None) is None  # ~70km off the line
