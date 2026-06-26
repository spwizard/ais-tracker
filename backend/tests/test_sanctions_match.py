"""Tests for IMO-authoritative sanctions matching (app/sanctions.py).

Regression for the real GREENFIELD / ASTARA case: a sanctioned Iranian vessel's
old MMSI was reassigned to a clean container ship, producing a false positive
when screening matched on the (reassignable) MMSI despite a differing IMO."""
from __future__ import annotations

import json

import pytest

from app.sanctions import SanctionsStore


@pytest.fixture()
def store(tmp_path):
    data = {
        "vessels": [
            # The real sanctioned vessel: Iranian, IMO 9187631, MMSI 256845000.
            {"name": "ASTARA", "imo": 9187631, "mmsi": 256845000, "callsign": "9HDS9", "flag": "ir"},
            # A name-only SDN entry (no strong ids) to exercise name matching.
            {"name": "GHOST RUNNER", "flag": "ir"},
        ],
        "entities": ["Some Sanctioned Company"],
    }
    p = tmp_path / "sanctions.json"
    p.write_text(json.dumps(data))
    s = SanctionsStore(str(p))
    s.open()
    return s


def test_imo_match_hits(store):
    assert store.screen_vessel(imo=9187631)["name"] == "ASTARA"


def test_mmsi_collision_with_different_imo_is_rejected(store):
    # GREENFIELD: clean container ship, same MMSI as ASTARA but a different IMO.
    assert store.screen_vessel(imo=9970026, mmsi=256845000, callsign="9HA5996") is None


def test_mmsi_match_allowed_when_query_has_no_imo(store):
    # No IMO to conflict with → the MMSI match still stands (best available id).
    assert store.screen_vessel(mmsi=256845000)["name"] == "ASTARA"


def test_callsign_collision_with_different_imo_is_rejected(store):
    assert store.screen_vessel(imo=9970026, callsign="9HDS9") is None


def test_name_match_respects_imo_conflict(store):
    # Same name as the SDN ASTARA entry but a different IMO → not a hit.
    assert store.screen_vessel(imo=9970026, name="ASTARA") is None
    # Name-only SDN entry (no IMO on record) still matches by name.
    assert store.screen_vessel(name="Ghost Runner")["name"] == "GHOST RUNNER"


def test_by_name_false_skips_name(store):
    assert store.screen_vessel(name="Ghost Runner", by_name=False) is None
