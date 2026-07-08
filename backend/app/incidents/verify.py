"""Camera verification of incidents — Argus's credibility superpower.

An inferred incident (a circling helicopter, a suspected hold) near a traffic
camera gets checked with vision: does the scene actually support it? That
converts a suspicion into confirmed / cleared evidence, which nobody else can
do. Official incidents are already authoritative, so we only spend vision on
inferred ones, once, and refresh occasionally.
"""
from __future__ import annotations

import math
import time

from ..models import Incident

VERIFY_RADIUS_M = 1200.0   # only verify when a camera is this close to the scene
REVERIFY_SEC = 600.0       # re-check a still-live incident every 10 min
MAX_PER_CYCLE = 3          # cap vision calls per pass (cost + rate control)


def _dist_m(lat1, lon1, lat2, lon2) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    p = math.radians((lat1 + lat2) / 2)
    return 6_371_000 * math.hypot(dlat, dlon * math.cos(p))


def _nearest_camera(inc: Incident, cameras: list[dict]) -> dict | None:
    best, best_d = None, VERIFY_RADIUS_M
    for c in cameras:
        if not c.get("available") or c.get("lat") is None:
            continue
        d = _dist_m(inc.lat, inc.lon, c["lat"], c["lon"])
        if d < best_d:
            best_d, best = d, c
    return best


class IncidentVerifier:
    def __init__(self, analyst, cameras) -> None:
        self._analyst = analyst   # CameraAnalyst (vision)
        self._cameras = cameras   # CameraCatalog

    def _due(self, inc: Incident, now: float) -> bool:
        if inc.confidence != "inferred":
            return False
        return inc.verified_at == 0.0 or (now - inc.verified_at) > REVERIFY_SEC

    async def run(self, store, now: float) -> None:
        if self._analyst is None or self._cameras is None:
            return
        incidents = await store.snapshot()
        due = [i for i in incidents if self._due(i, now)]
        if not due:
            return
        try:
            cams = await self._cameras.list()
        except Exception:  # noqa: BLE001
            return
        # Oldest-checked first, capped per cycle.
        due.sort(key=lambda i: i.verified_at)
        for inc in due[:MAX_PER_CYCLE]:
            cam = _nearest_camera(inc, cams)
            if cam is None:
                inc.verified_at = now  # no camera to see it — don't retry hard
                await store.upsert(inc)
                continue
            try:
                v = await self._analyst.verify(cam["image"], f"{inc.title}. {inc.detail or ''}")
            except Exception:  # noqa: BLE001
                inc.verified_at = now
                await store.upsert(inc)
                continue
            inc.verified_at = now
            inc.verified_camera = cam.get("name")
            inc.verification_note = v.note
            inc.verification = "confirmed" if v.verdict == "confirmed" else (
                "cleared" if v.verdict == "nothing" else None
            )
            inc.updated = now
            await store.upsert(inc)
