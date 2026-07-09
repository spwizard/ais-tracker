"""Helicopter-circling detector — an inference eye, no new data needed.

We already see every helicopter on ADS-B (emitter category A7). A helicopter
orbiting one point for minutes — police, air ambulance, news — is one of the
strongest "something is happening HERE" signals there is, and nobody surfaces
it. This watches rotorcraft tracks and, when one has turned >~1 full circle in
a consistent direction while staying local, emits an inferred Incident (its
orbit centre named by the nearest station).
"""
from __future__ import annotations

import math
import time
from collections import deque

from ..models import Aircraft, Incident
from ..rail.stations import stations_by_crs

WINDOW_SEC = 240.0       # rolling track history kept per helicopter
NET_TURN_DEG = 400.0     # >1.1 turns, consistent direction = orbiting
RADIUS_MAX_M = 3000.0    # must stay within this of its orbit centre
MIN_CIRCLE_SEC = 90.0    # sustained this long before we call it
GS_RANGE = (20.0, 150.0) # a moving orbit, not a hover or transit

# Argus London is a London story, but the ADS-B feed spans UK + Norway + Baltic.
# Bound the eye to Greater London (+ approaches) so a helicopter orbiting Bergen
# never surfaces as a London incident. (W, S, E, N)
LONDON_BBOX = (-0.62, 51.25, 0.40, 51.73)


def _in_london(lat: float, lon: float) -> bool:
    w, s, e, n = LONDON_BBOX
    return w <= lon <= e and s <= lat <= n


def _dist_m(lat1, lon1, lat2, lon2) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    p = math.radians((lat1 + lat2) / 2)
    return 6_371_000 * math.hypot(dlat, dlon * math.cos(p))


def nearest_station(lat: float, lon: float) -> tuple[str | None, float]:
    """Nearest rail station name + distance in metres."""
    best = None
    best_lat = best_lon = 0.0
    best_d2 = 1e18
    for st in stations_by_crs().values():
        d = (st.lat - lat) ** 2 + (st.lon - lon) ** 2
        if d < best_d2:
            best_d2 = d
            best, best_lat, best_lon = st.name, st.lat, st.lon
    if best is None:
        return None, 1e9
    return best, _dist_m(lat, lon, best_lat, best_lon)


def _nearest_place(lat: float, lon: float) -> str | None:
    return nearest_station(lat, lon)[0]


class HelicopterDetector:
    def __init__(self) -> None:
        # hex -> deque of (ts, lat, lon, track)
        self._hist: dict[str, deque] = {}
        self._since: dict[str, float] = {}  # hex -> when circling began

    def update(self, aircraft: list[Aircraft], now: float) -> list[Incident]:
        seen: set[str] = set()
        incidents: list[Incident] = []
        for a in aircraft:
            if a.category != "A7" or a.lat is None or a.lon is None:
                continue
            if not _in_london(a.lat, a.lon):
                continue  # only London orbits are Argus London incidents
            seen.add(a.hex)
            h = self._hist.setdefault(a.hex, deque())
            h.append((now, a.lat, a.lon, a.track))
            while h and now - h[0][0] > WINDOW_SEC:
                h.popleft()

            inc = self._assess(a, h, now)
            if inc is not None:
                incidents.append(inc)

        # Forget helis that have left, and clear their circling state.
        for hx in list(self._hist):
            if hx not in seen:
                self._hist.pop(hx, None)
                self._since.pop(hx, None)
        return incidents

    def _assess(self, a: Aircraft, hist: deque, now: float) -> Incident | None:
        pts = [p for p in hist if p[3] is not None]
        if len(pts) < 6 or (now - pts[0][0]) < MIN_CIRCLE_SEC:
            self._since.pop(a.hex, None)
            return None
        if a.gs is not None and not (GS_RANGE[0] <= a.gs <= GS_RANGE[1]):
            self._since.pop(a.hex, None)
            return None

        clat = sum(p[1] for p in pts) / len(pts)
        clon = sum(p[2] for p in pts) / len(pts)
        radius = max(_dist_m(clat, clon, p[1], p[2]) for p in pts)
        if radius > RADIUS_MAX_M:
            self._since.pop(a.hex, None)
            return None

        # Net (signed) turn over the window — a true orbit rotates one way.
        net = 0.0
        for i in range(1, len(pts)):
            d = ((pts[i][3] - pts[i - 1][3] + 180.0) % 360.0) - 180.0
            net += d
        if abs(net) < NET_TURN_DEG:
            self._since.pop(a.hex, None)
            return None

        since = self._since.setdefault(a.hex, pts[0][0])
        mins = int((now - since) / 60) or 1
        place = _nearest_place(clat, clon)
        callsign = (a.callsign or "").strip()
        who = a.ac_type or callsign or "Helicopter"
        return Incident(
            id=f"heli:{a.hex}",
            source="heli",
            category="aerial",
            severity="moderate",
            confidence="inferred",
            title=f"Helicopter circling{f' near {place}' if place else ''}",
            detail=f"{who} has been orbiting for ~{mins} min — police, air ambulance or media activity likely.",
            location=place,
            lat=clat,
            lon=clon,
            ts=since,
            updated=now,
        )
