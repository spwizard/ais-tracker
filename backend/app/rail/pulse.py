"""State of the Railway — live national punctuality aggregation.

Reduces the whole live train picture to a health snapshot: overall punctuality,
the spread of lateness, and a per-operator league table (for services whose
operator we've identified from schedule messages).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from ..models import Train

LATE_MIN = 1.0  # a service this many minutes down counts as "late"
BAD_MIN = 5.0   # "significantly late"


def _label(t: Train) -> str:
    """A human name for a service: headcode + operator when known, else route."""
    if t.headcode and t.operator:
        return f"{t.headcode} {t.operator}"
    route = f"{t.origin} → {t.destination}" if t.origin and t.destination else (t.origin or t.destination or "service")
    return f"{t.operator} · {route}" if t.operator else route


def compute_pulse(trains: Iterable[Train]) -> dict:
    trains = list(trains)
    total = len(trains)
    if total == 0:
        return {"total": 0, "on_time_pct": None, "late": 0, "bad": 0, "avg_delay": 0.0,
                "operators": [], "worst": None, "fastest": None}

    late = bad = 0
    delay_sum = 0.0
    # operator -> [count, late, delay_sum]
    by_op: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for t in trains:
        d = float(t.delay_min or 0.0)
        delay_sum += max(d, 0.0)
        if d >= LATE_MIN:
            late += 1
        if d >= BAD_MIN:
            bad += 1
        if t.operator:
            row = by_op[t.operator]
            row[0] += 1
            if d >= BAD_MIN:  # not-punctual by the 5-min PPM line
                row[1] += 1
            row[2] += max(d, 0.0)

    # "On time" follows the industry PPM convention: within 5 minutes counts as
    # punctual (a strict 1-minute line makes the headline read far worse than
    # the punctuality figures the public knows). `late` is still surfaced.
    punctual = total - bad
    operators = [
        {
            "name": name,
            "count": int(c),
            "on_time_pct": round(100.0 * (c - bd) / c) if c else 0,
            "avg_delay": round(ds / c, 1) if c else 0.0,
        }
        for name, (c, bd, ds) in by_op.items()
        if c >= 3  # ignore tiny samples in the league table
    ]
    # Worst punctuality first, but sizeable operators break ties upward.
    operators.sort(key=lambda o: (o["on_time_pct"], -o["count"]))

    # Extremes — the shareable "worst train in Britain" and the fastest mover.
    placed = [t for t in trains if t.lat is not None and t.lon is not None]
    worst_t = max(placed, key=lambda t: t.delay_min or 0.0, default=None)
    # Cap the "fastest" at a plausible line speed — interpolation between sparse
    # calling points can overshoot real ~125 mph (108 kn) top speeds.
    fast_candidates = [t for t in placed if (t.speed_kn or 0) <= 112]
    fast_t = max(fast_candidates, key=lambda t: t.speed_kn or 0.0, default=None)
    worst = None
    if worst_t and (worst_t.delay_min or 0) >= 1:
        worst = {"id": worst_t.id, "label": _label(worst_t),
                 "delay_min": round(worst_t.delay_min or 0), "next": worst_t.next_name,
                 "lat": worst_t.lat, "lon": worst_t.lon}
    fastest = None
    if fast_t and (fast_t.speed_kn or 0) > 0:
        fastest = {"id": fast_t.id, "label": _label(fast_t),
                   "mph": round((fast_t.speed_kn or 0) * 1.15078), "next": fast_t.next_name,
                   "lat": fast_t.lat, "lon": fast_t.lon}

    return {
        "total": total,
        "on_time_pct": round(100.0 * punctual / total),
        "late": late,  # 1+ min down
        "bad": bad,    # 5+ min down (the not-punctual set)
        "avg_delay": round(delay_sum / total, 1),
        "operators": operators,
        "worst": worst,
        "fastest": fastest,
    }
