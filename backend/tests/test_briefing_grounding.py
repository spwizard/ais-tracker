"""Tests for open-source citation grounding (app/briefing.ground_findings).

Regression for the GREENFIELD briefing that cited an OFAC page for a *different*
vessel (ARNICA): a finding's source_url must be one of the real search results,
and that result must actually reference the subject vessel."""
from __future__ import annotations

from types import SimpleNamespace

from app.briefing import ground_findings


def vessel(mmsi=256845000, imo=9970026, name="GREENFIELD"):
    return SimpleNamespace(mmsi=mmsi, imo=imo, name=name)


RESULTS = [
    {
        "url": "https://www.vesselfinder.com/vessels/details/9970026",
        "title": "GREENFIELD, Container Ship — IMO 9970026",
        "content": "GREENFIELD (IMO 9970026) is a container ship flagged in Malta.",
    },
    {
        "url": "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=15039",
        "title": "OFAC SDN — ARNICA",
        "content": "ARNICA (IMO 9187643) is an Iranian crude oil tanker.",
    },
]


def test_keeps_finding_that_cites_the_subject():
    findings = [{"claim": "Container ship in Malta", "source_url": RESULTS[0]["url"], "as_of": "2026"}]
    kept, dropped = ground_findings(findings, RESULTS, vessel())
    assert dropped == 0 and len(kept) == 1


def test_drops_citation_to_a_different_vessels_result():
    # The ARNICA OFAC page is a real result, but it doesn't mention GREENFIELD.
    findings = [{"claim": "Greenfield is an Iranian tanker", "source_url": RESULTS[1]["url"], "as_of": "2026"}]
    kept, dropped = ground_findings(findings, RESULTS, vessel())
    assert kept == [] and dropped == 1


def test_drops_url_not_in_results():
    # A plausible-looking URL the model invented or lifted from page text.
    findings = [{"claim": "x", "source_url": "https://example.com/made-up", "as_of": "unknown"}]
    kept, dropped = ground_findings(findings, RESULTS, vessel())
    assert kept == [] and dropped == 1


def test_matches_subject_by_name_when_no_imo_in_content():
    results = [{"url": "https://news.example/x", "title": "GREENFIELD detained", "content": "The vessel Greenfield was held."}]
    findings = [{"claim": "Detained", "source_url": results[0]["url"], "as_of": "2026"}]
    kept, dropped = ground_findings(findings, results, vessel(imo=None))
    assert len(kept) == 1 and dropped == 0


def test_empty_findings_is_noop():
    assert ground_findings([], RESULTS, vessel()) == ([], 0)
