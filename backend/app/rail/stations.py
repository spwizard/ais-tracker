"""GB railway station coordinates, keyed by CRS code.

Vendored from github.com/davwheat/uk-railway-stations (ODbL — contains OS/OSM
derived data; retain this attribution). ~2,600 stations, loaded once.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_CSV = Path(__file__).parent / "stations.csv"


@dataclass(frozen=True)
class Station:
    crs: str
    name: str
    lat: float
    lon: float


@lru_cache(maxsize=1)
def stations_by_crs() -> dict[str, Station]:
    out: dict[str, Station] = {}
    with _CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            crs = (row.get("crsCode") or "").strip().upper()
            try:
                lat, lon = float(row["lat"]), float(row["long"])
            except (KeyError, TypeError, ValueError):
                continue
            if len(crs) == 3:
                out[crs] = Station(crs, row.get("stationName") or crs, lat, lon)
    return out
