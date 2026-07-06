"""London Underground live-train source (TfL Arrivals inference).

One request per poll covers all 11 lines. Per (line, vehicleId) we take the
soonest prediction — its currentLocation + time-to-station place the train on
a segment of the line's real geometry (see land/tube.infer_position).
"""
from __future__ import annotations

import asyncio
import time

import httpx

from ..config import Settings
from ..land.tube import TUBE_LINES, TubeNetwork, infer_position
from ..models import TubeTrain
from ..store.tube import TubeStore
from .base import Source

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 25.0
TTL_SEC = 90  # trains vanish at the terminus; predictions stop, entry ages out


class TubeSource(Source):
    name = "tfl-tube"

    def __init__(self, store: TubeStore, network: TubeNetwork, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._network = network
        self._app_key = settings.tfl_app_key

    @property
    def configured(self) -> bool:
        return True  # keyless works; an app_key just raises the rate limits

    async def _consume(self) -> None:
        ids = ",".join(TUBE_LINES)
        params = {"app_key": self._app_key} if self._app_key else {}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                lines = await self._network.lines()  # cached geometry + status
                resp = await client.get(
                    f"https://api.tfl.gov.uk/Line/{ids}/Arrivals", params=params
                )
                resp.raise_for_status()
                now = time.time()

                # Soonest prediction per train.
                best: dict[str, dict] = {}
                for p in resp.json():
                    vid = p.get("vehicleId")
                    lid = p.get("lineId")
                    if not vid or vid == "000" or lid not in lines:
                        continue
                    key = f"{lid}:{vid}"
                    if key not in best or p.get("timeToStation", 1e9) < best[key].get("timeToStation", 1e9):
                        best[key] = p

                for key, p in best.items():
                    lid = p["lineId"]
                    geo = lines[lid]
                    towards = p.get("towards") or p.get("destinationName") or ""
                    fix = infer_position(
                        geo,
                        p.get("currentLocation"),
                        p.get("stationName") or "",
                        float(p.get("timeToStation") or 0),
                        towards=towards,
                    )
                    if fix is None:
                        continue
                    self.messages_seen += 1
                    self.last_msg_ts = now
                    await self._store.upsert(TubeTrain(
                        id=key,
                        line=lid,
                        line_name=geo.name,
                        towards=towards.replace(" Underground Station", "") or None,
                        next_station=(p.get("stationName") or "").replace(" Underground Station", "") or None,
                        tts=float(p.get("timeToStation") or 0),
                        current_location=p.get("currentLocation"),
                        lat=fix[0],
                        lon=fix[1],
                        bearing=fix[2],
                        speed_kn=round(fix[3], 1),
                        ts=now,
                    ))
                await self._store.evict_stale(TTL_SEC)
                await asyncio.sleep(POLL_SEC)
