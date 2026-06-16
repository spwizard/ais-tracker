"""Behavioral risk engine.

Periodic, deterministic detectors over the live vessel store; each hit is
broadcast as a `risk_event` frame (same channel as geofence events). All
findings are explainable — that's the point. Two detectors to start:

  • spoof       — a vessel "jumped" at an impossible speed between fixes
                  (GPS manipulation / AIS spoofing).
  • rendezvous  — two slow, non-anchored vessels stayed within a small radius
                  for a sustained period away from a berth (possible STS transfer).

No port database needed: we exclude anchored/moored vessels to cut harbour
clusters, and require sustained proximity. Refinements (coastline filter,
loitering, identity-change, going-dark) are follow-ups.
"""
from __future__ import annotations

import logging
import math
import time
from collections import deque

log = logging.getLogger("risk")

EARTH_R = 6_371_000.0
M_PER_NM = 1852.0
TELEPORT_MIN_JUMP_M = 5000.0  # ignore sub-5km jitter
SPOOF_COOLDOWN_SEC = 600.0
# A single outlier fix is a GPS glitch, not a spoof. We only fire once a flagged
# jump is *confirmed* by the next fix staying near the jumped-to point (i.e. the
# vessel didn't snap back to its track). This rate bounds "stayed near" travel.
SPOOF_CONFIRM_KN = 60.0
RENDEZVOUS_CELL_DEG = 0.05  # ~3–5 km spatial grid
# A genuine STS is an *isolated* pair; an anchorage / port / lane has a crowd.
# Skip pairs whose 3×3-cell neighbourhood holds more than this many candidates.
RENDEZVOUS_MAX_LOCAL = 6
# Don't re-fire the same pair within this window, even if they separate and
# re-approach (kills repeat alerts from vessels loitering together).
RENDEZVOUS_COOLDOWN_SEC = 43_200.0  # 12 h


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


RECENT_WINDOW_SEC = 3600.0  # how long a behavioral flag stays "recent"


