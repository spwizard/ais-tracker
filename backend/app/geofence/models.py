"""Geofence models — mirror the frontend schema (camelCase fields kept as-is so
the GeoJSON-ish payload round-trips without translation)."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

Shape = Literal["circle", "rectangle", "polygon", "corridor"]
TriggerKind = Literal["enter", "exit", "dwell", "speed", "dark"]


class Trigger(BaseModel):
    on: TriggerKind
    dwellSec: Optional[int] = None  # noqa: N815 — matches frontend field
    speedKn: Optional[float] = None  # noqa: N815 — speed threshold (knots)
    speedOp: Optional[Literal["over", "under"]] = None  # noqa: N815
    darkSec: Optional[int] = None  # noqa: N815 — silence before "gone dark"


class Geofence(BaseModel):
    id: str
    name: str
    category: str
    shape: Shape
    color: str
    visible: bool = True
    triggers: list[Trigger] = []

    # Parametric source-of-truth (lon/lat order throughout).
    center: Optional[tuple[float, float]] = None  # circle
    radiusM: Optional[float] = None  # noqa: N815
    ring: Optional[list[tuple[float, float]]] = None  # rectangle / polygon
    path: Optional[list[tuple[float, float]]] = None  # corridor
    bufferM: Optional[float] = None  # noqa: N815

    def has_trigger(self, kind: TriggerKind) -> bool:
        return any(t.on == kind for t in self.triggers)

    def dwell_sec(self) -> Optional[int]:
        for t in self.triggers:
            if t.on == "dwell" and t.dwellSec:
                return t.dwellSec
        return None

    def speed_trigger(self) -> Optional[tuple[str, float]]:
        """Returns (op, knots) for the speed trigger, if configured."""
        for t in self.triggers:
            if t.on == "speed" and t.speedKn is not None:
                return (t.speedOp or "over", t.speedKn)
        return None

    def dark_sec(self) -> Optional[int]:
        for t in self.triggers:
            if t.on == "dark":
                return t.darkSec or 180
        return None
