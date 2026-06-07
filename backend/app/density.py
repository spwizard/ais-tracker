"""Historical traffic-density bins.

Every sample tick, each live vessel is binned into an H3 hex cell, and we track
the set of distinct MMSIs seen per (time-bucket, cell). At flush we persist the
*distinct vessel count* per cell — a "how many vessels passed through here this
hour" measure that powers a scrubbable density timeline.

Tiny + bounded: a few hundred water cells × hourly buckets. `ON CONFLICT … MAX`
keeps the peak count per cell even across restarts, so the in-progress hour isn't
lost.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time

import h3

log = logging.getLogger("density")

MAX_POINTS = 5000  # cap per-bucket payload


class DensityRecorder:
    def __init__(self, path: str, res: int, bucket_sec: int) -> None:
        self._path = path
        self._res = res
        self._bucket_sec = bucket_sec
        self._conn: sqlite3.Connection | None = None
        self._bucket: int | None = None
        self._cells: dict[str, set[int]] = {}  # cell -> distinct MMSIs (current bucket)

    def open(self) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS density (
                 bucket INTEGER, cell TEXT, lat REAL, lon REAL, count INTEGER,
                 PRIMARY KEY (bucket, cell)
               )"""
        )
        self._conn.commit()
        n = self._conn.execute("SELECT COUNT(DISTINCT bucket) FROM density").fetchone()[0]
        log.info("density store: %d buckets", n)

    def sample(self, vessels) -> None:
        """Bin the current snapshot into the active time bucket and persist."""
        if self._conn is None:
            return
        bucket = int(time.time() // self._bucket_sec)
        if self._bucket is None:
            self._bucket = bucket
        if bucket != self._bucket:  # hour rolled over
            self._flush()
            self._cells = {}
            self._bucket = bucket
        for v in vessels:
            if v.lat is None or v.lon is None:
                continue
            cell = h3.latlng_to_cell(v.lat, v.lon, self._res)
            self._cells.setdefault(cell, set()).add(v.mmsi)
        self._flush()

    def _flush(self) -> None:
        if self._conn is None or self._bucket is None or not self._cells:
            return
        rows = []
        for cell, mmsis in self._cells.items():
            lat, lon = h3.cell_to_latlng(cell)
            rows.append((self._bucket, cell, lat, lon, len(mmsis)))
        self._conn.executemany(
            """INSERT INTO density (bucket, cell, lat, lon, count) VALUES (?,?,?,?,?)
               ON CONFLICT(bucket, cell) DO UPDATE SET count = MAX(count, excluded.count)""",
            rows,
        )
        self._conn.commit()

    def buckets(self) -> list[int]:
        """Available time buckets, as epoch-second start times, oldest first."""
        if self._conn is None:
            return []
        return [
            r[0] * self._bucket_sec
            for r in self._conn.execute("SELECT DISTINCT bucket FROM density ORDER BY bucket")
        ]

    def points(self, bucket_start: int) -> list[dict]:
        """Cells + counts for a bucket (bucket_start = epoch seconds)."""
        if self._conn is None:
            return []
        bucket = bucket_start // self._bucket_sec
        return [
            {"lat": r[0], "lon": r[1], "count": r[2]}
            for r in self._conn.execute(
                "SELECT lat, lon, count FROM density WHERE bucket=? ORDER BY count DESC LIMIT ?",
                (bucket, MAX_POINTS),
            )
        ]

    def close(self) -> None:
        if self._conn is not None:
            self._flush()
            self._conn.close()
