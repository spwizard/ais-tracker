"""Bus-swarm inference — the city reporting an incident before any feed does.

BODS gives live positions but not scheduled routes, so we can't detect a
diversion from a planned path. What we CAN detect: buses from several
*different* routes that were moving and are now stalled together in a small
area. Outside a bus station that means the road is blocked — a hold no feed
has published yet. Emitted as an inferred Incident into the spine.
"""
from __future__ import annotations

from collections import deque

from ..models import Bus, Incident
from .helicopter import _dist_m, nearest_station

WINDOW_SEC = 300.0
STALL_KMH = 4.0        # essentially stopped
MOVED_KMH = 15.0       # was genuinely in transit earlier (not idling at a stand)
STALL_SEC = 180.0      # sustained 3 min — a real hold, not a red light
CLUSTER_M = 250.0      # buses within this of each other cluster
MIN_ROUTES = 4         # distinct routes stalled together → not a coincidence
MIN_BUSES = 5
# Bus stations/interchanges sit at rail stations and always have many idling
# buses from many routes — the dominant false-positive source. Require the
# cluster to be clear of any station so we only flag genuine mid-road holds.
STATION_CLEARANCE_M = 350.0


def _kmh(a, b, dt: float) -> float:
    if dt <= 0:
        return 0.0
    return (_dist_m(a[1], a[2], b[1], b[2]) / dt) * 3.6


class BusSwarmDetector:
    def __init__(self) -> None:
        self._hist: dict[str, deque] = {}  # bus id -> deque of (ts, lat, lon)

    def _stalled(self, hist: deque, now: float) -> bool:
        pts = list(hist)
        if len(pts) < 4 or now - pts[0][0] < STALL_SEC:
            return False
        # Recent straight-line speed over the last ~90s ≈ 0 for a stalled bus.
        recent = [p for p in pts if now - p[0] <= 90]
        if len(recent) < 2:
            return False
        recent_kmh = _kmh(recent[0], recent[-1], recent[-1][0] - recent[0][0])
        # Peak consecutive speed over the window — did it actually drive?
        peak = max(_kmh(pts[i - 1], pts[i], pts[i][0] - pts[i - 1][0]) for i in range(1, len(pts)))
        return recent_kmh < STALL_KMH and peak > MOVED_KMH

    def update(self, buses: list[Bus], now: float) -> list[Incident]:
        seen: set[str] = set()
        stalled: list[Bus] = []
        for b in buses:
            if b.lat is None or b.lon is None:
                continue
            seen.add(b.id)
            h = self._hist.setdefault(b.id, deque())
            h.append((now, b.lat, b.lon))
            while h and now - h[0][0] > WINDOW_SEC:
                h.popleft()
            if self._stalled(h, now):
                stalled.append(b)
        for bid in list(self._hist):
            if bid not in seen:
                self._hist.pop(bid, None)

        return self._cluster(stalled, now)

    def _cluster(self, stalled: list[Bus], now: float) -> list[Incident]:
        used: set[int] = set()
        incidents: list[Incident] = []
        for i, seed in enumerate(stalled):
            if i in used:
                continue
            members = [seed]
            used.add(i)
            for j, other in enumerate(stalled):
                if j in used:
                    continue
                if _dist_m(seed.lat, seed.lon, other.lat, other.lon) <= CLUSTER_M:
                    members.append(other)
                    used.add(j)
            routes = {m.route for m in members if m.route}
            if len(members) < MIN_BUSES or len(routes) < MIN_ROUTES:
                continue
            clat = sum(m.lat for m in members) / len(members)
            clon = sum(m.lon for m in members) / len(members)
            place, station_m = nearest_station(clat, clon)
            # Skip clusters sitting on a station — that's an interchange stand,
            # not a road blockage (kills the false-positive storm).
            if station_m < STATION_CLEARANCE_M:
                continue
            rlist = ", ".join(sorted(routes)[:6])
            # Stable id from the rounded centre so the incident persists as the
            # jam does rather than flickering as membership shifts slightly.
            cid = f"{round(clat, 3)},{round(clon, 3)}"
            incidents.append(Incident(
                id=f"bus-swarm:{cid}",
                source="bus-swarm",
                category="congestion",
                severity="moderate",
                confidence="inferred",
                title=f"Traffic held{f' near {place}' if place else ''}",
                detail=f"{len(members)} buses across routes {rlist} stopped together — likely a road blockage or serious congestion.",
                location=place,
                lat=clat,
                lon=clon,
                ts=now,
                updated=now,
            ))
        return incidents
