"""Darwin late-running / cancellation reason codes → human text.

Codes appear as LateReason / CancelReason on TS messages. Vendored from the
community reference list (github gist tjvr/effd9a9ee8cbec5a9c9d). `short` is
the cause phrase ("a broken down train"); unknown codes degrade to "code N".
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_FILE = Path(__file__).parent / "reasons.json"


@lru_cache(maxsize=1)
def _codes() -> dict[str, dict]:
    try:
        return json.loads(_FILE.read_text())
    except (OSError, ValueError):
        return {}


def reason_text(code: str | None) -> str | None:
    """Short cause phrase for a reason code, or None."""
    if not code:
        return None
    entry = _codes().get(str(code))
    if entry:
        return entry.get("short") or entry.get("full")
    return f"reason code {code}"
