"""Tier-2 track snapping — pull inferred train positions onto the real rails.

The Darwin/interpolation position is a straight line between calling points,
which cuts across the countryside on curved routes. We snap each position to
the nearest point on Network Rail's route geometry (network.geojson) and take
the local track direction as the bearing, so trains ride the rails and glide
along them instead of through fields.

The network is ~190k points, so a grid index buckets every segment by cell;
a snap only tests segments in the query cell and its 8 neighbours.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

_FILE = Path(__file__).parent / "network.geojson"
CELL = 0.02          # ~1.4 km grid cell
SNAP_TOL_M = 700.0   # don't snap if the nearest rail is further than this

Seg = tuple[float, float, float, float]  # (lon1, lat1, lon2, lat2)


def _cell(lon: float, lat: float) -> tuple[int, int]:
    return (int(math.floor(lon / CELL)), int(math.floor(lat / CELL)))


@lru_cache(maxsize=1)
def _index() -> dict[tuple[int, int], list[Seg]]:
    """Grid of segments keyed by the cells each segment touches (its endpoints'
    cells — segments are short relative to the cell, so endpoint cells suffice
    for a tolerant nearest search over the 3x3 neighbourhood)."""
    grid: dict[tuple[int, int], list[Seg]] = {}
    try:
        data = json.loads(_FILE.read_text())
    except (OSError, ValueError):
        return grid
    for feat in data.get("features", []):
        coords = feat.get("geometry", {}).get("coordinates", [])
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i]
            lon2, lat2 = coords[i + 1]
            seg: Seg = (lon1, lat1, lon2, lat2)
            for c in {_cell(lon1, lat1), _cell(lon2, lat2)}:
                grid.setdefault(c, []).append(seg)
    return grid


def _project(lon: float, lat: float, seg: Seg) -> tuple[float, float, float, float]:
    """Nearest point on a segment to (lon, lat). Returns (plon, plat, dist2, bearing).
    Distances use a local equirectangular approximation (fine at this scale)."""
    lon1, lat1, lon2, lat2 = seg
    k = math.cos(math.radians(lat))  # lon→x scale at this latitude
    ax, ay = lon1 * k, lat1
    bx, by = lon2 * k, lat2
    px, py = lon * k, lat
    dx, dy = bx - ax, by - ay
    denom = dx * dx + dy * dy
    t = 0.0 if denom == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / denom))
    cx, cy = ax + dx * t, ay + dy * t
    d2 = (px - cx) ** 2 + (py - cy) ** 2
    brg = (math.degrees(math.atan2(dx, dy)) + 360.0) % 360.0  # segment heading
    return cx / k, cy, d2, brg


def snap(lat: float, lon: float, heading_hint: float | None = None) -> tuple[float, float, float] | None:
    """Snap (lat, lon) to the nearest rail. Returns (lat, lon, bearing) or None
    when no rail is within SNAP_TOL_M. `heading_hint` (the train's travel
    direction) disambiguates the segment's two-way heading toward travel."""
    grid = _index()
    if not grid:
        return None
    cx, cy = _cell(lon, lat)
    best: tuple[float, float, float, float] | None = None  # (plon, plat, d2, brg)
    for gx in (cx - 1, cx, cx + 1):
        for gy in (cy - 1, cy, cy + 1):
            for seg in grid.get((gx, gy), ()):  # type: ignore[arg-type]
                p = _project(lon, lat, seg)
                if best is None or p[2] < best[2]:
                    best = p
    if best is None:
        return None
    plon, plat, _d2, brg = best
    # Reject far snaps (metres): convert the squared-degree distance back.
    dist_m = math.hypot((plat - lat), (plon - lon) * math.cos(math.radians(lat))) * 111_320
    if dist_m > SNAP_TOL_M:
        return None
    if heading_hint is not None:
        # A segment heads both ways; pick the orientation nearer the train's
        # actual travel so the glyph points along the direction of motion.
        if abs((brg - heading_hint + 180.0) % 360.0 - 180.0) > 90.0:
            brg = (brg + 180.0) % 360.0
    return plat, plon, brg
