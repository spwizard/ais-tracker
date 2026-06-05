"""Import sanctions from an OpenSanctions FtM export → data/sanctions.json.

    python -m scripts.import_sanctions [source.ftm.json | URL] [data/sanctions.json]

Default source is the US OFAC SDN list via OpenSanctions. Produces:
  { vessels: [{name, imo, mmsi, callsign, flag}],   # sanctioned vessels
    entities: [name, ...] }                          # sanctioned orgs/persons + aliases
Swap the URL for the consolidated `sanctions` collection to add EU/UN/UK.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

DEFAULT_URL = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/entities.ftm.json"
ENTITY_SCHEMAS = {"Organization", "Company", "LegalEntity", "Person"}


def _imo(values) -> int | None:
    for v in values or []:
        d = "".join(ch for ch in str(v) if ch.isdigit())
        if len(d) >= 7:
            return int(d[:7])
    return None


def _first(values):
    return values[0] if values else None


def _lines(source: str):
    if source.startswith("http"):
        with urllib.request.urlopen(source, timeout=120) as resp:
            for raw in resp:
                yield raw.decode("utf-8")
    else:
        with open(source, encoding="utf-8") as f:
            yield from f


def build_sanctions_file(source: str, out: str) -> None:
    vessels, entity_names = [], set()
    for line in _lines(source):
        line = line.strip()
        if not line:
            continue
        e = json.loads(line)
        schema = e.get("schema")
        p = e.get("properties", {})
        if schema == "Vessel":
            mmsi = _first(p.get("mmsi"))
            vessels.append(
                {
                    "name": _first(p.get("name")),
                    "imo": _imo(p.get("imoNumber")),
                    "mmsi": int(mmsi) if mmsi and str(mmsi).isdigit() else None,
                    "callsign": _first(p.get("callSign")),
                    "flag": _first(p.get("flag")),
                }
            )
        elif schema in ENTITY_SCHEMAS:
            for n in (p.get("name") or []) + (p.get("alias") or []):
                if n:
                    entity_names.add(n)

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": "OpenSanctions / US OFAC SDN",
                "vessels": vessels,
                "entities": sorted(entity_names),
            },
            f,
        )
    print(f"sanctions: {len(vessels)} vessels, {len(entity_names)} entities → {out}")


def main(source: str, out: str) -> None:
    build_sanctions_file(source, out)


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    dst = sys.argv[2] if len(sys.argv) > 2 else "data/sanctions.json"
    main(src, dst)
