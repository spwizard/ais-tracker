"""GFS weather fields → PNGs for the deck.gl raster/particle layers.

Two free, no-key NOAA sources off NOMADS:

* ``WeatherSource`` — GFS 10 m wind (U/V) encoded as a symmetric velocity PNG
  (R=U, G=V) that the frontend particle layer advects and the speed raster
  colours by magnitude.
* ``WaveSource`` — GFS-Wave significant wave height (a scalar field) clipped to a
  real coastline and coloured by the sea-state raster.

Each source encodes several forecast hours from the latest cycle (one PNG per
step) so the frontend can scrub the fields forward in time. Refreshed every few
hours; the encoded PNGs are small and cached on disk.
"""
from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import urllib.request
from typing import Callable

import numpy as np
import xarray as xr
from PIL import Image, ImageDraw

log = logging.getLogger("weather")

CYCLE_LAG_H = 5  # GFS posts ~3.5–5h after its cycle time
WAVE_UPSAMPLE = 8  # smooth the coarse 0.25° wave grid by this factor before encoding

# Real coastline for clipping the wave field — the wave model's own land mask is
# 0.25° blocks (~25 km), which reads as rectangular stair-steps on the map.
NE_LAND_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_10m_land.geojson"
)


def _resize_f(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    """Bilinear resize of a float array (no overshoot, unlike bicubic)."""
    return np.asarray(
        Image.fromarray(arr.astype(np.float32), mode="F").resize((w, h), Image.BILINEAR)
    )


def _inpaint(field: np.ndarray, mask: np.ndarray, iters: int = 16) -> np.ndarray:
    """Fill nodata (land) cells by iteratively diffusing valid neighbour values
    inward, so a later resize near the coast isn't pulled toward zero."""
    out = np.where(mask, field, np.nan)
    for _ in range(iters):
        nan = ~np.isfinite(out)
        if not nan.any():
            break
        valid = np.isfinite(out)
        base = np.where(valid, out, 0.0)
        acc = np.zeros_like(base)
        cnt = np.zeros_like(base)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            acc += np.roll(base, (dy, dx), (0, 1))
            cnt += np.roll(valid.astype(np.float32), (dy, dx), (0, 1))
        avg = np.divide(acc, cnt, out=np.zeros_like(acc), where=cnt > 0)
        here = nan & (cnt > 0)
        out[here] = avg[here]
    return np.nan_to_num(out)


def _download(url: str, min_size: int = 2000) -> str | None:
    """Fetch a GRIB to a temp file; None if it's missing or an error page."""
    try:
        fn, _ = urllib.request.urlretrieve(url)
        if os.path.getsize(fn) < min_size:
            raise ValueError("empty")
        return fn
    except Exception as exc:  # noqa: BLE001
        log.debug("gfs fetch failed: %s", exc)
        return None


def _find_cycle(url_fn: Callable[[str, str, int], str]):
    """Locate the latest posted GFS cycle by probing its f000 file, walking back
    over earlier cycles until one is available. Returns (ymd, hh, f000_path) —
    the analysis GRIB is kept so the caller can reuse it as step 0."""
    for back in range(0, 30, 6):
        t = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
            hours=CYCLE_LAG_H + back
        )
        ymd, hh = t.strftime("%Y%m%d"), f"{(t.hour // 6) * 6:02d}"
        grib = _download(url_fn(ymd, hh, 0))
        if grib is not None:
            return ymd, hh, grib
        log.debug("gfs %s %sz not ready", ymd, hh)
    return None, None, None


def _cycle_epoch(ymd: str, hh: str) -> int:
    t = datetime.datetime.strptime(f"{ymd}{hh}", "%Y%m%d%H").replace(
        tzinfo=datetime.timezone.utc
    )
    return int(t.timestamp())


def _open_region(grib: str, bbox: tuple[float, float, float, float]) -> xr.Dataset:
    """Open a GRIB, rewrap to -180..180, orient north-up, slice to the bbox."""
    W, S, E, N = bbox
    ds = xr.open_dataset(grib, engine="cfgrib", backend_kwargs={"indexpath": ""})
    ds = ds.assign_coords(longitude=(((ds.longitude + 180) % 360) - 180)).sortby(
        "longitude"
    )
    ds = ds.sortby("latitude", ascending=False)  # row 0 = north
    return ds.sel(longitude=slice(W, E), latitude=slice(N, S))


