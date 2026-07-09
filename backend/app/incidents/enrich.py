"""Shared enrichment for text-based incident eyes (news, social).

Both turn free text into a located incident the same way: a cheap keyword
pre-filter, a Claude structured extraction that rejects non-incidents, and a
London-bounded Nominatim geocode. Kept here so news and social share one
implementation.
"""
from __future__ import annotations

import asyncio
import re
from typing import Literal

import anthropic
import httpx
from pydantic import BaseModel

from ..sources.base import log

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
LONDON_BBOX = (-0.55, 51.28, 0.35, 51.70)  # W, S, E, N

# Cheap pre-filter — text must smell like an incident before it costs any AI.
KEYWORDS = re.compile(
    r"\b(crash|collision|collid|stabb|shooting|shot|gun|fire|blaze|explos|"
    r"closed|closure|evacuat|flood|derail|collaps|attack|cordon|emergency|"
    r"killed|injured|casualt|incident|suspend|hit by|pedestrian|lorry|"
    r"knife|assault|police|ambulance|road closed|major delays|disruption)\b",
    re.I,
)

CATEGORY_MAP = {
    "collision": "collision",
    "fire": "hazard",
    "crime": "other",
    "hazard": "hazard",
    "disruption": "delay",
    "event": "event",
    "other": "other",
}


class IncidentExtract(BaseModel):
    is_incident: bool  # a CURRENT, located London incident (not court/policy/old news)
    category: Literal["collision", "fire", "crime", "hazard", "disruption", "event", "other"]
    severity: Literal["minor", "moderate", "serious"]
    location: str  # a specific London place/road, or "" if none is stated
    summary: str   # one concise line


EXTRACT_SYSTEM = (
    "You triage London posts/headlines into map incidents. An incident is a "
    "CURRENT, physically-located event happening now or in the last hour or two "
    "(a crash, fire, closure, police cordon, flooding, disruption). It is NOT a "
    "court case, sentencing, opinion, policy story, statistic, joke, or anything "
    "without a specific London location. If it isn't a current located incident, "
    "set is_incident=false. Only extract a location you can point to on a map "
    "(road, junction, station, area, borough). Keep summary under 18 words."
)


async def extract_incident(
    client: anthropic.AsyncAnthropic, model: str, text: str
) -> IncidentExtract | None:
    try:
        resp = await client.messages.parse(
            model=model,
            max_tokens=200,
            system=EXTRACT_SYSTEM,
            messages=[{"role": "user", "content": text}],
            output_format=IncidentExtract,
        )
        return resp.parsed_output
    except Exception as exc:  # noqa: BLE001
        log.warning("[enrich] extract failed: %s", exc)
        return None


async def geocode_london(
    place: str, client: httpx.AsyncClient, cache: dict[str, tuple[float, float] | None]
) -> tuple[float, float] | None:
    key = place.lower().strip()
    if key in cache:
        return cache[key]
    # Full phrase, then a simplified fallback (drop "near/at/between …" clause).
    simple = re.split(r"\s+(?:near|at|between|by|outside|opposite)\s+|,", place, 1)[0].strip()
    candidates = [place] if simple == place else [place, simple]
    result = None
    for q in candidates:
        await asyncio.sleep(1.1)  # Nominatim: <=1 req/sec
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": f"{q}, London", "format": "json", "limit": 1,
                        "countrycodes": "gb", "viewbox": "-0.55,51.70,0.35,51.28", "bounded": 1},
                headers={"User-Agent": _UA},
            )
            r.raise_for_status()
            hits = r.json()
        except (httpx.HTTPError, ValueError):
            hits = []
        if hits:
            lat, lon = float(hits[0]["lat"]), float(hits[0]["lon"])
            w, s, e, n = LONDON_BBOX
            if w <= lon <= e and s <= lat <= n:
                result = (lat, lon)
                break
    cache[key] = result
    return result
