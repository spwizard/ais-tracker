"""Parse Fintraffic Digitraffic vessels-v2 MQTT payloads → VesselUpdate.

Two message kinds (mirroring AIS dynamic vs static):
  location: { time, sog, cog, navStat, rot, posAcc, raim, heading, lon, lat }
  metadata: { timestamp, destination, name, draught, eta, posType,
              refA, refB, refC, refD, callSign, imo, type }
MMSI comes from the topic, not the payload.
"""
from __future__ import annotations

from typing import Optional

from ..models import VesselUpdate


def _clean(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip().rstrip("@").strip()
    return value or None


def parse_location(mmsi: int, p: dict) -> Optional[VesselUpdate]:
    heading = p.get("heading")
    if heading == 511:
        heading = None
    cog = p.get("cog")
    if cog is not None and cog >= 360:
        cog = None
    sog = p.get("sog")
    if sog is not None and sog >= 102.3:
        sog = None

    upd = VesselUpdate(
        mmsi=mmsi,
        lat=p.get("lat"),
        lon=p.get("lon"),
        sog=sog,
        cog=cog,
        heading=heading,
        nav_status=p.get("navStat"),
        rot=p.get("rot"),
    )
    t = p.get("time")
    if t is not None:
        upd.ts = float(t)  # already epoch seconds
    return upd


def parse_metadata(mmsi: int, p: dict) -> Optional[VesselUpdate]:
    # Leave ts at "now" (default) so static messages don't regress the position
    # timestamp used for dead-reckoning — same behaviour as the AISStream source.
    return VesselUpdate(
        mmsi=mmsi,
        name=_clean(p.get("name")),
        callsign=_clean(p.get("callSign")),
        imo=p.get("imo") or None,
        ship_type=p.get("type"),
        destination=_clean(p.get("destination")),
        draught=p.get("draught"),
        to_bow=p.get("refA"),
        to_stern=p.get("refB"),
        to_port=p.get("refC"),
        to_starboard=p.get("refD"),
    )
