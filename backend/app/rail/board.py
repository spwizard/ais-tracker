"""Live station departure boards, built from the in-memory train picture.

Shared by the analyst's `station_board` tool and the REST endpoint behind the
UI's clickable stations. Matching prefers an exact station name / CRS hit and
only falls back to substring — "Reading" must not sweep in Reading West.
"""
from __future__ import annotations

import time
from typing import Iterable

from ..models import Train


def build_board(trains: Iterable[Train], query: str, limit: int = 12) -> dict:
    q = (query or "").strip().lower()
    if not q:
        return {"error": "station required"}
    now = time.time()

    exact: list[tuple[float, Train, object]] = []
    fuzzy: list[tuple[float, Train, object]] = []
    for t in trains:
        for s in t.stops:
            name = (s.name or "").lower()
            is_exact = name == q or (len(q) == 3 and s.crs.lower() == q)
            if is_exact or (len(q) > 3 and q in name):
                if s.t >= now - 120:
                    (exact if is_exact else fuzzy).append((s.t, t, s))
                break
    calls = exact if exact else fuzzy
    calls.sort(key=lambda x: x[0])

    first = calls[0][2] if calls else None
    return {
        "station": getattr(first, "name", None),
        "crs": getattr(first, "crs", None),
        "total_upcoming": len(calls),
        "services": [
            {
                "t": ct,
                "id": t.id,
                "from": t.origin,
                "to": t.destination,
                "delay_min": round(t.delay_min or 0),
            }
            for ct, t, _s in calls[: max(1, min(limit, 30))]
        ],
    }
