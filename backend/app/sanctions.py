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
        """Match a live vessel against the SDN list, strongest identifier first.

        IMO is the permanent hull number and authoritative. MMSI, call sign and
        name are all *reassignable* — an MMSI follows the radio/registration and
        gets handed to a different ship when the old one is reflagged or scrapped.
        So a weaker-identifier match is rejected when the matched SDN record has an
        IMO that differs from the queried IMO: same MMSI + different IMO means a
        different hull (e.g. a sanctioned vessel's old MMSI now on a clean ship),
        not a sanctions hit."""
        if imo and imo in self._by_imo:
            return self._by_imo[imo]

        def _imo_conflict(rec: dict) -> bool:
            # True when both sides have IMOs and they differ → not the same hull.
            return bool(imo) and bool(rec.get("imo")) and rec["imo"] != imo

        if mmsi and mmsi in self._by_mmsi:
            rec = self._by_mmsi[mmsi]
            if not _imo_conflict(rec):
                return rec
        if callsign and callsign.upper() in self._by_callsign:
            rec = self._by_callsign[callsign.upper()]
            if not _imo_conflict(rec):
                return rec
        if by_name and name and _norm(name) in self._vessel_names:
            rec = self._vessel_names[_norm(name)]
            if not _imo_conflict(rec):
                return rec
        return None

    def screen_entity(self, name: str | None) -> bool:
        return bool(name) and _norm(name) in self._entities

    def search(self, q: str, limit: int = 20) -> tuple[list[dict], int]:
        """Sanctioned vessels whose name contains `q` (case-insensitive). Returns
        (results, total). De-duped across the name index."""
        ql = q.lower().strip()
        if not ql or not self.loaded:
            return [], 0
        out: list[dict] = []
        seen: set = set()
        total = 0
        for v in self._vessel_names.values():
            name = v.get("name") or ""
            if ql not in name.lower():
                continue
            key = v.get("imo") or v.get("mmsi") or name
            if key in seen:
                continue
            seen.add(key)
            total += 1
            if len(out) < limit:
                out.append({
                    "name": v.get("name"),
                    "imo": v.get("imo"),
                    "mmsi": v.get("mmsi"),
                    "program": v.get("program"),
                })
        return out, total
