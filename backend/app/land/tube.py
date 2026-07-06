"""London Underground — network geometry + live train inference (TfL API).

Two halves:

* ``TubeNetwork`` — the static-ish picture: line geometry (official route
  polylines incl. branches), stations, and line status. Cached hard (geometry
  ~daily, status ~2 min).
* ``infer_position`` — the live trick: TfL publishes no GPS for tube trains
  (there is none underground). Arrivals predictions carry ``currentLocation``
  ("Between King's Cross and Highbury & Islington", truncated at ~50 chars)
  plus seconds-to-next-station, which pins each train to a segment and a
  fraction along it. Positions are interpolated along the line's real
  polyline — indicative, the same approach every live tube map uses.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time

import httpx

log = logging.getLogger("tube")

TUBE_LINES = [
    "bakerloo", "central", "circle", "district", "hammersmith-city",
    "jubilee", "metropolitan", "northern", "piccadilly", "victoria",
    "waterloo-city",
]

GEOMETRY_TTL = 6 * 3600.0
STATUS_TTL = 120.0
SEG_TYPICAL_SEC = 120.0  # typical inter-station run used to place a train
EARTH_R = 6_371_000.0

_SUFFIXES = re.compile(
    r"\s*(underground station|rail station|station|\(.*?\))\s*$", re.I
)
_PUNCT = re.compile(r"[^a-z0-9 ]")


def norm_name(s: str) -> str:
    """Normalise a station name for matching: TfL truncates currentLocation
    strings and mixes 'St.'/'St' etc., so compare loose."""
    s = _SUFFIXES.sub("", s.strip().lower())
    s = s.replace("&", "and")
    s = _PUNCT.sub("", s)
    return re.sub(r"\s+", " ", s).strip()


def _dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    dlat = math.radians(b[1] - a[1])
    dlon = math.radians(b[0] - a[0])
    p = math.radians((a[1] + b[1]) / 2)
    return EARTH_R * math.hypot(dlat, dlon * math.cos(p))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


class LineGeo:
    """One line's stations + route polylines, indexed for inference."""

    def __init__(self, line_id: str, name: str) -> None:
        self.id = line_id
        self.name = name
        self.paths: list[list[tuple[float, float]]] = []  # [(lon, lat), ...]
        self.stations: dict[str, tuple[str, float, float]] = {}  # norm -> (name, lat, lon)
        self.status: str = "Good Service"
        self.severity: int = 10  # TfL: 10 = good service

    def station_by_prefix(self, text: str) -> tuple[str, float, float] | None:
        """Match a possibly-truncated station reference."""
        n = norm_name(text)
        if not n:
            return None
        hit = self.stations.get(n)
        if hit:
            return hit
        for key, val in self.stations.items():
            if key.startswith(n) or n.startswith(key):
                return val
        return None

    def along_bearing(
        self, pt: tuple[float, float], toward: tuple[float, float] | None
    ) -> float | None:
        """The track's own direction at `pt` (lon, lat) — for trains where we
        only know a single point. `toward` (e.g. the destination) picks which
        of the two ways along the track to face; without it the choice is a
        coin flip, but along-the-line beats pointing across it either way."""
        best: tuple[list[tuple[float, float]], int] | None = None
        best_d = 400.0
        for path in self.paths:
            i = min(range(len(path)), key=lambda k: _dist_m(path[k], pt))
            d = _dist_m(path[i], pt)
            if d < best_d:
                best_d = d
                best = (path, i)
        if best is None:
            return None
        path, i = best
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, len(path) - 1)]
        if a == b:
            return None
        brg = _bearing(a, b)
        if toward is not None:
            want = _bearing(pt, toward)
            if abs((brg - want + 180.0) % 360.0 - 180.0) > 90.0:
                brg = (brg + 180.0) % 360.0
        return brg

    def subpath_point(
        self, a: tuple[float, float], b: tuple[float, float], frac: float
    ) -> tuple[float, float, float] | None:
        """Point `frac` of the way A→B along the line's real polyline.
        Returns (lat, lon, bearing) or None when A/B don't sit on one path."""
        best: tuple[list[tuple[float, float]], int, int] | None = None
        best_score = 400.0  # both endpoints must snap within 400 m
        for path in self.paths:
            ia = min(range(len(path)), key=lambda i: _dist_m(path[i], a))
            ib = min(range(len(path)), key=lambda i: _dist_m(path[i], b))
            score = max(_dist_m(path[ia], a), _dist_m(path[ib], b))
            if score < best_score:
                best_score = score
                best = (path, ia, ib)
        if best is None:
            return None
        path, ia, ib = best
        seg = path[ia:ib + 1] if ia <= ib else list(reversed(path[ib:ia + 1]))
        if len(seg) < 2:
            lat, lon = a[1] + (b[1] - a[1]) * frac, a[0] + (b[0] - a[0]) * frac
            return lat, lon, _bearing(a, b)
        lens = [_dist_m(seg[i], seg[i + 1]) for i in range(len(seg) - 1)]
        total = sum(lens) or 1.0
        target = frac * total
        acc = 0.0
        for i, L in enumerate(lens):
            if acc + L >= target or i == len(lens) - 1:
                f = (target - acc) / L if L > 0 else 0.0
                p, q = seg[i], seg[i + 1]
                lon = p[0] + (q[0] - p[0]) * f
                lat = p[1] + (q[1] - p[1]) * f
                return lat, lon, _bearing(p, q)
            acc += L
        return None


