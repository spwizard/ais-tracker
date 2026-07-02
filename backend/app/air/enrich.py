"""Aircraft enrichment — the air-domain analogue of the vessel ownership lookup.

Given a live aircraft (ICAO hex + callsign), fetch static airframe details
(registration, type, operator, photo) and the flight route (origin → destination
airports) from adsbdb.com — a free, keyless public API. Results are cached hard,
since they only change per-airframe (permanent) or per-flight (hours), and this
is only ever hit when a user opens an aircraft's detail panel.
"""
from __future__ import annotations

import logging
import time

import httpx

log = logging.getLogger("air.enrich")

_UA = "ais-tracker/1.0 (+https://github.com/spwizard/ais-tracker)"

# Cache lifetimes (seconds). Airframe data is effectively permanent; routes are
# stable for the duration of a flight. Negative results are cached briefly so a
# newly-added aircraft/route can appear without hammering the API.
_AC_TTL = 24 * 3600
_AC_TTL_MISS = 6 * 3600
_RT_TTL = 3600
_RT_TTL_MISS = 1800


def _airport(node: dict | None) -> dict | None:
    if not node:
        return None
    return {
        "name": node.get("name"),
        "iata": node.get("iata_code"),
        "icao": node.get("icao_code"),
        "municipality": node.get("municipality"),
        "country": node.get("country_name"),
        "country_iso": node.get("country_iso_name"),
        "lat": node.get("latitude"),
        "lon": node.get("longitude"),
    }


class AircraftEnricher:
    def __init__(self, base: str = "https://api.adsbdb.com") -> None:
        self._base = base.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0), headers={"User-Agent": _UA}
        )
        # key -> (expiry_ts, value|None)
        self._ac_cache: dict[str, tuple[float, dict | None]] = {}
        self._rt_cache: dict[str, tuple[float, dict | None]] = {}

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str) -> dict | None:
        """GET a JSON `response` envelope; None on 404/unknown or any error."""
        try:
            resp = await self._client.get(f"{self._base}{path}")
        except httpx.HTTPError as exc:
            log.warning("adsbdb %s failed: %s", path, exc)
            return None
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            log.warning("adsbdb %s → HTTP %s", path, resp.status_code)
            return None
        body = resp.json().get("response")
        # adsbdb returns the string "unknown ..." (not an object) for misses.
        return body if isinstance(body, dict) else None

    async def aircraft(self, hexid: str) -> dict | None:
        """Airframe details by ICAO24 hex: registration, type, operator, photo."""
        key = hexid.lower()
        hit = self._ac_cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        body = await self._get(f"/v0/aircraft/{key}")
        ac = (body or {}).get("aircraft") if body else None
        info = (
            {
                "registration": ac.get("registration"),
                "type": ac.get("type"),
                "icao_type": ac.get("icao_type"),
                "manufacturer": ac.get("manufacturer"),
                "owner": ac.get("registered_owner"),
                "owner_country": ac.get("registered_owner_country_name"),
                "owner_country_iso": ac.get("registered_owner_country_iso_name"),
                "operator_flag": ac.get("registered_owner_operator_flag_code"),
                "photo": ac.get("url_photo"),
                "photo_thumb": ac.get("url_photo_thumbnail"),
            }
            if ac
            else None
        )
        ttl = _AC_TTL if info else _AC_TTL_MISS
        self._ac_cache[key] = (time.time() + ttl, info)
        return info

    async def route(self, callsign: str) -> dict | None:
        """Flight route by callsign: airline + origin/destination airports."""
        key = callsign.strip().upper()
        if not key:
            return None
        hit = self._rt_cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        body = await self._get(f"/v0/callsign/{key}")
        fr = (body or {}).get("flightroute") if body else None
        route = None
        if fr:
            airline = fr.get("airline") or {}
            route = {
                "airline": {
                    "name": airline.get("name"),
                    "icao": airline.get("icao"),
                    "iata": airline.get("iata"),
                },
                "origin": _airport(fr.get("origin")),
                "destination": _airport(fr.get("destination")),
            }
        ttl = _RT_TTL if route else _RT_TTL_MISS
        self._rt_cache[key] = (time.time() + ttl, route)
        return route
