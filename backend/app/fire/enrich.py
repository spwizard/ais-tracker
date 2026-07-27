"""Enrich fire complexes with the human context: what's near it, and where the
wind is driving it.

Two free sources, both cached hard so a busy fire season doesn't hammer them:
  - Open-Meteo  → wind speed + direction at the fire (no key).
  - Nominatim   → nearest settlement to the fire, and the settlement in the
                  spread path (reverse geocode; ≤1 req/sec).

Wind direction is meteorological (the bearing it blows *from*); a fire is pushed
the opposite way, so spread bearing = wind_from + 180.
"""
from __future__ import annotations

import asyncio

import httpx

from ..models import FireComplex
from .cluster import compass, destination

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"


def _flag(country_code: str | None) -> str | None:
    """ISO 3166-1 alpha-2 → flag emoji (two regional-indicator letters). Robust
    to Nominatim returning country names in local scripts."""
    if not country_code or len(country_code) != 2 or not country_code.isalpha():
        return None
    return "".join(chr(0x1F1E6 + ord(c) - ord("a")) for c in country_code.lower())


async def _wind(client: httpx.AsyncClient, lat: float, lon: float, cache: dict):
    key = (round(lat, 2), round(lon, 2))
    if key in cache:
        return cache[key]
    result = (None, None)
    try:
        r = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": lat, "longitude": lon,
                    "current": "wind_speed_10m,wind_direction_10m"},
        )
        r.raise_for_status()
        cur = r.json().get("current", {})
        result = (cur.get("wind_direction_10m"), cur.get("wind_speed_10m"))
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    cache[key] = result
    return result


async def _place(client: httpx.AsyncClient, lat: float, lon: float, cache: dict):
    """Nearest settlement → (name, region, country, country_code). Nominatim
    asks ≤1 req/sec."""
    key = (round(lat, 3), round(lon, 3))
    if key in cache:
        return cache[key]
    result = (None, None, None, None)
    await asyncio.sleep(1.1)
    try:
        r = await client.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "zoom": 12,
                    "addressdetails": 1},
            headers={"User-Agent": _UA},
        )
        r.raise_for_status()
        a = r.json().get("address", {})
        name = (a.get("village") or a.get("town") or a.get("city")
                or a.get("municipality") or a.get("county"))
        result = (name, a.get("state"), a.get("country"), a.get("country_code"))
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    cache[key] = result
    return result


async def enrich_complex(
    fc: FireComplex, client: httpx.AsyncClient, place_cache: dict, wind_cache: dict
) -> FireComplex:
    name, region, country, cc = await _place(client, fc.lat, fc.lon, place_cache)
    fc.place = name
    fc.region = region
    fc.country = country
    fc.flag = _flag(cc)

    wind_from, wind_kmh = await _wind(client, fc.lat, fc.lon, wind_cache)
    if wind_from is not None:
        spread = (wind_from + 180.0) % 360.0
        fc.wind_from = round(wind_from, 0)
        fc.wind_kmh = round(wind_kmh, 1) if wind_kmh is not None else None
        fc.spread_deg = round(spread, 0)
        fc.spread_compass = compass(spread)
        # Name the settlement ~12 km downwind — the place in the fire's path.
        dlat, dlon = destination(fc.lat, fc.lon, spread, 12.0)
        dname, _, _, _ = await _place(client, dlat, dlon, place_cache)
        if dname and dname != name:
            fc.downwind_place = dname
    return fc
