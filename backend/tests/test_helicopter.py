"""Helicopter circling detector — synthetic orbits (no live heli needed)."""
import math

from app.incidents.helicopter import HelicopterDetector
from app.models import Aircraft


def _orbit_point(clat, clon, radius_m, angle_deg):
    """A point on a circle, with the track = tangent heading."""
    a = math.radians(angle_deg)
    dlat = (radius_m * math.cos(a)) / 111_320
    dlon = (radius_m * math.sin(a)) / (111_320 * math.cos(math.radians(clat)))
    track = (angle_deg + 90) % 360  # tangent, clockwise
    return clat + dlat, clon + dlon, track


def _feed(det, hexid, cat, samples, start=1_000_000.0, step=10.0):
    inc = None
    for i, (lat, lon, track, gs) in enumerate(samples):
        ac = Aircraft(hex=hexid, category=cat, lat=lat, lon=lon, track=track, gs=gs,
                      callsign="HELI1", ac_type="EC35")
        res = det.update([ac], start + i * step)
        inc = res
    return inc


def test_sustained_orbit_fires():
    det = HelicopterDetector()
    clat, clon = 51.48, -0.07  # near the Thames
    # ~2 full turns over ~200s (21 samples, 10s apart), 30° per step.
    samples = []
    for i in range(21):
        lat, lon, track = _orbit_point(clat, clon, 800, i * 30)
        samples.append((lat, lon, track, 70.0))
    incs = _feed(det, "abc123", "A7", samples)
    assert len(incs) == 1
    inc = incs[0]
    assert inc.source == "heli" and inc.category == "aerial"
    assert inc.confidence == "inferred"
    assert abs(inc.lat - clat) < 0.01 and abs(inc.lon - clon) < 0.01
    assert "circling" in inc.title.lower()


def test_straight_transit_does_not_fire():
    det = HelicopterDetector()
    # Flying due north in a straight line — no net turn.
    samples = [(51.4 + i * 0.01, -0.1, 0.0, 120.0) for i in range(21)]
    assert _feed(det, "def456", "A7", samples) == []


def test_non_rotorcraft_ignored():
    det = HelicopterDetector()
    clat, clon = 51.5, -0.1
    samples = [(*_orbit_point(clat, clon, 800, i * 30), 70.0) for i in range(21)]
    assert _feed(det, "ghi789", "A3", samples) == []  # A3 = large jet


def test_hover_not_orbiting():
    det = HelicopterDetector()
    # Sitting still (radius tiny, no consistent turn) — not a circling incident.
    samples = [(51.5, -0.1, (i * 5) % 360, 5.0) for i in range(21)]
    assert _feed(det, "hover1", "A7", samples) == []