_BETWEEN = re.compile(r"between\s+(.+?)\s+and\s+(.+)$", re.I)
_AT = re.compile(r"^at\s+(.+?)(?:\s+platform.*)?$", re.I)
_NEAR = re.compile(r"^(?:approaching|departing|departed|left|leaving)\s+(.+)$", re.I)


def infer_position(
    geo: LineGeo,
    current_location: str | None,
    next_station: str,
    tts: float,
    towards: str | None = None,
) -> tuple[float, float, float, float] | None:
    """(lat, lon, bearing, speed_kn) for one train, or None if unplaceable."""
    nxt = geo.station_by_prefix(next_station)
    dest = geo.station_by_prefix(towards) if towards else None
    loc = (current_location or "").strip()

    m = _BETWEEN.search(loc)
    if m:
        a = geo.station_by_prefix(m.group(1))
        b = geo.station_by_prefix(m.group(2))
        # The "to" end of the segment should be where it's heading next; fall
        # back to the parsed pair when the prediction disagrees (branch quirks).
        if a and nxt:
            frac = 1.0 - min(max(tts / SEG_TYPICAL_SEC, 0.0), 1.0)
            frac = min(max(frac, 0.03), 0.97)
            target = nxt
            pt = geo.subpath_point((a[2], a[1]), (target[2], target[1]), frac)
            if pt:
                seg_len = _dist_m((a[2], a[1]), (target[2], target[1]))
                speed_kn = min((seg_len / SEG_TYPICAL_SEC) / 0.514444, 45.0)
                return pt[0], pt[1], pt[2], speed_kn
        if a and b:
            pt = geo.subpath_point((a[2], a[1]), (b[2], b[1]), 0.5)
            if pt:
                return pt[0], pt[1], pt[2], 0.0

    m = _AT.match(loc) or _NEAR.match(loc)
    if m:
        st = geo.station_by_prefix(m.group(1))
        if st:
            # Face along the track rather than defaulting north — a wedge
            # pointing across its own line reads as noise. Aim at the next
            # stop when it's a different station; when the "next station" IS
            # this one (sitting at the platform), fall back to the track's
            # local direction, disambiguated by the destination.
            brg: float | None = None
            if nxt and nxt != st:
                pt = geo.subpath_point((st[2], st[1]), (nxt[2], nxt[1]), 0.02)
                if pt:
                    brg = pt[2]
            if brg is None:
                brg = geo.along_bearing(
                    (st[2], st[1]), (dest[2], dest[1]) if dest else None
                )
            return st[1], st[2], brg if brg is not None else 0.0, 0.0

    if nxt:
        brg = geo.along_bearing((nxt[2], nxt[1]), (dest[2], dest[1]) if dest else None)
        return nxt[1], nxt[2], brg if brg is not None else 0.0, 0.0
    return None


