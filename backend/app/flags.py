"""Lightweight feature flags.

Config-driven (defaults + FLAG_<NAME> env overrides), global for now. When auth
arrives, the same `/api/flags` endpoint can resolve flags per user/tier without
the frontend changing — the `useFlag` hook stays the same.
"""
from __future__ import annotations

import os

DEFAULTS: dict[str, bool] = {
    "ownership": True,      # Lloyd's ownership & particulars enrichment
    "risk_engine": True,    # behavioral detectors (rendezvous / spoof)
    "llm_briefing": True,   # Claude-generated risk briefing
    "density_timeline": True,  # historical traffic-density timeline
    "weather": True,        # GFS wind particle overlay
}


def _truthy(v: str) -> bool:
    return v.strip().lower() in ("1", "true", "yes", "on")


def get_flags() -> dict[str, bool]:
    flags = dict(DEFAULTS)
    for name in DEFAULTS:
        env = os.environ.get(f"FLAG_{name.upper()}")
        if env is not None:
            flags[name] = _truthy(env)
    return flags
