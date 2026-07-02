"""London traffic cameras (the "land" domain) via TfL's JamCams open-data feed.

TfL exposes ~880 CCTV cameras at junctions/tunnels/bridges as geolocated
"Place" objects, each carrying a JPEG snapshot (refreshed every few minutes) and
a 5-second looped MP4. The camera *list* barely changes, so we fetch it once and
cache it for an hour; the media URLs are stable (their content updates in place),
so the browser just re-requests them. Keyless anonymous access is fine at this
volume; an app_key only raises rate limits.
"""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

log = logging.getLogger("land.cameras")

_UA = "ais-tracker/1.0 (+https://github.com/spwizard/ais-tracker)"
_TTL = 3600.0  # camera catalogue changes rarely; refresh hourly


def _parse_camera(place: dict) -> dict | None:
    """Trim a TfL JamCam Place object to just what the map + panel need."""
    props = {p.get("key"): p.get("value") for p in place.get("additionalProperties", [])}
    lat, lon = place.get("lat"), place.get("lon")
    image = props.get("imageUrl")
    if lat is None or lon is None or not image:
        return None
    return {
        "id": place.get("id"),
        "name": place.get("commonName"),
        "lat": lat,
        "lon": lon,
        "view": props.get("view"),  # direction the camera faces, e.g. "West"
        "image": image,
        "video": props.get("videoUrl"),
        "available": str(props.get("available")).lower() == "true",
    }


class CameraCatalog:
    def __init__(self, url: str, app_key: str = "") -> None:
        self._url = url
        self._key = app_key
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0), headers={"User-Agent": _UA}
        )
        self._cache: list[dict] | None = None
        self._expiry = 0.0
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def list(self) -> list[dict]:
        if self._cache is not None and self._expiry > time.time():
            return self._cache
        async with self._lock:
            # Re-check inside the lock: another request may have refreshed it.
            if self._cache is not None and self._expiry > time.time():
                return self._cache
            params = {"app_key": self._key} if self._key else None
            resp = await self._client.get(self._url, params=params)
            resp.raise_for_status()
            cams = [c for c in (_parse_camera(p) for p in resp.json()) if c]
            self._cache = cams
            self._expiry = time.time() + _TTL
            log.info("loaded %d TfL cameras", len(cams))
            return cams
