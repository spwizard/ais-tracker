"""Position inference for trains: interpolate along calling points.

Given a service's calling points (station + expected epoch time), estimate
where the train is *now* by linear interpolation between the two points that
bracket the current time. Straight-line between stations is honest at national
zoom; snapping to track geometry is the Tier-2 upgrade.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_R_M = 6_371_000.0


@dataclass(frozen=True)
class CallingPoint:
    crs: str
    name: str
    lat: float
    lon: float
    t: float  # expected passing/departure time, epoch seconds


@dataclass(frozen=True)
class TrainFix:
    lat: float
    lon: float
    bearing: float  # degrees clockwise from north
    speed_kn: float  # along-segment speed (for client-side glide)
    next_idx: int  # index into the calling points of the next stop


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def position_at(points: list[CallingPoint], now: float) -> TrainFix | None:
    """Interpolated fix at `now`, or None for an empty/degenerate service.

    Before the first calling point the train sits at its origin; after the
    last it sits at its destination (speed 0 in both cases).
    """
    if not points:
        return None
    if now <= points[0].t or len(points) == 1:
        p = points[0]
        b = bearing_deg(p.lat, p.lon, points[1].lat, points[1].lon) if len(points) > 1 else 0.0
        return TrainFix(p.lat, p.lon, b, 0.0, min(1, len(points) - 1))
    if now >= points[-1].t:
        p = points[-1]
        q = points[-2]
        return TrainFix(p.lat, p.lon, bearing_deg(q.lat, q.lon, p.lat, p.lon), 0.0, len(points) - 1)

    for i in range(1, len(points)):
        a, b = points[i - 1], points[i]
        if now <= b.t:
            span = max(b.t - a.t, 1.0)
            f = (now - a.t) / span
            lat = a.lat + (b.lat - a.lat) * f
            lon = a.lon + (b.lon - a.lon) * f
            dist = haversine_m(a.lat, a.lon, b.lat, b.lon)
            speed_kn = (dist / span) / 0.514444
            return TrainFix(lat, lon, bearing_deg(a.lat, a.lon, b.lat, b.lon), speed_kn, i)
    return None  # unreachable given the guards above
