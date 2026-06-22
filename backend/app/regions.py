"""Named map regions — preset places the global search and quick-jump expose.

Mirrors the frontend's region presets so "jump to a place" is searchable. Kept
here (not in config) so it can grow into a richer gazetteer later without env."""
from __future__ import annotations

# (name, lon, lat, zoom)
REGIONS: list[tuple[str, float, float, float]] = [
    ("English Channel", -1.0, 50.2, 7.2),
    ("Thames / Dover", 1.3, 51.2, 8.0),
    ("Solent", -1.3, 50.78, 9.5),
    ("Bristol Channel", -3.6, 51.4, 8.0),
    ("Gulf of Finland", 25.0, 59.8, 7.0),
    ("Norway (Skagerrak)", 10.5, 59.2, 7.0),
]


def search_regions(q: str, limit: int = 20) -> tuple[list[dict], int]:
    ql = q.lower().strip()
    hits = [
        {"id": f"region:{name}", "name": name, "kind": "region", "lat": lat, "lon": lon, "zoom": zoom}
        for (name, lon, lat, zoom) in REGIONS
        if ql in name.lower()
    ]
    return hits[:limit], len(hits)
