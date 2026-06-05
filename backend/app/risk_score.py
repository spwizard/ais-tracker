"""Composite, explainable vessel risk score.

Combines deterministic signals — sanctions, flag-of-convenience, opaque
ownership, and recent behavioral events — into a 0-100 score with a cited list
of reasons. The reasons are exactly the evidence the future LLM briefing
consumes.
"""
from __future__ import annotations

# ITF flags of convenience (ISO-3, matching Lloyd's flag codes).
FLAGS_OF_CONVENIENCE = {
    "ATG", "BHS", "BRB", "BLZ", "BMU", "KHM", "CYM", "COM", "COK", "CUW",
    "CYP", "GNQ", "FRO", "DEU", "GAB", "GEO", "GIB", "HND", "JAM", "LBN",
    "LBR", "MLT", "MHL", "MUS", "MDA", "MNG", "MMR", "ANT", "PAN", "STP",
    "VCT", "KNA", "LCA", "SLE", "LKA", "TZA", "TGO", "TON", "VUT",
}

LEVELS = (("critical", 80), ("high", 50), ("medium", 20), ("low", 0))


def _ownership_mismatch(o: dict) -> bool:
    for a, b in (
        ("reg_owner_control", "reg_owner_domicile"),
        ("reg_owner_domicile", "reg_owner_reg"),
        ("beneficial_owner_control", "beneficial_owner_domicile"),
    ):
        x, y = o.get(a), o.get(b)
        if x and y and x != y:
            return True
    return False


def compute_risk(
    vessel,
    ownership: dict | None,
    sanctioned_vessel: dict | None,
    owner_hits: list[tuple[str, str]],
    recent_events: list[dict],
) -> dict:
    score = 0
    reasons: list[dict] = []

    def add(points: int, code: str, label: str, severity: str) -> None:
        nonlocal score
        score += points
        reasons.append({"code": code, "label": label, "severity": severity})

    if sanctioned_vessel:
        add(60, "sanctioned_vessel", "Vessel is on the OFAC SDN sanctions list", "critical")
    for role, name in owner_hits:
        add(45, "sanctioned_owner", f"{role} is sanctioned: {name}", "critical")

    if ownership:
        flag = (ownership.get("flag") or "").upper()
        if flag in FLAGS_OF_CONVENIENCE:
            add(10, "flag_of_convenience", f"Flag of convenience ({flag})", "low")
        if _ownership_mismatch(ownership):
            add(15, "opaque_ownership", "Opaque ownership (control/domicile/registration differ)", "medium")

    kinds = {e["kind"] for e in recent_events}
    if "rendezvous" in kinds:
        add(25, "rendezvous", "Recent possible STS rendezvous", "high")
    if "spoof" in kinds:
        add(30, "spoof", "Recent impossible movement (AIS spoofing)", "high")

    score = min(score, 100)
    level = next(name for name, threshold in LEVELS if score >= threshold)
    return {"score": score, "level": level, "reasons": reasons}
