"""Data sources. Each source owns one upstream connection, normalizes incoming
messages to ``VesselUpdate``, and writes them into the shared ``VesselStore``.
Adding a feed = one more ``Source`` subclass; the store/broadcaster/frontend
never change."""
from __future__ import annotations

from ..config import Settings
from ..store.base import VesselStore
from .aisstream import AisStreamSource
from .base import Source
from .digitraffic import DigitrafficSource
from .kystverket import KystverketSource


def create_sources(
    store: VesselStore, settings: Settings, registry=None
) -> list[Source]:
    sources: list[Source] = []
    if settings.enable_aisstream:
        sources.append(AisStreamSource(store, settings))
    if settings.enable_digitraffic:
        sources.append(DigitrafficSource(store, settings))
    if settings.enable_kystverket:
        sources.append(KystverketSource(store, settings))
    for src in sources:
        src._registry = registry
    return sources


__all__ = [
    "Source",
    "create_sources",
    "AisStreamSource",
    "DigitrafficSource",
    "KystverketSource",
]
