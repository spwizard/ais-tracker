"""Read-only access to the Lloyd's ownership store (built by scripts.import_lloyds).

Joins a live vessel to its Lloyd's record by IMO → MMSI → call sign (IMO is the
most reliable; MMSI can change). Lookups are on-demand (user selects a vessel),
so indexed SQLite reads are plenty fast.
"""
from __future__ import annotations

import logging
import os
import sqlite3

log = logging.getLogger("ownership")


class OwnershipStore:
    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        if not os.path.exists(self._path):
            log.warning(
                "ownership db not found at %s — run scripts.import_lloyds", self._path
            )
            return
        self._conn = sqlite3.connect(
            f"file:{self._path}?mode=ro", uri=True, check_same_thread=False
        )
        self._conn.row_factory = sqlite3.Row
        n = self._conn.execute("SELECT COUNT(*) FROM vessels").fetchone()[0]
        log.info("ownership store loaded (%d Lloyd's vessels)", n)

    @property
    def available(self) -> bool:
        return self._conn is not None

    def lookup(
        self,
        mmsi: int | None = None,
        imo: int | None = None,
        callsign: str | None = None,
    ) -> dict | None:
        if self._conn is None:
            return None
        row = None
        if imo:
            row = self._conn.execute("SELECT * FROM vessels WHERE imo=?", (imo,)).fetchone()
        if row is None and mmsi:
            row = self._conn.execute("SELECT * FROM vessels WHERE mmsi=?", (mmsi,)).fetchone()
        if row is None and callsign:
            row = self._conn.execute(
                "SELECT * FROM vessels WHERE call_sign=?", (callsign,)
            ).fetchone()
        return dict(row) if row else None

    # --- ownership network ------------------------------------------------
    _ROLES = (
        ("Beneficial owner", "beneficial_owner", "beneficial_owner_code"),
        ("Registered owner", "reg_owner", "reg_owner_code"),
        ("Operator", "operator", "operator_code"),
        ("Manager", "manager", "manager_code"),
    )

    def _sisters(self, code: str, exclude: set, limit: int) -> list[dict]:
        """Other vessels sharing a company code in any ownership role."""
        rows = self._conn.execute(
            """SELECT imo, mmsi, name, flag FROM vessels
               WHERE (reg_owner_code=? OR operator_code=? OR beneficial_owner_code=? OR manager_code=?)
               LIMIT ?""",
            (code, code, code, code, limit + len(exclude) + 5),
        )
        out = []
        for row in rows:
            d = dict(row)
            if d["imo"] in exclude:
                continue
            out.append(d)
            if len(out) >= limit:
                break
        return out

    def network(
        self, rec: dict, sanctions=None, per_company: int = 12, max_sisters: int = 28
    ) -> dict | None:
        """Build the vessel → company → sister-vessel graph around one vessel,
        with sanctions flags overlaid on every node."""
        if self._conn is None:
            return None

        def s_entity(name) -> bool:
            return bool(sanctions and sanctions.screen_entity(name))

        def s_vessel(imo, mmsi, name) -> bool:
            return bool(
                sanctions
                and sanctions.screen_vessel(imo=imo, mmsi=mmsi, name=name, by_name=False)
            )

        subj_imo = rec.get("imo")
        subj_id = f"v:{subj_imo}"
        nodes = [
            {
                "id": subj_id,
                "type": "vessel",
                "label": rec.get("name") or f"IMO {subj_imo}",
                "imo": subj_imo,
                "mmsi": rec.get("mmsi"),
                "flag": rec.get("flag"),
                "subject": True,
                "sanctioned": s_vessel(subj_imo, rec.get("mmsi"), rec.get("name")),
            }
        ]
        edges = []

        companies: dict[str, dict] = {}
        for role, name_key, code_key in self._ROLES:
            name, code = rec.get(name_key), rec.get(code_key)
            if not name or not code:
                continue
            cid = f"c:{code}"
            node = companies.setdefault(
                cid,
                {
                    "id": cid,
                    "type": "company",
                    "label": name,
                    "code": code,
                    "roles": [],
                    "sanctioned": s_entity(name),
                },
            )
            node["roles"].append(role)
            edges.append({"source": subj_id, "target": cid, "role": role})
        nodes.extend(companies.values())

        seen = {subj_imo}
        budget = max_sisters
        for cid, c in companies.items():
            if budget <= 0:
                break
            for s in self._sisters(c["code"], seen, min(per_company, budget)):
                seen.add(s["imo"])
                budget -= 1
                vid = f"v:{s['imo']}"
                nodes.append(
                    {
                        "id": vid,
                        "type": "vessel",
                        "label": s["name"] or f"IMO {s['imo']}",
                        "imo": s["imo"],
                        "mmsi": s["mmsi"],
                        "flag": s["flag"],
                        "sanctioned": s_vessel(s["imo"], s["mmsi"], s["name"]),
                    }
                )
                edges.append({"source": cid, "target": vid, "role": "fleet"})
                if budget <= 0:
                    break

        return {"subject_id": subj_id, "nodes": nodes, "edges": edges}

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
