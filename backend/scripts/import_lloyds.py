"""One-off: import a Lloyd's vessel CSV into an indexed SQLite ownership store.

    python -m scripts.import_lloyds /path/to/lloyds_vessels.csv [data/ownership.sqlite]

Keyed by IMO (unique vessel id); indexed on MMSI and call sign for joining to
live AIS. Stores identity + the full ownership chain (registered owner, operator,
beneficial owner, manager) with their country-of-control/domicile/registration.
"""
from __future__ import annotations

import csv
import os
import sqlite3
import sys

# our column -> CSV column
COLS = {
    "imo": "imo",
    "mmsi": "mmsi",
    "call_sign": "call_sign",
    "name": "ship_name",
    "ex_name": "ex_name",
    "flag": "flag_code",
    "ship_type": "ship_type",
    "status": "ship_status",
    "gross_tonnage": "gross_tonnage",
    "length": "length",
    "width": "width",
    "port_of_registry": "port_of_registry_name",
    "reg_owner": "registered_owner_name",
    "reg_owner_code": "registered_owner_code",
    "reg_owner_domicile": "registered_owner_country_of_domicile",
    "reg_owner_control": "registered_owner_country_of_control",
    "reg_owner_reg": "registered_owner_country_of_registration",
    "operator": "operator_name",
    "operator_code": "operator_company_code",
    "operator_domicile": "operator_country_of_domicile",
    "beneficial_owner": "group_beneficial_owner_name",
    "beneficial_owner_code": "group_beneficial_owner_company_code",
    "beneficial_owner_domicile": "group_beneficial_owner_country_of_domicile",
    "beneficial_owner_control": "group_beneficial_owner_country_of_control",
    "manager": "ship_manager_name",
    "manager_code": "ship_manager_company_code",
    "manager_domicile": "ship_manager_country_of_domicile_name",
}
INT_COLS = {"mmsi", "gross_tonnage"}
REAL_COLS = {"length", "width"}
OUR = list(COLS)


def _imo(v: str):
    d = "".join(ch for ch in (v or "") if ch.isdigit())
    return int(d) if d else None


def _val(col: str, raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    if col in INT_COLS:
        return int("".join(ch for ch in raw if ch.isdigit()) or 0) or None
    if col in REAL_COLS:
        try:
            return float(raw)
        except ValueError:
            return None
    return raw


def main(csv_path: str, db_path: str) -> None:
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    if os.path.exists(db_path):
        os.remove(db_path)
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        f"CREATE TABLE vessels (imo INTEGER PRIMARY KEY, "
        + ", ".join(f"{c} {'INTEGER' if c in INT_COLS else 'REAL' if c in REAL_COLS else 'TEXT'}" for c in OUR if c != "imo")
        + ")"
    )

    batch, total, kept = [], 0, 0
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            total += 1
            imo = _imo(row.get("imo", ""))
            if imo is None:
                continue
            rec = [imo] + [
                _val(c, row.get(COLS[c], "")) for c in OUR if c != "imo"
            ]
            batch.append(rec)
            kept += 1
            if len(batch) >= 5000:
                _flush(con, batch)
                batch = []
    if batch:
        _flush(con, batch)

    con.execute("CREATE INDEX idx_mmsi ON vessels(mmsi)")
    con.execute("CREATE INDEX idx_callsign ON vessels(call_sign)")
    # Company-code indexes power the ownership-network ("sister vessels") lookup.
    for col in ("reg_owner_code", "operator_code", "beneficial_owner_code", "manager_code"):
        con.execute(f"CREATE INDEX idx_{col} ON vessels({col})")
    con.commit()
    con.close()
    print(f"imported {kept} / {total} rows into {db_path}")


def _flush(con: sqlite3.Connection, batch: list) -> None:
    ph = ", ".join("?" * len(OUR))
    con.executemany(
        f"INSERT OR REPLACE INTO vessels ({', '.join(OUR)}) VALUES ({ph})", batch
    )
    con.commit()


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "/Users/rob.paddock/lloyds_vessels.csv"
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/ownership.sqlite"
    main(src, dst)