def _cleanup(grib: str) -> None:
    for f in (grib, grib + ".idx"):
        try:
            os.remove(f)
        except OSError:
            pass


class _ForecastSource:
    """Common machinery: build one PNG per forecast hour from the latest cycle,
    expose a meta dict listing the steps, and serve each step's PNG by hour."""

    prefix = "field"

    def __init__(
        self,
        bbox: tuple[float, float, float, float],
        out_dir: str,
        forecast_hours=(0,),
    ) -> None:
        self.bbox = bbox
        self._dir = out_dir
        self._hours = tuple(forecast_hours) or (0,)
        self._meta: dict | None = None

    def _url(self, ymd: str, hh: str, fhh: int) -> str:  # pragma: no cover
        raise NotImplementedError

    def _encode_frame(self, grib: str, fhh: int) -> dict | None:  # pragma: no cover
        """Encode one GRIB to {prefix}_f{fhh}.png; return its per-step meta
        ({imageUnscale, width, height, ...}) or None. Consumes/deletes the GRIB."""
        raise NotImplementedError

    def _png(self, fhh: int) -> str:
        return os.path.join(self._dir, f"{self.prefix}_f{fhh:03d}.png")

    def _build(self) -> dict | None:
        os.makedirs(self._dir, exist_ok=True)
        ymd, hh, grib0 = _find_cycle(self._url)
        if ymd is None:
            log.warning("no %s cycle available", self.prefix)
            return None
        cycle = f"{ymd} {hh}z"
        base = _cycle_epoch(ymd, hh)

        steps: list[dict] = []
        for fhh in self._hours:
            grib = grib0 if fhh == 0 else _download(self._url(ymd, hh, fhh))
            if grib is None:
                log.debug("%s f%03d missing; skipping", self.prefix, fhh)
                continue
            try:
                frame = self._encode_frame(grib, fhh)
            except Exception as exc:  # noqa: BLE001
                _cleanup(grib)
                log.warning("%s f%03d encode failed: %s", self.prefix, fhh, exc)
                continue
            if frame:
                frame["step"] = fhh
                frame["valid"] = base + fhh * 3600
                steps.append(frame)
        if not steps:
            return None

        W, S, E, N = self.bbox
        meta = {
            "bounds": [W, S, E, N],
            "cycle": cycle,
            "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "steps": steps,
        }
        log.info("weather: %s %s → %d forecast step(s)", self.prefix, cycle, len(steps))
        return meta

    async def refresh(self) -> None:
        meta = await asyncio.to_thread(self._build)
        if meta:
            self._meta = meta

    @property
    def meta(self) -> dict | None:
        return self._meta

    def png_path(self, step: int = 0) -> str | None:
        """Path to the PNG for a forecast hour (defaults to the first step)."""
        if not self._meta:
            return None
        avail = {s["step"] for s in self._meta["steps"]}
        if step not in avail:
            step = self._meta["steps"][0]["step"]
        p = self._png(step)
        return p if os.path.isfile(p) else None


class WeatherSource(_ForecastSource):
    """GFS 10 m wind → velocity PNG for the particle + speed-raster layers."""

    prefix = "wind"

    def _url(self, ymd: str, hh: str, fhh: int) -> str:
        return (
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
            f"?dir=/gfs.{ymd}/{hh}/atmos&file=gfs.t{hh}z.pgrb2.0p25.f{fhh:03d}"
            "&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on"
        )

    def _encode_frame(self, grib: str, fhh: int) -> dict | None:
        try:
            reg = _open_region(grib, self.bbox)
            u, v = reg["u10"].values, reg["v10"].values
        finally:
            _cleanup(grib)

        m = float(
            max(abs(np.nanmin(u)), abs(np.nanmax(u)), abs(np.nanmin(v)), abs(np.nanmax(v)), 1e-3)
        )
        r = ((np.nan_to_num(u) + m) / (2 * m) * 255).clip(0, 255).astype(np.uint8)
        g = ((np.nan_to_num(v) + m) / (2 * m) * 255).clip(0, 255).astype(np.uint8)
        rgba = np.stack([r, g, np.zeros_like(r), np.full_like(r, 255)], axis=-1)
        Image.fromarray(rgba, "RGBA").save(self._png(fhh))
        return {
            "width": int(u.shape[1]),
            "height": int(u.shape[0]),
            "imageUnscale": [-m, m],
        }