class TubeNetwork:
    """Cached line geometry, stations and status from the TfL Unified API."""

    def __init__(self, app_key: str = "") -> None:
        self._app_key = app_key
        self._lines: dict[str, LineGeo] = {}
        self._stations: dict[str, dict] = {}  # naptan id -> station payload
        self._geo_ts = 0.0
        self._status_ts = 0.0
        self._lock = asyncio.Lock()

    def _params(self) -> dict:
        return {"app_key": self._app_key} if self._app_key else {}

    async def lines(self) -> dict[str, LineGeo]:
        async with self._lock:
            if time.time() - self._geo_ts > GEOMETRY_TTL:
                await self._fetch_geometry()
            refresh_status = time.time() - self._status_ts > STATUS_TTL
            if refresh_status:
                # Claim the refresh inside the lock, fetch outside it — status
                # is cosmetic and shouldn't block other callers for a second.
                self._status_ts = time.time()
        if refresh_status:
            await self._fetch_status()
        return self._lines

    async def _fetch_geometry(self) -> None:
        lines: dict[str, LineGeo] = {}
        stations: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            for lid in TUBE_LINES:
                r = await client.get(
                    f"https://api.tfl.gov.uk/Line/{lid}/Route/Sequence/inbound",
                    params=self._params(),
                )
                r.raise_for_status()
                d = r.json()
                geo = LineGeo(lid, d.get("lineName") or lid.title())
                for ls in d.get("lineStrings", []):
                    try:
                        coords = json.loads(ls)[0]
                        geo.paths.append([(c[0], c[1]) for c in coords])
                    except (ValueError, IndexError, TypeError):
                        continue
                for st in d.get("stations", []):
                    name = _SUFFIXES.sub("", st.get("name") or "").strip()
                    lat, lon = st.get("lat"), st.get("lon")
                    if lat is None or lon is None:
                        continue
                    geo.stations[norm_name(name)] = (name, lat, lon)
                    sid = st.get("stationId") or st.get("id") or name
                    entry = stations.setdefault(
                        sid, {"id": sid, "name": name, "lat": lat, "lon": lon, "lines": []}
                    )
                    if lid not in entry["lines"]:
                        entry["lines"].append(lid)
                lines[lid] = geo
        self._lines = lines
        self._stations = stations
        self._geo_ts = time.time()
        log.info("tube network loaded: %d lines, %d stations", len(lines), len(stations))

    async def _fetch_status(self) -> None:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.get(
                    "https://api.tfl.gov.uk/Line/Mode/tube/Status", params=self._params()
                )
                r.raise_for_status()
                for entry in r.json():
                    geo = self._lines.get(entry.get("id") or "")
                    if geo is None:
                        continue
                    statuses = entry.get("lineStatuses") or []
                    if statuses:
                        geo.status = statuses[0].get("statusSeverityDescription") or "Good Service"
                        geo.severity = statuses[0].get("statusSeverity", 10)
        except httpx.HTTPError as exc:
            log.warning("tube status fetch failed: %s", exc)

    async def payload(self) -> dict:
        """The /api/tube/network response body."""
        lines = await self.lines()
        return {
            "lines": [
                {
                    "id": g.id,
                    "name": g.name,
                    "paths": [[[round(lon, 5), round(lat, 5)] for lon, lat in p] for p in g.paths],
                    "status": g.status,
                    "severity": g.severity,
                }
                for g in lines.values()
            ],
            "stations": list(self._stations.values()),
        }
