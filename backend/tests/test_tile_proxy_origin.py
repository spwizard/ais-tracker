"""Tests for the 3D-tiles proxy origin guard (app.main._origin_host_allowed)."""
from __future__ import annotations

import pytest

from app.main import _origin_host_allowed


@pytest.mark.parametrize(
    "referer,host,allowed",
    [
        # Same-origin (the box serves frontend + proxy) → allowed.
        ("http://140.238.76.193/", "140.238.76.193", True),
        ("http://140.238.76.193/some/page", "140.238.76.193", True),
        # Dev: frontend on a different localhost port than the backend → allowed.
        ("http://localhost:5174/", "localhost", True),
        ("http://127.0.0.1:5174/", "localhost", True),
        # Cross-site hotlink → blocked.
        ("https://evil.example.com/", "140.238.76.193", False),
        # Missing referer (e.g. curl / direct hit) → blocked.
        ("", "140.238.76.193", False),
        # Garbage referer → blocked.
        ("not a url", "140.238.76.193", False),
    ],
)
def test_origin_host_allowed(referer, host, allowed):
    assert _origin_host_allowed(referer, host) is allowed