class WaveSource(_ForecastSource):
    """GFS-Wave significant wave height → scalar PNG for the sea-state raster.

    The field is upsampled and clipped to a real coastline (Natural Earth). The
    frontend's SCALAR raster keys transparency off the value via the palette, so
    the mask is baked into the value: land → 0 → transparent at the true shore.
    ``imageUnscale`` carries the per-step [0, max] metre range.
    """

    prefix = "waves"

    def _url(self, ymd: str, hh: str, fhh: int) -> str:
        return (
            "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
            f"?dir=/gfs.{ymd}/{hh}/wave/gridded&file=gfswave.t{hh}z.global.0p25.f{fhh:03d}.grib2"
            "&var_HTSGW=on&lev_surface=on"
        )

    def _sea_mask(self, w: int, h: int) -> np.ndarray | None:
        """Antialiased sea mask (1=sea, 0=land) at w×h, rasterized from the
        Natural Earth 10m land polygons — a real coastline, far finer than the
        wave model's 0.25° land mask. Built once and cached on disk."""
        cache = os.path.join(self._dir, f"sea_mask_{w}x{h}.npz")
        if os.path.isfile(cache):
            try:
                return np.load(cache)["m"]
            except Exception:  # noqa: BLE001
                pass
        geo = os.path.join(self._dir, "ne_10m_land.json")
        try:
            if not os.path.isfile(geo):
                urllib.request.urlretrieve(NE_LAND_URL, geo)
            with open(geo) as f:
                feats = json.load(f)["features"]
        except Exception as exc:  # noqa: BLE001
            log.warning("NE coastline unavailable (%s); using model land mask", exc)
            return None

        W, S, E, N = self.bbox
        SS = 2  # supersample, then downscale → antialiased coast edge
        img = Image.new("L", (w * SS, h * SS), 255)
        drw = ImageDraw.Draw(img)
        for f in feats:
            g = f["geometry"]
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            for rings in polys:
                for i, ring in enumerate(rings):
                    lons = [p[0] for p in ring]
                    lats = [p[1] for p in ring]
                    if max(lons) < W or min(lons) > E or max(lats) < S or min(lats) > N:
                        continue  # ring entirely outside our region
                    pts = [
                        ((x - W) / (E - W) * w * SS, (N - y) / (N - S) * h * SS)
                        for x, y in zip(lons, lats)
                    ]
                    # Exterior ring = land (0); interior rings = holes (sea).
                    drw.polygon(pts, fill=255 if i else 0)
        m = np.asarray(img.resize((w, h), Image.BILINEAR), dtype=np.float32) / 255.0
        np.savez_compressed(cache, m=m)
        return m

    def _encode_frame(self, grib: str, fhh: int) -> dict | None:
        try:
            reg = _open_region(grib, self.bbox)
            h = reg["swh"].values  # significant wave height, NaN on land
        finally:
            _cleanup(grib)

        mask = np.isfinite(h)
        if not mask.any():
            return None
        max_h = float(max(np.nanmax(h), 1.0))

        # Inpaint land so coastal water interpolates, upsample, then clip with a
        # real coastline (not the model's blocky mask). Bake the mask into the
        # value so land → 0 → transparent right up to the actual shore.
        filled = _inpaint(h, mask, iters=16)
        k = WAVE_UPSAMPLE
        Hh, Ww = filled.shape
        up = _resize_f(filled, Ww * k, Hh * k)
        sea = self._sea_mask(Ww * k, Hh * k)
        if sea is None:  # offline fallback: the model's own (coarse) mask
            sea = np.clip(_resize_f(mask.astype(np.float32), Ww * k, Hh * k), 0, 1)
        up = up * sea

        r = (np.clip(up, 0, max_h) / max_h * 255).astype(np.uint8)
        a = (np.clip(sea, 0, 1) * 255).astype(np.uint8)
        z = np.zeros_like(r)
        rgba = np.stack([r, z, z, a], axis=-1)
        Image.fromarray(rgba, "RGBA").save(self._png(fhh))
        return {
            "width": int(Ww * k),
            "height": int(Hh * k),
            "imageUnscale": [0.0, max_h],
            "max_m": round(max_h, 1),
        }
