"""Darwin Push Port message parsing (v16 schema).

The Push Port streams gzipped XML frames. The ones that matter for positions
are ``TS`` (train status) elements: per-service (RID) forecasts with estimated
/ actual times at each location (TIPLOC). This module is pure parsing —
transport (STOMP/Kafka) plugs in around it once credentials arrive.

Times in TS elements are local wall-clock "HH:MM[:SS]" for the service's date
(``ssd`` attribute); we resolve them to epoch seconds, handling the
past-midnight rollover by monotonicity (a time that jumps backwards more than
12h is the next day).
"""
from __future__ import annotations

import gzip
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

# Namespaces vary by schema minor version — match by local-name instead.
_TS_TAG = re.compile(r"\{[^}]*\}TS$")
_LOC_TAG = re.compile(r"\{[^}]*\}Location$")


@dataclass(frozen=True)
class LocationForecast:
    tiploc: str
    t: float  # best-available time at this location (epoch seconds)
    actual: bool  # True when an actual (at) rather than estimate (et)


@dataclass(frozen=True)
class ServiceForecast:
    rid: str  # Darwin service id
    uid: str | None
    late_min: float | None  # best-known lateness (from the latest location delay)
    locations: list[LocationForecast]


def _strip(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_hhmm(base: datetime, s: str, prev: float | None) -> float | None:
    try:
        parts = [int(x) for x in s.split(":")]
    except ValueError:
        return None
    if len(parts) == 2:
        h, m, sec = parts[0], parts[1], 0
    elif len(parts) == 3:
        h, m, sec = parts
    else:
        return None
    t = (base + timedelta(hours=h, minutes=m, seconds=sec)).timestamp()
    # Services running past midnight: times must not go backwards by >12h.
    if prev is not None and t < prev - 12 * 3600:
        t += 24 * 3600
    return t


def maybe_gunzip(payload: bytes) -> bytes:
    """Push Port frames are usually gzipped; pass through plain XML too."""
    if payload[:2] == b"\x1f\x8b":
        return gzip.decompress(payload)
    return payload


def parse_pushport(payload: bytes) -> list[ServiceForecast]:
    """Extract per-service forecasts from one Push Port frame.

    Returns [] for frames that carry no TS elements (schedules, alarms,
    station messages…) — callers just skip those.
    """
    try:
        root = ET.fromstring(maybe_gunzip(payload))
    except ET.ParseError:
        return []

    out: list[ServiceForecast] = []
    for ts in root.iter():
        if not _TS_TAG.search(ts.tag):
            continue
        rid = ts.get("rid") or ""
        if not rid:
            continue
        ssd = ts.get("ssd") or ""  # service start date, YYYY-MM-DD (local)
        try:
            base = datetime.fromisoformat(ssd).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

        locs: list[LocationForecast] = []
        late_min: float | None = None
        prev_t: float | None = None
        for loc in ts:
            if not _LOC_TAG.search(loc.tag):
                continue
            tpl = loc.get("tpl") or ""
            if not tpl:
                continue
            # Prefer departure over arrival, actual (at) over estimate (et).
            best: tuple[float, bool] | None = None
            for child in loc:
                name = _strip(child.tag)
                if name not in ("arr", "dep", "pass"):
                    continue
                for attr, actual in (("at", True), ("et", False)):
                    v = child.get(attr)
                    if v is None:
                        continue
                    t = _parse_hhmm(base, v, prev_t)
                    if t is None:
                        continue
                    # dep beats arr at the same stop; actual beats estimate.
                    if best is None or (actual and not best[1]) or name == "dep":
                        best = (t, actual)
                delay = child.get("delay")  # minutes, when Darwin supplies it
                if delay is not None:
                    try:
                        late_min = float(delay)
                    except ValueError:
                        pass
            if best is not None:
                prev_t = best[0]
                locs.append(LocationForecast(tpl, best[0], best[1]))

        if locs:
            out.append(ServiceForecast(rid=rid, uid=ts.get("uid"), late_min=late_min, locations=locs))
    return out
