"""Delay hotspots — where lateness is concentrating on the network right now.

Nobody surfaces this: we hold every delayed train's position, so we can cluster
them geographically and name where the pain is. A coarse grid bins delayed
services; the heaviest cells (by summed delay-minutes) are the hotspots, each
named by the nearest big delayed service's next calling point.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from ..models import Train

MIN_DELAY = 5.0  # only services this far down feed a hotspot
CELL_DEG = 0.22  # ~15-25km grid cell — merges adjacent big-city clusters


def compute_hotspots(trains: Iterable[Train], top: int = 6) -> dict:
    # cell -> [delay_sum, count, worst_train]
    cells: dict[tuple[int, int], list] = defaultdict(lambda: [0.0, 0, None])
    points: list[dict] = []
    for t in trains:
        d = float(t.delay_min or 0.0)
        if d < MIN_DELAY or t.lat is None or t.lon is None:
            continue
        points.append({"lat": t.lat, "lon": t.lon, "delay": d})
        key = (round(t.lat / CELL_DEG), round(t.lon / CELL_DEG))
        c = cells[key]
        c[0] += d
        c[1] += 1
        if c[2] is None or d > (c[2].delay_min or 0):
            c[2] = t

    hotspots = []
    for (gy, gx), (dsum, count, worst) in cells.items():
        if count < 2:  # a single late train isn't a hotspot
            continue
        hotspots.append({
            "lat": (gy * CELL_DEG),
            "lon": (gx * CELL_DEG),
            "count": count,
            "delay_sum": round(dsum),
            "where": (worst.next_name or worst.destination) if worst else None,
        })
    hotspots.sort(key=lambda h: h["delay_sum"], reverse=True)
    return {"points": points, "hotspots": hotspots[:top]}
