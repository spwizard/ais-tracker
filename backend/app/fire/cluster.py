"""Cluster FIRMS detections into fire complexes.

Raw thermal pixels are noisy — a landscape fire shows as dozens of adjacent
detections across several satellite passes, while a field burn is one or two.
This groups 8-connected grid cells (union-find) into complexes, then measures
each one: intensity (summed FRP), extent, and — the useful part — *growth*,
by comparing detections in the last 24 h against the prior 24 h. That's what
separates a fire that's spreading from one that's being put out.

Pure and synchronous: no I/O. Enrichment (nearest town, wind) is layered on
top separately so this stays cheap and testable.
"""
from __future__ import annotations

import hashlib
import math
from collections import defaultdict

from ..models import FireComplex, FireDetection

CELL_DEG = 0.15  # ~15 km grid; adjacent cells merge into one complex
MIN_COUNT = 3  # ignore one-off pixels (field burns, industrial heat, glint)
MIN_TOTAL_FRP = 12.0  # …and clusters too weak to be a real wildfire
DAY = 86_400.0

_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(bearing: float) -> str:
    return _COMPASS[round((bearing % 360) / 22.5) % 16]


def _haversine_km(lat1, lon1, lat2, lon2) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _is_industrial(span_km: float, duration_h: float, growth: float,
                   count_prev: int) -> bool:
    """Heuristic: a persistent, tiny-footprint hot spot burning across more
    than a day at a steady rate is almost certainly a fixed thermal source — a
    power station, refinery flare or steelworks — not a wildfire. Real fires
    either spread (span grows) or burn out. Day/night pattern deliberately does
    NOT matter: flares are often night-only (too faint against sunlit ground),
    and a day-only persistent point is solar glint — neither is a wildfire."""
    return (
        span_km < 4.0            # a point, not a front
        and duration_h >= 20.0   # present across most of a day+
        and count_prev >= 1      # was already there yesterday
        and 0.4 <= growth <= 2.0   # steady, not spreading or dying
    )


def _status(count_24h: int, count_prev: int) -> str:
    """Trend from the last-24h vs prior-24h detection counts. Deliberately avoids
    "contained" — we can't see firefighting, only whether the fire is still hot.
    "cooling" means genuinely no new detections; a busy-but-declining fire is
    "easing", not out."""
    if count_24h == 0:
        return "cooling"  # no new detections in 24 h — the fire has gone cold
    if count_prev == 0:
        return "spreading"  # brand-new activity
    ratio = count_24h / count_prev
    if ratio >= 1.25:
        return "spreading"
    if ratio <= 0.7:
        return "easing"  # still active, but fewer detections than yesterday
    return "active"


def cluster_detections(dets: list[FireDetection], now: float) -> list[FireComplex]:
    if not dets:
        return []

    # 1. Bucket detections into grid cells.
    cells: dict[tuple[int, int], list[FireDetection]] = defaultdict(list)
    for d in dets:
        cells[(round(d.lat / CELL_DEG), round(d.lon / CELL_DEG))].append(d)

    # 2. Union-find over 8-connected cells.
    parent: dict[tuple[int, int], tuple[int, int]] = {}

    def find(x):
        parent.setdefault(x, x)
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        parent[find(a)] = find(b)

    for c in cells:
        find(c)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                n = (c[0] + dx, c[1] + dy)
                if n in cells:
                    union(c, n)

    groups: dict[tuple[int, int], list[FireDetection]] = defaultdict(list)
    group_cells: dict[tuple[int, int], list[tuple[int, int]]] = defaultdict(list)
    for c, pts in cells.items():
        root = find(c)
        groups[root].extend(pts)
        group_cells[root].append(c)

    # 3. Measure each complex.
    out: list[FireComplex] = []
    for root, pts in groups.items():
        total_frp = sum(p.frp for p in pts)
        if len(pts) < MIN_COUNT:
            continue  # too few detections to say anything
        w = total_frp or 1.0
        clat = sum(p.lat * p.frp for p in pts) / w
        clon = sum(p.lon * p.frp for p in pts) / w
        lats = [p.lat for p in pts]
        lons = [p.lon for p in pts]
        span = _haversine_km(min(lats), min(lons), max(lats), max(lons))
        count_24h = sum(1 for p in pts if now - p.acq <= DAY)
        count_prev = sum(1 for p in pts if DAY < now - p.acq <= 2 * DAY)
        newest = max(pts, key=lambda p: p.acq)
        first = min(p.acq for p in pts)
        _dur_h = (newest.acq - first) / 3600.0
        _growth = round(count_24h / max(count_prev, 1), 2)
        _industrial = _is_industrial(span, _dur_h, _growth, count_prev)
        # Wildfires must clear an intensity bar; persistent point-sources
        # (industrial) are surfaced even when faint, so we can label them — but
        # transient faint clusters (agricultural burns) are dropped as noise.
        if not _industrial and total_frp < MIN_TOTAL_FRP:
            continue
        key = f"{round(clat, 2)},{round(clon, 2)}"
        out.append(FireComplex(
            id="fc_" + hashlib.md5(key.encode()).hexdigest()[:10],
            lat=round(clat, 4),
            lon=round(clon, 4),
            total_frp=round(total_frp, 1),
            peak_frp=round(max(p.frp for p in pts), 1),
            count=len(pts),
            count_24h=count_24h,
            count_prev=count_prev,
            growth=_growth,
            status=_status(count_24h, count_prev),
            kind="industrial" if _industrial else "wildfire",
            span_km=round(span, 1),
            high_conf=sum(1 for p in pts if p.confidence == "high"),
            first_seen=min(p.acq for p in pts),
            last_seen=newest.acq,
            last_satellite=newest.satellite,
            # The complex's grid cells — lets the client attribute a raw
            # detection to a complex exactly (same CELL_DEG rounding), so the
            # ember field can glow only where a believed wildfire is.
            cells=sorted(group_cells[root]),
        ))

    out.sort(key=lambda c: c.total_frp, reverse=True)
    return out


def destination(lat: float, lon: float, bearing_deg: float, dist_km: float) -> tuple[float, float]:
    """Point ``dist_km`` from (lat, lon) along ``bearing_deg`` — for sampling the
    settlement the fire is spreading toward."""
    r = 6371.0
    b = math.radians(bearing_deg)
    la = math.radians(lat)
    lo = math.radians(lon)
    la2 = math.asin(math.sin(la) * math.cos(dist_km / r)
                    + math.cos(la) * math.sin(dist_km / r) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(dist_km / r) * math.cos(la),
                          math.cos(dist_km / r) - math.sin(la) * math.sin(la2))
    return math.degrees(la2), math.degrees(lo2)
