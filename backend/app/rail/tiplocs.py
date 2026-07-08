"""TIPLOC → location mapping (Darwin speaks TIPLOC, maps speak lat/lon).

Bundled from the community national-rail-stations dataset (Darwin reference
derived; github.com/fasteroute/national-rail-stations), coordinates joined
against our ODbL station file where the source lacked them. A file at
``data/tiplocs.csv`` (same columns) overrides the bundle — drop the Darwin
Timetable reference extract there once we consume it for full coverage.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_BUNDLED = Path(__file__).parent / "tiplocs.csv"
_OVERRIDE = Path("data/tiplocs.csv")


@dataclass(frozen=True)
class TiplocLocation:
    tiploc: str
    crs: str
    name: str
    lat: float
    lon: float


@lru_cache(maxsize=1)
def tiploc_map() -> dict[str, TiplocLocation]:
    path = _OVERRIDE if _OVERRIDE.is_file() else _BUNDLED
    out: dict[str, TiplocLocation] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            try:
                out[row["tiploc"].strip()] = TiplocLocation(
                    row["tiploc"].strip(),
                    (row.get("crs") or "").strip().upper(),
                    row.get("name") or row["tiploc"],
                    float(row["lat"]),
                    float(row["lon"]),
                )
            except (KeyError, TypeError, ValueError):
                continue
    return out
