"""Historical vessel-position store (powers replay/scrubbing).

Every sample tick the live snapshot is appended to a flat positions table, keyed
on ``(mmsi, ts)`` so re-sampling a vessel that hasn't moved since the last fix is
a harmless no-op (``INSERT OR IGNORE``). Old rows are pruned to a rolling window,
so the table stays bounded regardless of uptime.

This is the position-level analogue of ``density.py`` (which keeps only distinct
counts per cell). Here we keep the actual track points so the frontend can draw a
``TripsLayer`` and scrub vessel movement through time.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time

log = logging.getLogger("history")

# Cap points returned per vessel in one replay window. At 30s sampling a 48h
# window is ~5760 points/vessel; we decimate evenly to keep the payload — and the
# TripsLayer geometry — sane. Plenty smooth for playback.
MAX_POINTS_PER_TRACK = 1500


class TrackHistory:
    def __init__(self, path: str, window_sec: int) -> None:
        self._path = path
        self._window_sec = window_sec
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS positions (
                 mmsi INTEGER, ts INTEGER, lon REAL, lat REAL,
                 sog REAL, cog REAL, heading REAL, ship_type INTEGER,
                 PRIMARY KEY (mmsi, ts)
               )"""
        )
        # ts index serves both the window query and the prune; (mmsi, ts) is the PK.
        self._conn.execute("CREATE INDEX IF NOT EXISTS ix_positions_ts ON positions(ts)")
        self._conn.commit()
        span = self._conn.execute(
            "SELECT COUNT(*), MIN(ts), MAX(ts) FROM positions"
        ).fetchone()
        log.info("history store: %d rows, span %s..%s", span[0], span[1], span[2])

    def sample(self, vessels) -> None:
        """Append the current snapshot, then prune anything past the window."""
        if self._conn is None:
            return
        rows = [
            (v.mmsi, int(v.ts), v.lon, v.lat, v.sog, v.cog, v.heading, v.ship_type)
            for v in vessels
            if v.lat is not None and v.lon is not None
        ]
        if rows:
            self._conn.executemany(
                """INSERT OR IGNORE INTO positions
                     (mmsi, ts, lon, lat, sog, cog, heading, ship_type)
                   VALUES (?,?,?,?,?,?,?,?)""",
                rows,
            )
        self._prune()
        self._conn.commit()

    def _prune(self) -> None:
        if self._conn is None:
            return
        cutoff = int(time.time()) - self._window_sec
        self._conn.execute("DELETE FROM positions WHERE ts < ?", (cutoff,))

    def span(self) -> tuple[int, int] | None:
        """Earliest/latest stored timestamps (epoch seconds), or None if empty."""
        if self._conn is None:
            return None
        lo, hi = self._conn.execute("SELECT MIN(ts), MAX(ts) FROM positions").fetchone()
        return (lo, hi) if lo is not None else None

    def tracks(
        self,
        start: int,
        end: int,
        bbox: tuple[float, float, float, float] | None = None,
    ) -> list[dict]:
        """Per-vessel tracks within ``[start, end]`` (epoch seconds).

        ``bbox`` is ``(west, south, east, north)``. Each track is decimated to at
        most ``MAX_POINTS_PER_TRACK`` points, oldest first.
        """
        if self._conn is None:
            return []
        sql = (
            "SELECT mmsi, ts, lon, lat, sog, cog, heading, ship_type FROM positions "
            "WHERE ts BETWEEN ? AND ?"
        )
        params: list = [start, end]
        if bbox is not None:
            w, s, e, n = bbox
            sql += " AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?"
            params += [w, e, s, n]
        sql += " ORDER BY mmsi, ts"

        grouped: dict[int, dict] = {}
        for mmsi, ts, lon, lat, sog, cog, heading, ship_type in self._conn.execute(
            sql, params
        ):
            t = grouped.get(mmsi)
            if t is None:
                t = grouped[mmsi] = {"mmsi": mmsi, "ship_type": ship_type, "path": []}
            # ship_type can arrive late; keep the most recent non-null value.
            if ship_type is not None:
                t["ship_type"] = ship_type
            # Round to trim payload (and help gzip): ~1 m of lon/lat precision,
            # 0.1 kn / 0.1° is plenty for replay. ts stays an int.
            t["path"].append(
                [
                    round(lon, 5),
                    round(lat, 5),
                    ts,
                    round(sog, 1) if sog is not None else None,
                    round(cog, 1) if cog is not None else None,
                    round(heading) if heading is not None else None,
                ]
            )

        tracks = [t for t in grouped.values() if len(t["path"]) >= 2]
        for t in tracks:
            t["path"] = _decimate(t["path"], MAX_POINTS_PER_TRACK)
        return tracks

    def close(self) -> None:
        if self._conn is not None:
            self._conn.commit()
            self._conn.close()
            self._conn = None


def _decimate(path: list, limit: int) -> list:
    """Evenly thin ``path`` to at most ``limit`` points, always keeping the ends."""
    n = len(path)
    if n <= limit:
        return path
    step = (n - 1) / (limit - 1)
    out = [path[round(i * step)] for i in range(limit)]
    out[-1] = path[-1]  # guarantee the final fix survives rounding
    return out