class RiskEngine:
    def __init__(self, store, broadcaster, settings, sanctions=None) -> None:
        self._store = store
        self._b = broadcaster
        self._s = settings
        self._sanctions = sanctions
        # spoof state
        self._last_pos: dict[int, tuple[float, float, float]] = {}
        self._spoof_cooldown: dict[int, float] = {}
        # unconfirmed jumps awaiting a corroborating next fix: mmsi -> (lat, lon, ts, detail)
        self._spoof_pending: dict[int, tuple[float, float, float, dict]] = {}
        # rendezvous state
        self._pair_since: dict[tuple[int, int], float] = {}
        self._pair_fired: set[tuple[int, int]] = set()
        self._pair_cooldown: dict[tuple[int, int], float] = {}  # pair -> last fired
        # recent behavioral events per mmsi (for the risk score)
        self._recent: dict[int, list[dict]] = {}
        # rolling fleet-wide event log (for the analyst's recent_events tool)
        self._event_log: deque[dict] = deque(maxlen=500)

    def recent_for(self, mmsi: int) -> list[dict]:
        cutoff = time.time() - RECENT_WINDOW_SEC
        return [e for e in self._recent.get(mmsi, ()) if e["ts"] >= cutoff]

    def recent_events(self, hours: float = 24.0) -> list[dict]:
        """Fleet-wide behavioral events from the last `hours`, newest first."""
        cutoff = time.time() - hours * 3600.0
        return [e for e in reversed(self._event_log) if e["ts"] >= cutoff]

    async def flagged_set(self, snap=None) -> set[int]:
        """MMSIs currently worth highlighting: recent behavioral flags plus
        sanctions-listed vessels in view."""
        if snap is None:
            snap = await self._store.snapshot()
        flagged = set(self._recent.keys())
        if self._sanctions and self._sanctions.loaded:
            for v in snap:
                if self._sanctions.screen_vessel(
                    imo=v.imo, mmsi=v.mmsi, callsign=v.callsign, by_name=False
                ):
                    flagged.add(v.mmsi)
        return flagged

    async def evaluate(self) -> None:
        snap = await self._store.snapshot()
        now = time.time()
        events: list[dict] = []
        self._detect_spoof(snap, now, events)
        self._detect_rendezvous(snap, now, events)

        for ev in events:
            for m in (ev["mmsi"], ev.get("mmsi_b")):
                if m:
                    self._recent.setdefault(m, []).append({"kind": ev["kind"], "ts": now})
            self._event_log.append(ev)
            await self._b.send_frame(ev)
        self._prune_recent(now)
        await self._broadcast_flagged(snap, now)
        if events:
            log.info("risk: emitted %d events", len(events))

    def _prune_recent(self, now: float) -> None:
        cutoff = now - RECENT_WINDOW_SEC
        for mmsi in list(self._recent):
            kept = [e for e in self._recent[mmsi] if e["ts"] >= cutoff]
            if kept:
                self._recent[mmsi] = kept
            else:
                del self._recent[mmsi]

    async def _broadcast_flagged(self, snap, now: float) -> None:
        """Broadcast the set of MMSIs worth highlighting (see flagged_set)."""
        flagged = await self.flagged_set(snap)
        await self._b.send_frame({"type": "flagged", "mmsis": sorted(flagged)})

    # --- spoof / impossible movement -------------------------------------
    def _detect_spoof(self, snap, now, events) -> None:
        threshold = self._s.risk_teleport_kn
        live = set()
        for v in snap:
            if v.lon is None or v.lat is None:
                continue
            live.add(v.mmsi)
            prev = self._last_pos.get(v.mmsi)
            self._last_pos[v.mmsi] = (v.lat, v.lon, v.ts)

            # A jump we flagged last round is now confirmed only if this fix
            # stayed near the jumped-to point (a glitch snaps back to the track).
            pending = self._spoof_pending.pop(v.mmsi, None)
            if pending is not None:
                blat, blon, bts, detail = pending
                dt2 = v.ts - bts
                back = _haversine_m(blat, blon, v.lat, v.lon)
                plausible = dt2 > 0 and back <= max(
                    TELEPORT_MIN_JUMP_M, SPOOF_CONFIRM_KN * M_PER_NM * (dt2 / 3600.0)
                )
                if plausible and now - self._spoof_cooldown.get(v.mmsi, 0.0) >= SPOOF_COOLDOWN_SEC:
                    self._spoof_cooldown[v.mmsi] = now
                    events.append(
                        {
                            "type": "risk_event",
                            "kind": "spoof",
                            "title": f"Impossible move — {detail['implied_kn']} kn jump",
                            "mmsi": v.mmsi,
                            "name": v.name,
                            "lat": v.lat,
                            "lon": v.lon,
                            "ts": now,
                            "detail": detail,
                        }
                    )
                continue  # confirmed or discarded — don't open a new jump this round

            if prev is None:
                continue
            plat, plon, pts = prev
            dt = v.ts - pts
            if dt <= 0:
                continue
            dist = _haversine_m(plat, plon, v.lat, v.lon)
            if dist < TELEPORT_MIN_JUMP_M:
                continue
            kn = (dist / M_PER_NM) / (dt / 3600.0)
            if kn < threshold:
                continue
            # Flag, but wait for the next fix to confirm it isn't a one-off glitch.
            self._spoof_pending[v.mmsi] = (
                v.lat,
                v.lon,
                v.ts,
                {"implied_kn": round(kn), "jump_nm": round(dist / M_PER_NM, 1), "gap_sec": round(dt)},
            )
        # prune vessels that have left
        self._last_pos = {k: v for k, v in self._last_pos.items() if k in live}
        self._spoof_cooldown = {k: v for k, v in self._spoof_cooldown.items() if k in live}
        self._spoof_pending = {k: v for k, v in self._spoof_pending.items() if k in live}

    # --- rendezvous / STS ------------------------------------------------
    def _detect_rendezvous(self, snap, now, events) -> None:
        slow = self._s.risk_rendezvous_slow_kn
        near_m = self._s.risk_rendezvous_nm * M_PER_NM
        sustain = self._s.risk_rendezvous_min * 60.0

        # STS transfers are a cargo/tanker affair — restricting to those types
        # cuts the pilot-boat / tug clusters that otherwise dominate.
        cand = [
            v
            for v in snap
            if v.lon is not None
            and v.sog is not None
            and v.sog < slow
            and v.nav_status not in (1, 5)  # not anchored/moored
            and v.ship_type is not None
            and 70 <= v.ship_type <= 89  # cargo (70–79) or tanker (80–89)
        ]
        grid: dict[tuple[int, int], list] = {}
        for v in cand:
            grid.setdefault(
                (int(v.lat / RENDEZVOUS_CELL_DEG), int(v.lon / RENDEZVOUS_CELL_DEG)), []
            ).append(v)

        current: set[tuple[int, int]] = set()
        for v in cand:
            cx, cy = int(v.lat / RENDEZVOUS_CELL_DEG), int(v.lon / RENDEZVOUS_CELL_DEG)
            # Isolation gate: count candidates in the 3×3 neighbourhood. A real STS
            # is an isolated pair; a crowd here means an anchorage / port / lane.
            local = sum(
                len(grid.get((cx + dx, cy + dy), ()))
                for dx in (-1, 0, 1)
                for dy in (-1, 0, 1)
            )
            crowded = local > RENDEZVOUS_MAX_LOCAL
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for u in grid.get((cx + dx, cy + dy), ()):
                        if u.mmsi <= v.mmsi:
                            continue
                        d = _haversine_m(v.lat, v.lon, u.lat, u.lon)
                        if d > near_m:
                            continue
                        pair = (v.mmsi, u.mmsi)
                        current.add(pair)
                        since = self._pair_since.setdefault(pair, now)
                        if (
                            not crowded
                            and pair not in self._pair_fired
                            and now - since >= sustain
                            and now - self._pair_cooldown.get(pair, 0.0) >= RENDEZVOUS_COOLDOWN_SEC
                        ):
                            self._pair_fired.add(pair)
                            self._pair_cooldown[pair] = now
                            events.append(
                                {
                                    "type": "risk_event",
                                    "kind": "rendezvous",
                                    "title": "Possible STS rendezvous",
                                    "mmsi": v.mmsi,
                                    "name": v.name,
                                    "mmsi_b": u.mmsi,
                                    "name_b": u.name,
                                    "lat": (v.lat + u.lat) / 2,
                                    "lon": (v.lon + u.lon) / 2,
                                    "ts": now,
                                    "detail": {
                                        "duration_min": round((now - since) / 60),
                                        "dist_nm": round(d / M_PER_NM, 2),
                                    },
                                }
                            )
        # forget pairs that have separated (cooldown persists so they can't
        # immediately re-fire on re-approach)
        for pair in list(self._pair_since):
            if pair not in current:
                self._pair_since.pop(pair, None)
                self._pair_fired.discard(pair)
        cutoff = now - RENDEZVOUS_COOLDOWN_SEC
        self._pair_cooldown = {p: t for p, t in self._pair_cooldown.items() if t >= cutoff}
