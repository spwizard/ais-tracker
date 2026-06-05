"""Map a decoded pyais AIS message → VesselUpdate.

Shared by any raw-NMEA source (Kystverket now; a Kpler TCP stream later would
reuse this verbatim). Handles the common dynamic (1/2/3, 18, 19) and static
(5, 24) message types.
"""
from __future__ import annotations

from typing import Optional

from ..models import VesselUpdate


def _clean(v) -> Optional[str]:
    if not isinstance(v, str):
        return None
    v = v.strip().rstrip("@").strip()
    return v or None


def _int(v) -> Optional[int]:
    return int(v) if v is not None else None


def _sog(v) -> Optional[float]:
    if v is None:
        return None
    return None if v >= 102.3 else float(v)


def _cog(v) -> Optional[float]:
    if v is None:
        return None
    return None if v >= 360 else float(v)


def _hdg(v) -> Optional[float]:
    if v is None:
        return None
    return None if v >= 511 else float(v)


def msg_to_update(msg) -> Optional[VesselUpdate]:
    mt = getattr(msg, "msg_type", None)
    mmsi = getattr(msg, "mmsi", None)
    if mmsi is None:
        return None

    if mt in (1, 2, 3):  # Class A position report
        return VesselUpdate(
            mmsi=mmsi,
            lat=getattr(msg, "lat", None),
            lon=getattr(msg, "lon", None),
            sog=_sog(getattr(msg, "speed", None)),
            cog=_cog(getattr(msg, "course", None)),
            heading=_hdg(getattr(msg, "heading", None)),
            nav_status=_int(getattr(msg, "status", None)),
            rot=getattr(msg, "turn", None),
        )

    if mt == 18:  # Class B position report
        return VesselUpdate(
            mmsi=mmsi,
            lat=getattr(msg, "lat", None),
            lon=getattr(msg, "lon", None),
            sog=_sog(getattr(msg, "speed", None)),
            cog=_cog(getattr(msg, "course", None)),
            heading=_hdg(getattr(msg, "heading", None)),
        )

    if mt == 19:  # Extended Class B (position + some static)
        return VesselUpdate(
            mmsi=mmsi,
            lat=getattr(msg, "lat", None),
            lon=getattr(msg, "lon", None),
            sog=_sog(getattr(msg, "speed", None)),
            cog=_cog(getattr(msg, "course", None)),
            heading=_hdg(getattr(msg, "heading", None)),
            name=_clean(getattr(msg, "shipname", None)),
            ship_type=_int(getattr(msg, "ship_type", None)),
            to_bow=getattr(msg, "to_bow", None),
            to_stern=getattr(msg, "to_stern", None),
            to_port=getattr(msg, "to_port", None),
            to_starboard=getattr(msg, "to_starboard", None),
        )

    if mt == 5:  # Class A static & voyage data
        return VesselUpdate(
            mmsi=mmsi,
            name=_clean(getattr(msg, "shipname", None)),
            callsign=_clean(getattr(msg, "callsign", None)),
            imo=_int(getattr(msg, "imo", None)) or None,
            ship_type=_int(getattr(msg, "ship_type", None)),
            destination=_clean(getattr(msg, "destination", None)),
            draught=getattr(msg, "draught", None),
            to_bow=getattr(msg, "to_bow", None),
            to_stern=getattr(msg, "to_stern", None),
            to_port=getattr(msg, "to_port", None),
            to_starboard=getattr(msg, "to_starboard", None),
        )

    if mt == 24:  # Class B static (split across part A / part B)
        upd = VesselUpdate(mmsi=mmsi)
        if (name := _clean(getattr(msg, "shipname", None))):
            upd.name = name
        if (st := getattr(msg, "ship_type", None)) is not None:
            upd.ship_type = _int(st)
        if (cs := _clean(getattr(msg, "callsign", None))):
            upd.callsign = cs
        for attr in ("to_bow", "to_stern", "to_port", "to_starboard"):
            if (v := getattr(msg, attr, None)) is not None:
                setattr(upd, attr, v)
        return upd

    return None
