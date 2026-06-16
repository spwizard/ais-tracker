"""Authoritative geofence evaluation.

Compiles each fence to a Shapely polygon, indexes them in an STRtree, and on a
periodic tick tests every vessel's last-known position against the fences. A
per-(vessel, fence) membership set drives enter/exit/dwell events, which are
broadcast to all clients. Because it reads the *stored* (last reported) position
— not the dead-reckoned display position — membership is stable between reports,
so no hysteresis is needed to avoid re-evaluation jitter.
"""
from __future__ import annotations

import logging
import math
import time

from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

from .models import Geofence

log = logging.getLogger("geofence.evaluator")

EARTH_R = 6_371_000.0

# "Dwell" and "gone dark" are only meaningful for substantial commercial vessels
# — leisure/fishing/small craft drop AIS routinely and loiter, which floods busy
# coastal zones with noise. Restrict those two triggers to high-speed craft,
# tugs/special, passenger, cargo and tankers (AIS type 40–89). Enter/exit/speed
# stay unrestricted (those can be deliberately aimed at small craft).
def _substantial(ship_type) -> bool:
    return ship_type is not None and 40 <= ship_type <= 89


# A few minutes of AIS silence is routine, not "gone dark". Floor the dark window
# so a short per-fence setting can't fire on brief gaps.
DARK_MIN_SEC = 600  # 10 min


def _forward(lon: float, lat: float, bearing: float, dist_m: float) -> tuple[float, float]:
    """Project a point along a bearing (radians) by dist_m. Returns (lon, lat)."""
    ang = dist_m / EARTH_R
    lat1, lon1 = math.radians(lat), math.radians(lon)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(ang) + math.cos(lat1) * math.sin(ang) * math.cos(bearing)
    )
    lon2 = lon1 + math.atan2(
        math.sin(bearing) * math.sin(ang) * math.cos(lat1),
        math.cos(ang) - math.sin(lat1) * math.sin(lat2),
    )
    return (math.degrees(lon2), math.degrees(lat2))


def _circle_ring(center: tuple[float, float], radius_m: float, steps: int = 64):
    lon, lat = center
    ring = [_forward(lon, lat, 2 * math.pi * i / steps, radius_m) for i in range(steps)]
    ring.append(ring[0])
    return ring


def fence_polygon(f: Geofence) -> Polygon | None:
    if f.shape == "circle" and f.center and f.radiusM:
        return Polygon(_circle_ring(tuple(f.center), f.radiusM))
    if f.shape in ("rectangle", "polygon") and f.ring and len(f.ring) >= 3:
        ring = [tuple(p) for p in f.ring]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        return Polygon(ring)
    return None  # corridor handled in a later phase


