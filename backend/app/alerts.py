"""Persistent alert log.

Behavioral risk events (rendezvous / spoof) and geofence events (enter / exit /
dwell / speed / dark) are ephemeral on the wire — they fire once as toasts. This
records every one to SQLite so the Alerts table can search and page a real
history that survives restarts. Fed from the broadcaster's single send_frame
choke point, so both event families are captured with one hook.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time

log = logging.getLogger("alerts")

_DDL = """
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    category TEXT NOT NULL,          -- 'risk' | 'geofence'
    kind TEXT NOT NULL,             -- rendezvous|spoof | enter|exit|dwell|speed|dark
    title TEXT,
    mmsi INTEGER,
    name TEXT,
    mmsi_b INTEGER,
    name_b TEXT,
    lat REAL,
    lon REAL,
    fence_id TEXT,
    fence_name TEXT,
    fence_category TEXT,
    detail TEXT                      -- JSON
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_mmsi ON alerts(mmsi);
"""

_COLS = (
    "ts", "category", "kind", "title", "mmsi", "name", "mmsi_b", "name_b",
    "lat", "lon", "fence_id", "fence_name", "fence_category", "detail",
)


class AlertStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None
        self._lock = threading.Lock()

    def open(self) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_DDL)
        self._conn.commit()

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    # --- write (from the broadcaster sink) --------------------------------
    def record(self, frame: dict) -> None:
        """Persist one event frame. Ignores non-alert frame types."""
        if self._conn is None:
            return
        t = frame.get("type")
        if t == "geofence_event":
            ev = frame.get("event", "")
            row = {
                "ts": frame.get("ts", time.time()),
                "category": "geofence",
                "kind": ev,
                "title": f"{ev.title()} {frame.get('fence_name', '')}".strip(),
                "mmsi": frame.get("mmsi"),
                "name": frame.get("name"),
                "mmsi_b": None,
                "name_b": None,
                "lat": frame.get("lat"),
                "lon": frame.get("lon"),
                "fence_id": frame.get("fence_id"),
                "fence_name": frame.get("fence_name"),
                "fence_category": frame.get("category"),
                "detail": json.dumps({"sog": frame.get("sog")}),
            }
        elif t == "risk_event":
            row = {
                "ts": frame.get("ts", time.time()),
                "category": "risk",
                "kind": frame.get("kind", ""),
                "title": frame.get("title"),
                "mmsi": frame.get("mmsi"),
                "name": frame.get("name"),
                "mmsi_b": frame.get("mmsi_b"),
                "name_b": frame.get("name_b"),
                "lat": frame.get("lat"),
                "lon": frame.get("lon"),
                "fence_id": None,
                "fence_name": None,
                "fence_category": None,
                "detail": json.dumps(frame.get("detail") or {}),
            }
        else:
            return
        try:
            with self._lock:
                self._conn.execute(
                    f"INSERT INTO alerts ({','.join(_COLS)}) "
                    f"VALUES ({','.join('?' for _ in _COLS)})",
                    [row[c] for c in _COLS],
                )
                self._conn.commit()
        except sqlite3.Error as exc:  # noqa: BLE001
            log.warning("alert record failed: %s", exc)

    # --- read (from the API) ----------------------------------------------
    def query(
        self,
        *,
        category: str | None = None,
        kind: str | None = None,
        search: str | None = None,
        mmsi: int | None = None,
        since: float | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict:
        """Paged, filtered alert history (newest first) + total match count."""
        if self._conn is None:
            return {"total": 0, "alerts": []}
        where: list[str] = []
        args: list = []
        if category:
            where.append("category = ?")
            args.append(category)
        if kind:
            where.append("kind = ?")
            args.append(kind)
        if mmsi is not None:
            where.append("(mmsi = ? OR mmsi_b = ?)")
            args += [mmsi, mmsi]
        if since is not None:
            where.append("ts >= ?")
            args.append(since)
        if search:
            where.append("(name LIKE ? OR name_b LIKE ? OR title LIKE ? OR fence_name LIKE ? OR CAST(mmsi AS TEXT) LIKE ?)")
            like = f"%{search}%"
            args += [like, like, like, like, like]
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        limit = max(1, min(int(limit), 500))
        with self._lock:
            total = self._conn.execute(
                f"SELECT COUNT(*) FROM alerts{clause}", args
            ).fetchone()[0]
            rows = self._conn.execute(
                f"SELECT * FROM alerts{clause} ORDER BY ts DESC LIMIT ? OFFSET ?",
                args + [limit, max(0, int(offset))],
            ).fetchall()
        alerts = []
        for r in rows:
            d = dict(r)
            d["detail"] = json.loads(d["detail"]) if d.get("detail") else {}
            alerts.append(d)
        return {"total": total, "alerts": alerts}
