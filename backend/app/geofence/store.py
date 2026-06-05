"""Geofence persistence. Backed by a JSON file so zones survive restarts with
zero infra (the authoritative source the evaluator reads). Redis-backed
persistence can swap in later behind the same interface."""
from __future__ import annotations

import json
import logging
import os
import tempfile

from .models import Geofence

log = logging.getLogger("geofence.store")


class GeofenceStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._fences: dict[str, Geofence] = {}
        self._load()

    def _load(self) -> None:
        try:
            with open(self._path, encoding="utf-8") as fh:
                rows = json.load(fh)
            self._fences = {r["id"]: Geofence(**r) for r in rows}
            log.info("loaded %d geofences from %s", len(self._fences), self._path)
        except FileNotFoundError:
            self._fences = {}
        except Exception as exc:  # noqa: BLE001
            log.warning("failed to load geofences: %s", exc)
            self._fences = {}

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._path) or ".", exist_ok=True)
        # Atomic write so a crash mid-save can't corrupt the file.
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(self._path) or ".")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump([f.model_dump() for f in self._fences.values()], fh)
            os.replace(tmp, self._path)
        except Exception as exc:  # noqa: BLE001
            log.warning("failed to save geofences: %s", exc)
            if os.path.exists(tmp):
                os.unlink(tmp)

    def list(self) -> list[Geofence]:
        return list(self._fences.values())

    def replace_all(self, fences: list[Geofence]) -> None:
        """Bulk-replace the whole set (the frontend syncs its full list)."""
        self._fences = {f.id: f for f in fences}
        self._save()
