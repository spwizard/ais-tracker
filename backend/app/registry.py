"""Persistent vessel registry: MMSI -> last-known static identity.

Every static field we receive (name, callsign, ship type, dimensions) is
remembered here, so a vessel that sends only a position — because its static
message hasn't arrived yet, or it just reappeared, or we just restarted — is
backfilled instantly from what we've seen before.

Backed by SQLite (embedded, zero-infra, survives restarts) with the whole set
mirrored in memory for microsecond lookups on the hot path. Voyage data
(destination/draught) is deliberately *not* stored — it changes per trip and a
stale value would be misleading.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time

from .models import VesselUpdate

log = logging.getLogger("registry")

# Identity fields we persist (NOT destination/draught — those are voyage data).
STATIC_FIELDS = (
    "name",
    "callsign",
    "imo",
    "ship_type",
    "to_bow",
    "to_stern",
    "to_port",
    "to_starboard",
)


class VesselRegistry:
    def __init__(self, path: str) -> None:
        self._path = path
        self._mem: dict[int, dict] = {}
        self._dirty: set[int] = set()
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS vessels (
                 mmsi INTEGER PRIMARY KEY,
                 name TEXT, callsign TEXT, imo INTEGER, ship_type INTEGER,
                 to_bow INTEGER, to_stern INTEGER, to_port INTEGER, to_starboard INTEGER,
                 updated REAL
               )"""
        )
        # Migrate older DBs that predate a column (e.g. imo).
        existing = {r[1] for r in self._conn.execute("PRAGMA table_info(vessels)")}
        for col, decl in (("imo", "INTEGER"),):
            if col not in existing:
                self._conn.execute(f"ALTER TABLE vessels ADD COLUMN {col} {decl}")
        self._conn.commit()
        cols = ", ".join(STATIC_FIELDS)
        for row in self._conn.execute(f"SELECT mmsi, {cols} FROM vessels"):
            self._mem[row[0]] = {
                k: v for k, v in zip(STATIC_FIELDS, row[1:]) if v is not None
            }
        log.info("registry loaded %d known vessels from %s", len(self._mem), self._path)

    def record(self, update: VesselUpdate) -> None:
        """Remember any static fields present in this update."""
        static = {
            f: getattr(update, f)
            for f in STATIC_FIELDS
            if getattr(update, f) is not None
        }
        if not static:
            return
        rec = self._mem.setdefault(update.mmsi, {})
        if any(rec.get(k) != v for k, v in static.items()):
            rec.update(static)
            self._dirty.add(update.mmsi)

    def enrich(self, update: VesselUpdate) -> None:
        """Backfill missing static fields on this update from the registry."""
        rec = self._mem.get(update.mmsi)
        if not rec:
            return
        for f in STATIC_FIELDS:
            if getattr(update, f) is None and f in rec:
                setattr(update, f, rec[f])

    def name(self, mmsi: int) -> str | None:
        """Known vessel name for an MMSI, or None if never seen."""
        rec = self._mem.get(mmsi)
        return rec.get("name") if rec else None

    def flush(self) -> int:
        """Persist dirty records to SQLite. Cheap (executemany in WAL)."""
        if not self._dirty or self._conn is None:
            return 0
        dirty = list(self._dirty)
        self._dirty.clear()
        now = time.time()
        rows = [
            (mmsi, *(self._mem.get(mmsi, {}).get(f) for f in STATIC_FIELDS), now)
            for mmsi in dirty
        ]
        cols = ", ".join(STATIC_FIELDS)
        ph = ", ".join("?" * (len(STATIC_FIELDS) + 2))
        self._conn.executemany(
            f"INSERT OR REPLACE INTO vessels (mmsi, {cols}, updated) VALUES ({ph})",
            rows,
        )
        self._conn.commit()
        return len(rows)

    def count(self) -> int:
        return len(self._mem)

    def close(self) -> None:
        self.flush()
        if self._conn is not None:
            self._conn.close()
