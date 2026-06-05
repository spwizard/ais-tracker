"""AIS ship-type code grouping.

AIS encodes ship & cargo type as a number 0-99 (see ITU-R M.1371). We collapse
those into a handful of human-friendly groups that the UI filters and colours by.
The ``range`` is inclusive on both ends.
"""
from __future__ import annotations

# group key -> {label, color (hex), code ranges}
SHIP_TYPE_GROUPS = [
    {"key": "passenger", "label": "Passenger", "color": "#38bdf8", "ranges": [[60, 69]]},
    {"key": "cargo", "label": "Cargo", "color": "#22c55e", "ranges": [[70, 79]]},
    {"key": "tanker", "label": "Tanker", "color": "#ef4444", "ranges": [[80, 89]]},
    {"key": "highspeed", "label": "High-speed", "color": "#a855f7", "ranges": [[40, 49]]},
    {"key": "tug", "label": "Tug / Special", "color": "#f59e0b", "ranges": [[50, 59], [30, 39]]},
    {"key": "fishing", "label": "Fishing", "color": "#14b8a6", "ranges": [[30, 30]]},
    {"key": "pleasure", "label": "Pleasure / Sailing", "color": "#ec4899", "ranges": [[36, 37]]},
    {"key": "other", "label": "Other / Unknown", "color": "#94a3b8", "ranges": [[0, 29], [90, 99]]},
]


def group_for(ship_type: int | None) -> str:
    if ship_type is None:
        return "other"
    for group in SHIP_TYPE_GROUPS:
        for lo, hi in group["ranges"]:
            if lo <= ship_type <= hi:
                return group["key"]
    return "other"
