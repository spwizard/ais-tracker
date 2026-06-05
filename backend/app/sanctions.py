"""Sanctions screening (built by scripts.import_sanctions).

Screens a vessel by IMO → MMSI → call sign → normalized name, and an entity
(owner/operator/etc.) by normalized name. Exact normalized matching keeps false
positives low; fuzzy matching is a later refinement.
"""
from __future__ import annotations

import json
import logging
import re

log = logging.getLogger("sanctions")


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


class SanctionsStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._by_imo: dict[int, dict] = {}
        self._by_mmsi: dict[int, dict] = {}
        self._by_callsign: dict[str, dict] = {}
        self._vessel_names: dict[str, dict] = {}
        self._entities: set[str] = set()
        self.loaded = False

    def _reset(self) -> None:
        self._by_imo.clear()
        self._by_mmsi.clear()
        self._by_callsign.clear()
        self._vessel_names.clear()
        self._entities.clear()
        self.loaded = False

    def open(self) -> None:
        self._reset()
        try:
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            log.warning("sanctions file not found at %s — screening disabled", self._path)
            return
        for v in data.get("vessels", []):
            if v.get("imo"):
                self._by_imo[v["imo"]] = v
            if v.get("mmsi"):
                self._by_mmsi[v["mmsi"]] = v
            if v.get("callsign"):
                self._by_callsign[v["callsign"].upper()] = v
            if v.get("name"):
                self._vessel_names[_norm(v["name"])] = v
        self._entities = {_norm(n) for n in data.get("entities", []) if _norm(n)}
        self.loaded = True
        log.info(
            "sanctions loaded: %d vessels, %d entities", len(data.get("vessels", [])), len(self._entities)
        )

    def reload(self) -> None:
        """Re-read the sanctions file from disk (e.g. after a bootstrap download)."""
        self.open()

    def screen_vessel(
        self, imo=None, mmsi=None, name=None, callsign=None, by_name: bool = True
    ) -> dict | None:
        """Strong identifiers first; name is the weakest (set by_name=False to skip)."""
        if imo and imo in self._by_imo:
            return self._by_imo[imo]
        if mmsi and mmsi in self._by_mmsi:
            return self._by_mmsi[mmsi]
        if callsign and callsign.upper() in self._by_callsign:
            return self._by_callsign[callsign.upper()]
        if by_name and name and _norm(name) in self._vessel_names:
            return self._vessel_names[_norm(name)]
        return None

    def screen_entity(self, name: str | None) -> bool:
        return bool(name) and _norm(name) in self._entities
