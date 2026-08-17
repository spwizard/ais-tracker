"""Traffic Scotland LEV cameras — the Scottish half of the camera domain.

Traffic Scotland grants (on application) FTP access to ~500 trunk-road CCTV
stills, refreshed every 5–10 minutes. Unlike TfL there's no public URL per
image: the whole set is pulled in one FTP session by ``ScotCameraSource`` and
held here as bytes, so the browser (and Claude vision) fetch frames from *our*
backend. This module is the in-memory frame store + the catalogue shape the
merged camera list expects; the FTP polling lives in ``sources/scot_cameras``.

Terms: images may only be used for the purpose applied for, credentials must
never leave the backend, and the Traffic Scotland logo + a link to
traffic.gov.scot must appear wherever a frame is shown (the frontend does).
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
import time
from collections import Counter
from dataclasses import dataclass, field

from .osgb import bng_to_wgs84

PROVIDER = "scot"
ID_PREFIX = "scot-"
ATTRIBUTION = {"name": "Traffic Scotland", "url": "https://www.traffic.gov.scot/"}

# Trailing compass words in the presentation name give us the view direction,
# e.g. "Achavanich North", "A725 Raith (N)", "M8 J8 Eastbound".
_VIEW_RE = re.compile(
    r"\(?\b(north|south|east|west|n|s|e|w)(?:bound|erly)?\)?\s*$", re.IGNORECASE
)
_VIEW_WORD = {"n": "North", "s": "South", "e": "East", "w": "West"}


def view_from_name(name: str) -> str | None:
    m = _VIEW_RE.search(name or "")
    if not m:
        return None
    w = m.group(1).lower()
    return _VIEW_WORD.get(w, w.capitalize())


@dataclass
class ScotCamera:
    id: str
    file: str          # image filename on the FTP server, e.g. "7_753.jpg"
    name: str
    lat: float
    lon: float
    view: str | None
    frame: bytes | None = None
    frame_ts: float = 0.0     # epoch seconds the frame was fetched
    available: bool = False   # False for the "Currently Unavailable" graphic
    etag: str = ""

    def public(self) -> dict:
        """Row shape shared with TfL cameras (see land/cameras._parse_camera)."""
        return {
            "id": self.id,
            "name": self.name,
            "lat": self.lat,
            "lon": self.lon,
            "view": self.view,
            "image": f"/api/cameras/scot/{self.file}",
            "video": None,
            "available": self.available,
            "provider": PROVIDER,
            "attribution": ATTRIBUTION,
            "updated": self.frame_ts or None,
        }


def parse_catalogue(text: str) -> list[ScotCamera]:
    """``cameraimages.csv``: PresentationName,ImageName,LocationX,LocationY (BNG)."""
    out: list[ScotCamera] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            file = (row.get("ImageName") or "").strip()
            name = (row.get("PresentationName") or "").strip()
            e, n = float(row["LocationX"]), float(row["LocationY"])
        except (KeyError, TypeError, ValueError):
            continue
        if not file or not name:
            continue
        lat, lon = bng_to_wgs84(e, n)
        cam_id = ID_PREFIX + file.rsplit(".", 1)[0]
        out.append(ScotCamera(cam_id, file, name, lat, lon, view_from_name(name)))
    return out


def placeholder_hashes(frames: dict[str, bytes], min_shared: int = 4) -> set[str]:
    """When a camera is down Traffic Scotland swaps in a stock "Currently
    Unavailable" graphic — byte-identical across every offline camera. Any
    frame shared by several cameras in one sweep is therefore that graphic
    (real scenes never collide), which stays true if they redesign it."""
    counts = Counter(hashlib.md5(b).hexdigest() for b in frames.values())
    return {h for h, c in counts.items() if c >= min_shared}


class ScotCameraCatalog:
    """Frame store written by the FTP source, read by the API + vision."""

    def __init__(self) -> None:
        self._cams: dict[str, ScotCamera] = {}
        self._by_file: dict[str, ScotCamera] = {}
        self.updated = 0.0

    def __len__(self) -> int:
        return len(self._cams)

    def list(self) -> list[dict]:
        return [c.public() for c in self._cams.values()]

    def get(self, cam_id: str) -> ScotCamera | None:
        return self._cams.get(cam_id)

    def by_file(self, file: str) -> ScotCamera | None:
        return self._by_file.get(file)

    def apply_sweep(self, cams: list[ScotCamera], frames: dict[str, bytes], now: float | None = None) -> int:
        """Merge one FTP sweep: replace the catalogue, attach fetched frames.
        Cameras whose frame failed to download keep their previous frame (a
        stale picture beats a hole); missing/placeholder frames read offline.
        Returns the number of live (non-placeholder) frames."""
        now = now or time.time()
        junk = placeholder_hashes(frames)
        live = 0
        new: dict[str, ScotCamera] = {}
        for cam in cams:
            prev = self._cams.get(cam.id)
            data = frames.get(cam.file)
            if data is not None:
                cam.frame = data
                cam.frame_ts = now
                cam.etag = hashlib.md5(data).hexdigest()
                cam.available = cam.etag not in junk
            elif prev is not None:
                cam.frame, cam.frame_ts, cam.etag = prev.frame, prev.frame_ts, prev.etag
                cam.available = prev.available
            live += cam.available
            new[cam.id] = cam
        self._cams = new
        self._by_file = {c.file: c for c in new.values()}
        self.updated = now
        return live