class GeofenceEvaluator:
    def __init__(self, store, broadcaster) -> None:
        self._store = store  # VesselStore
        self._broadcaster = broadcaster
        self._fences: dict[str, Geofence] = {}
        self._ids: list[str] = []
        self._tree: STRtree | None = None
        # membership state
        self._inside: dict[int, set[str]] = {}  # mmsi -> fence ids
        self._entered_at: dict[tuple[int, str], float] = {}
        self._dwell_fired: set[tuple[int, str]] = set()
        self._speed_fired: set[tuple[int, str]] = set()  # edge-triggered speed
        self._dark_fired: set[tuple[int, str]] = set()
        self._seen: set[int] = set()  # vessels whose membership is established

    def set_fences(self, fences: list[Geofence]) -> None:
        self._fences = {f.id: f for f in fences}
        polys, ids = [], []
        for f in fences:
            poly = fence_polygon(f)
            if poly is not None and not poly.is_empty:
                polys.append(poly)
                ids.append(f.id)
        self._ids = ids
        self._tree = STRtree(polys) if polys else None

        # Drop membership for fences that no longer exist (avoids phantom exits).
        valid = set(ids)
        for mmsi in list(self._inside.keys()):
            self._inside[mmsi] &= valid
        self._entered_at = {k: v for k, v in self._entered_at.items() if k[1] in valid}
        self._dwell_fired = {k for k in self._dwell_fired if k[1] in valid}
        self._speed_fired = {k for k in self._speed_fired if k[1] in valid}
        self._dark_fired = {k for k in self._dark_fired if k[1] in valid}
        log.info("evaluator tracking %d fences", len(ids))

    async def evaluate(self, emit: bool = True) -> None:
        """One evaluation pass. With emit=False, state is seeded silently (used at
        startup and after fence edits so pre-existing membership doesn't fire)."""
        if self._tree is None:
            self._inside.clear()
            self._entered_at.clear()
            self._dwell_fired.clear()
            return

        snapshot = await self._store.snapshot()
        now = time.time()
        live: set[int] = set()
        events: list[dict] = []

        for v in snapshot:
            if v.lon is None or v.lat is None:
                continue
            live.add(v.mmsi)
            # query(point, predicate) tests point.predicate(fence); "within"
            # selects the fences that contain the point.
            idxs = self._tree.query(Point(v.lon, v.lat), predicate="within")
            now_ids = {self._ids[i] for i in idxs}

            # First time we've observed this vessel: seed its membership silently
            # (a vessel that simply appears inside a zone hasn't "entered" it).
            if v.mmsi not in self._seen:
                self._seen.add(v.mmsi)
                self._inside[v.mmsi] = now_ids
                for fid in now_ids:
                    self._entered_at[(v.mmsi, fid)] = now
                continue

            prev_ids = self._inside.get(v.mmsi, set())

            for fid in now_ids - prev_ids:
                self._entered_at[(v.mmsi, fid)] = now
                self._dwell_fired.discard((v.mmsi, fid))
                f = self._fences.get(fid)
                if emit and f and f.has_trigger("enter"):
                    events.append(self._event("enter", f, v, now))

            for fid in prev_ids - now_ids:
                self._entered_at.pop((v.mmsi, fid), None)
                self._dwell_fired.discard((v.mmsi, fid))
                self._speed_fired.discard((v.mmsi, fid))
                self._dark_fired.discard((v.mmsi, fid))
                f = self._fences.get(fid)
                if emit and f and f.has_trigger("exit"):
                    events.append(self._event("exit", f, v, now))

            for fid in now_ids:
                f = self._fences.get(fid)
                if f is None:
                    continue
                key = (v.mmsi, fid)

                # Dwell: a substantial vessel still inside after the threshold.
                dwell = f.dwell_sec()
                if dwell and _substantial(v.ship_type) and key not in self._dwell_fired:
                    if now - self._entered_at.get(key, now) >= dwell:
                        self._dwell_fired.add(key)
                        if emit:
                            events.append(self._event("dwell", f, v, now))

                # Speed-in-zone: edge-triggered when the speed condition is met.
                spec = f.speed_trigger()
                if spec and v.sog is not None:
                    op, kn = spec
                    met = v.sog > kn if op == "over" else v.sog < kn
                    if met and key not in self._speed_fired:
                        self._speed_fired.add(key)
                        if emit:
                            events.append(self._event("speed", f, v, now))
                    elif not met:
                        self._speed_fired.discard(key)

                # AIS-dark: a tracked vessel inside has stopped transmitting.
                # Measure silence from the later of its last report and when this
                # fence started watching it, so a vessel that was already quiet
                # when the fence was created gets a full grace period (it didn't
                # "go dark" on our watch until darkSec passes).
                dark = f.dark_sec()
                if dark is not None and _substantial(v.ship_type):
                    dark = max(dark, DARK_MIN_SEC)
                    watch_start = self._entered_at.get(key, now)
                    silent = now - max(v.ts, watch_start) >= dark
                    if silent and key not in self._dark_fired:
                        self._dark_fired.add(key)
                        if emit:
                            events.append(self._event("dark", f, v, now))
                    elif not silent:
                        self._dark_fired.discard(key)

            self._inside[v.mmsi] = now_ids

        # Prune vessels that have gone dark / been evicted (silent — not an exit).
        # Forgetting `_seen` means a reappearing vessel re-seeds without firing.
        for mmsi in list(self._inside.keys()):
            if mmsi not in live:
                self._inside.pop(mmsi, None)
                self._seen.discard(mmsi)
                self._entered_at = {k: x for k, x in self._entered_at.items() if k[0] != mmsi}
                self._dwell_fired = {k for k in self._dwell_fired if k[0] != mmsi}
                self._speed_fired = {k for k in self._speed_fired if k[0] != mmsi}
                self._dark_fired = {k for k in self._dark_fired if k[0] != mmsi}

        for ev in events:
            await self._broadcaster.send_frame(ev)
        if events:
            log.info("emitted %d geofence events", len(events))

    def _event(self, kind: str, f: Geofence, v, now: float) -> dict:
        return {
            "type": "geofence_event",
            "event": kind,
            "fence_id": f.id,
            "fence_name": f.name,
            "category": f.category,
            "color": f.color,
            "mmsi": v.mmsi,
            "name": v.name,
            "sog": v.sog,
            "lat": v.lat,
            "lon": v.lon,
            "ts": now,
        }

    def counts(self) -> dict[str, int]:
        """Vessels currently inside each fence (for REST/debug)."""
        counts: dict[str, int] = {fid: 0 for fid in self._ids}
        for ids in self._inside.values():
            for fid in ids:
                counts[fid] = counts.get(fid, 0) + 1
        return counts
