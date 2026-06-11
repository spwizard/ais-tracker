"""Windy Point Forecast — sea state at a single vessel's position.

One on-demand call per vessel-open, cached hard (rounded cell × hour) to respect
the Windy quota. Returns current wind / gusts / waves / temp / pressure in
display units. Degrades to None silently if the key is missing or Windy errors.
"""
from __future__ import annotations

import logging
import math
import time

import httpx

log = logging.getLogger("windy")

URL = "https://api.windy.com/api/point-forecast/v2"
MS_TO_KN = 1.94384


def _first(arr, i=0):
    return arr[i] if isinstance(arr, list) and len(arr) > i else None


class WindyPoint:
    def __init__(self, key: str) -> None:
        self._key = key or None
        self._cache: dict[tuple, dict | None] = {}

    async def forecast(self, lat: float, lon: float) -> dict | None:
        if not self._key:
            return None
        cell = (round(lat * 4) / 4, round(lon * 4) / 4, int(time.time() // 3600))
        if cell in self._cache:
            return self._cache[cell]
        try:
            async with httpx.AsyncClient(timeout=15.0) as c:
                wind = await self._call(c, lat, lon, "gfs", ["wind", "windGust", "temp", "pressure"])
                waves = await self._call(c, lat, lon, "gfsWave", ["waves"])
        except httpx.HTTPError as exc:
            log.warning("windy forecast failed: %s", exc)
            return None
        cond = self._parse(wind, waves)
        self._cache[cell] = cond
        return cond

    async def _call(self, c: httpx.AsyncClient, lat, lon, model, params) -> dict | None:
        r = await c.post(
            URL,
            json={
                "lat": lat,
                "lon": lon,
                "model": model,
                "parameters": params,
                "levels": ["surface"],
                "key": self._key,
            },
        )
        if r.status_code != 200:
            log.warning("windy %s → HTTP %s", model, r.status_code)
            return None
        return r.json()

    @staticmethod
    def _parse(wind: dict | None, waves: dict | None) -> dict | None:
        out: dict = {}
        if wind and wind.get("ts"):
            u, v = _first(wind.get("wind_u-surface")), _first(wind.get("wind_v-surface"))
            if u is not None and v is not None:
                out["wind_kn"] = round(math.hypot(u, v) * MS_TO_KN, 1)
                out["wind_dir"] = round(math.degrees(math.atan2(-u, -v)) % 360)  # FROM
            g = _first(wind.get("gust-surface"))
            if g is not None:
                out["gust_kn"] = round(g * MS_TO_KN, 1)
            t = _first(wind.get("temp-surface"))
            if t is not None:
                out["temp_c"] = round(t - 273.15, 1)
            p = _first(wind.get("pressure-surface"))
            if p is not None:
                out["pressure_hpa"] = round(p / 100)
            out["ts"] = wind["ts"][0]
        if waves and waves.get("ts"):
            h = _first(waves.get("waves_height-surface"))
            if h is not None:
                out["wave_m"] = round(h, 1)
            per = _first(waves.get("waves_period-surface"))
            if per is not None:
                out["wave_period_s"] = round(per, 1)
            wd = _first(waves.get("waves_direction-surface"))
            if wd is not None:
                out["wave_dir"] = round(wd)
        return out or None
