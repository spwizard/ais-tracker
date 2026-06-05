"""Translate raw AISStream JSON messages into normalized ``VesselUpdate``s.

AISStream wraps each report as::

    {
      "MessageType": "PositionReport",
      "MetaData": {"MMSI": 123456789, "ShipName": "…", ...},
      "Message": {"PositionReport": { ...fields... }}
    }

We only care about a couple of message types; everything else returns ``None``.
Field names follow AISStream's PascalCase convention.
"""
from __future__ import annotations

from typing import Optional

from ..models import VesselUpdate


def _clean_str(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = value.strip().rstrip("@").strip()
    return value or None


def parse_message(msg: dict) -> Optional[VesselUpdate]:
    """Return a partial vessel update, or ``None`` for ignored message types."""
    msg_type = msg.get("MessageType")
    meta = msg.get("MetaData", {})
    mmsi = meta.get("MMSI") or meta.get("MMSI_String")
    if mmsi is None:
        return None
    mmsi = int(mmsi)
    body = msg.get("Message", {})

    if msg_type == "PositionReport":
        pr = body.get("PositionReport", {})
        heading = pr.get("TrueHeading")
        if heading == 511:  # 511 => heading not available
            heading = None
        return VesselUpdate(
            mmsi=mmsi,
            lat=pr.get("Latitude"),
            lon=pr.get("Longitude"),
            sog=pr.get("Sog"),
            cog=pr.get("Cog"),
            heading=heading,
            nav_status=pr.get("NavigationalStatus"),
            rot=pr.get("RateOfTurn"),
            name=_clean_str(meta.get("ShipName")),
        )

    if msg_type == "ShipStaticData":
        sd = body.get("ShipStaticData", {})
        dim = sd.get("Dimension", {}) or {}
        return VesselUpdate(
            mmsi=mmsi,
            name=_clean_str(sd.get("Name") or meta.get("ShipName")),
            callsign=_clean_str(sd.get("CallSign")),
            imo=sd.get("ImoNumber") or None,
            ship_type=sd.get("Type"),
            destination=_clean_str(sd.get("Destination")),
            draught=sd.get("MaximumStaticDraught"),
            to_bow=dim.get("A"),
            to_stern=dim.get("B"),
            to_port=dim.get("C"),
            to_starboard=dim.get("D"),
        )

    # StandardClassBPositionReport carries dynamic data for smaller (Class B) craft.
    if msg_type == "StandardClassBPositionReport":
        pr = body.get("StandardClassBPositionReport", {})
        heading = pr.get("TrueHeading")
        if heading == 511:
            heading = None
        return VesselUpdate(
            mmsi=mmsi,
            lat=pr.get("Latitude"),
            lon=pr.get("Longitude"),
            sog=pr.get("Sog"),
            cog=pr.get("Cog"),
            heading=heading,
            name=_clean_str(meta.get("ShipName")),
        )

    return None
