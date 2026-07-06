"""Simulated rail source — Tier-1 prototype feed.

Fabricates plausible services on real GB routes (real stations, realistic leg
times, both directions, staggered departures) and interpolates each train's
position along its calling points — exactly the pipeline the Darwin Push Port
source will drive with real data once credentials are configured. Every train
it emits is marked ``sim=True`` and the UI labels the layer as simulated.
"""
from __future__ import annotations

import asyncio
import hashlib
import time

from ..config import Settings
from ..models import Train, TrainStop
from ..rail.interpolate import CallingPoint, position_at
from ..rail.stations import stations_by_crs
from ..store.train import TrainStore
from .base import Source, log

# (operator, headcode class, [(CRS, minutes from previous stop), ...])
ROUTES: list[tuple[str, str, list[tuple[str, float]]]] = [
    ("GWR", "1B", [("PAD", 0), ("RDG", 25), ("DID", 12), ("SWI", 17),
                   ("CPM", 13), ("BTH", 12), ("BRI", 12)]),
    ("LNER", "1S", [("KGX", 0), ("PBO", 45), ("YRK", 55), ("DAR", 25),
                    ("NCL", 30), ("BWK", 45), ("EDB", 45)]),
    ("Avanti", "1H", [("EUS", 0), ("MKC", 30), ("RUG", 25), ("STA", 30),
                      ("CRE", 20), ("SPT", 20), ("MAN", 10)]),
    ("SWR", "1P", [("WAT", 0), ("WOK", 25), ("BSK", 18), ("WIN", 18),
                   ("SOA", 9), ("SOU", 8)]),
    ("Southern", "1A", [("VIC", 0), ("ECR", 15), ("GTW", 15), ("HHE", 12),
                        ("BTN", 25)]),
]

HEADWAY_SEC = 20 * 60  # a departure each way every 20 minutes
TICK_SEC = 2.0
TTL_SEC = 60  # finished services stop being upserted and age out


def _jitter(service_id: str, spread: int) -> int:
    """Stable pseudo-random 0..spread-1 for a service (no RNG state)."""
    h = hashlib.md5(service_id.encode()).digest()
    return h[0] % spread


class SimRailSource(Source):
    name = "rail-sim"

    def __init__(self, store: TrainStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._ttl = TTL_SEC
        # Resolve routes against the vendored station list once; drop (and
        # log) any stop whose CRS is unknown so a bad code degrades gracefully.
        stations = stations_by_crs()
        self._routes = []
        for op, hc, legs in ROUTES:
            stops = [(stations[crs], mins) for crs, mins in legs if crs in stations]
            missing = [crs for crs, _ in legs if crs not in stations]
            if missing:
                log.warning("[rail-sim] unknown CRS %s on %s route — dropped", missing, op)
            if len(stops) >= 2:
                self._routes.append((op, hc, stops))

    @property
    def configured(self) -> bool:
        return True

    def _services_now(self, now: float) -> list[Train]:
        trains: list[Train] = []
        for op, hc, stops in self._routes:
            journey_sec = sum(mins for _, mins in stops) * 60
            # Segment durations between consecutive stops (route order).
            fwd_names = [st for st, _ in stops]
            fwd_segs = [mins for _, mins in stops[1:]]
            for direction in (1, -1):
                names = fwd_names if direction == 1 else list(reversed(fwd_names))
                segs = fwd_segs if direction == 1 else list(reversed(fwd_segs))
                # Departures align to the headway grid so the schedule is stable
                # across ticks/restarts; include every service currently
                # en-route (the earliest left one full journey ago).
                dep = int((now - journey_sec - 120) // HEADWAY_SEC) * HEADWAY_SEC
                while dep <= now + 1:
                    sid = f"sim:{op}:{direction}:{dep}"
                    delay_min = max(0, _jitter(sid, 12) - 6)  # most on time, tail to +5
                    per_stop_delay = delay_min * 60.0 / max(1, len(segs))
                    points: list[CallingPoint] = []
                    t = float(dep)
                    for i, st in enumerate(names):
                        if i > 0:
                            t += segs[i - 1] * 60.0 + per_stop_delay
                        points.append(CallingPoint(st.crs, st.name, st.lat, st.lon, t))
                    dep += HEADWAY_SEC
                    if now > points[-1].t + 120:  # arrived a while ago
                        continue
                    fix = position_at(points, now)
                    if fix is None:
                        continue
                    trains.append(Train(
                        id=sid,
                        headcode=f"{hc}{_jitter(sid + 'n', 90):02d}",
                        operator=op,
                        origin=points[0].name,
                        destination=points[-1].name,
                        lat=fix.lat,
                        lon=fix.lon,
                        bearing=fix.bearing,
                        speed_kn=round(fix.speed_kn, 1),
                        delay_min=float(delay_min) if delay_min else 0.0,
                        next_name=points[min(fix.next_idx, len(points) - 1)].name,
                        stops=[
                            TrainStop(crs=p.crs, name=p.name, lat=p.lat, lon=p.lon, t=p.t)
                            for p in points
                        ],
                        sim=True,
                        ts=now,
                    ))
        return trains

    async def _consume(self) -> None:
        self.connected = True
        while not self._stop.is_set():
            now = time.time()
            for train in self._services_now(now):
                self.messages_seen += 1
                self.last_msg_ts = now
                await self._store.upsert(train)
            await self._store.evict_stale(self._ttl)
            await asyncio.sleep(TICK_SEC)
