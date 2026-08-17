"""Traffic cameras (the "land" domain): TfL JamCams + Traffic Scotland LEV.

``CameraCatalog`` is the one list the API, search, analyst tools and incident
verifier read — TfL cameras fetched from the open feed here, plus whatever
regional providers are plugged in (currently ``ScotCameraCatalog``, fed by its
FTP source). Every row carries ``provider`` + ``attribution`` so the frontend
credits the right operator, and ``image`` is either a public URL (TfL) or a
path on our own API (providers whose frames we hold ourselves).

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

from .scot_cameras import ScotCameraCatalog

log = logging.getLogger("land.cameras")

_UA = "ais-tracker/1.0 (+https://github.com/spwizard/ais-tracker)"
_TTL = 3600.0  # camera catalogue changes rarely; refresh hourly
_TFL_ATTRIBUTION = {"name": "TfL Open Data", "url": "https://tfl.gov.uk/info-for/open-data-users/"}


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
        "provider": "tfl",
        "attribution": _TFL_ATTRIBUTION,
    }


class CameraCatalog:
    def __init__(
        self,
        url: str,
        app_key: str = "",
        scot: ScotCameraCatalog | None = None,
        tfl: bool = True,
    ) -> None:
        self._url = url
        self._key = app_key
        self._tfl = tfl
        self._scot = scot
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0), headers={"User-Agent": _UA}
        )
        self._cache: list[dict] | None = None
        self._expiry = 0.0
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        await self._client.aclose()

    async def list(self) -> list[dict]:
        """All cameras across providers. TfL failures don't hide the others."""
        cams: list[dict] = []
        if self._tfl:
            try:
                cams.extend(await self._list_tfl())
            except httpx.HTTPError as exc:
                if self._scot is None or not len(self._scot):
                    raise
                log.warning("TfL cameras fetch failed (serving other providers): %s", exc)
        if self._scot is not None:
            cams.extend(self._scot.list())
        return cams

    async def find(self, cam_id: str) -> dict | None:
        return next((c for c in await self.list() if c["id"] == cam_id), None)

    def image(self, cam: dict) -> str | bytes | None:
        """What vision should look at: a fetchable URL, or the raw frame bytes
        for providers whose images live in this process. None if no frame."""
        if cam.get("provider") == "scot" and self._scot is not None:
            sc = self._scot.get(cam["id"])
            return sc.frame if sc is not None else None
        return cam.get("image")

    async def _list_tfl(self) -> list[dict]:
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
