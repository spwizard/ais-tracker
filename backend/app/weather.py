"""GFS 10 m wind field → velocity PNG for the deck.gl particle layer.

Fetches the latest NOAA GFS cycle (free, no key), rewraps the prime meridian,
subsets to the app region, and encodes U/V into an RGBA PNG that the frontend
particle layer advects (R=U, G=V, packed against a symmetric range so a single
`imageUnscale` reconstructs both). Refreshed every few hours; tiny + cached.
"""
from __future__ import annotations

import asyncio
import datetime
import logging
import os
import urllib.request

import numpy as np
import xarray as xr
from PIL import Image

log = logging.getLogger("weather")

CYCLE_LAG_H = 5  # GFS posts ~3.5–5h after its cycle time


class WeatherSource:
    def __init__(self, bbox: tuple[float, float, float, float], out_dir: str) -> None:
        self.W, self.S, self.E, self.N = bbox  # west, south, east, north
        self._dir = out_dir
        self._png = os.path.join(out_dir, "wind.png")
        self._meta: dict | None = None

    def _gfs_url(self, ymd: str, hh: str) -> str:
        return (
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
            f"?dir=/gfs.{ymd}/{hh}/atmos&file=gfs.t{hh}z.pgrb2.0p25.f000"
            "&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on"
        )

    def _build(self) -> dict | None:
        os.makedirs(self._dir, exist_ok=True)
        grib = cycle = None
        for back in range(0, 30, 6):  # latest cycle, falling back if not posted yet
            t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
                hours=CYCLE_LAG_H + back
            )
            ymd, hh = t.strftime("%Y%m%d"), f"{(t.hour // 6) * 6:02d}"
            try:
                fn, _ = urllib.request.urlretrieve(self._gfs_url(ymd, hh))
                if os.path.getsize(fn) < 2000:
                    raise ValueError("empty")
                grib, cycle = fn, f"{ymd} {hh}z"
                break
            except Exception as exc:  # noqa: BLE001
                log.debug("gfs %s %sz not ready: %s", ymd, hh, exc)
        if grib is None:
            log.warning("no GFS cycle available")
            return None

        try:
            ds = xr.open_dataset(grib, engine="cfgrib", backend_kwargs={"indexpath": ""})
            ds = ds.assign_coords(
                longitude=(((ds.longitude + 180) % 360) - 180)
            ).sortby("longitude")
            ds = ds.sortby("latitude", ascending=False)  # row 0 = north
            reg = ds.sel(longitude=slice(self.W, self.E), latitude=slice(self.N, self.S))
            u, v = reg["u10"].values, reg["v10"].values
        finally:
            for f in (grib, grib + ".idx"):
                try:
                    os.remove(f)
                except OSError:
                    pass

        m = float(max(abs(np.nanmin(u)), abs(np.nanmax(u)), abs(np.nanmin(v)), abs(np.nanmax(v)), 1e-3))
        r = ((np.nan_to_num(u) + m) / (2 * m) * 255).clip(0, 255).astype(np.uint8)
        g = ((np.nan_to_num(v) + m) / (2 * m) * 255).clip(0, 255).astype(np.uint8)
        rgba = np.stack([r, g, np.zeros_like(r), np.full_like(r, 255)], axis=-1)
        Image.fromarray(rgba, "RGBA").save(self._png)

        meta = {
            "bounds": [self.W, self.S, self.E, self.N],
            "width": int(u.shape[1]),
            "height": int(u.shape[0]),
            "imageUnscale": [-m, m],
            "cycle": cycle,
            "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        log.info("weather: GFS %s → %dx%d wind field (±%.1f m/s)", cycle, meta["width"], meta["height"], m)
        return meta

    async def refresh(self) -> None:
        meta = await asyncio.to_thread(self._build)
        if meta:
            self._meta = meta

    @property
    def meta(self) -> dict | None:
        return self._meta

    @property
    def png_path(self) -> str | None:
        return self._png if self._meta and os.path.isfile(self._png) else None
