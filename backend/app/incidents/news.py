"""News RSS eye — London incidents from news outlets, extracted by AI.

Polls London news feeds, keeps only items whose headline/summary looks like a
current incident (cheap keyword pre-filter, so we never spend AI on court
cases or policy pieces), then asks Claude to extract a typed, located incident
— rejecting stale/national/non-incident stories. The location is geocoded via
OpenStreetMap Nominatim (free) and the result flows into the spine as a
"reported" incident, where camera verification then confirms or clears it.
"""
from __future__ import annotations

import asyncio
import hashlib
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Literal

import anthropic
import httpx
from pydantic import BaseModel

from ..config import Settings
from ..models import Incident
from ..store.incident import IncidentStore
from ..sources.base import Source, log

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 300.0
FRESH_SEC = 5400.0   # only items published in the last ~90 min
TTL_SEC = 7200.0     # a news incident stays live ~2h then ages out
LONDON_BBOX = (-0.55, 51.28, 0.35, 51.70)  # W, S, E, N

FEEDS = [
    "https://feeds.bbci.co.uk/news/england/london/rss.xml",
    "https://www.standard.co.uk/news/london/rss",
]

# Cheap pre-filter — an item must smell like an incident before it costs any AI.
_KEYWORDS = re.compile(
    r"\b(crash|collision|collid|stabb|shooting|shot|gun|fire|blaze|explos|"
    r"closed|closure|evacuat|flood|derail|collaps|attack|cordon|emergency|"
    r"killed|injured|casualt|incident|suspend|hit by|pedestrian|lorry|"
    r"knife|assault|police|ambulance|road closed|major delays|disruption)\b",
    re.I,
)

_CATEGORY_MAP = {
    "collision": "collision",
    "fire": "hazard",
    "crime": "other",
    "hazard": "hazard",
    "disruption": "delay",
    "event": "event",
    "other": "other",
}


class NewsExtract(BaseModel):
    is_incident: bool  # a CURRENT, located London incident (not court/policy/old news)
    category: Literal["collision", "fire", "crime", "hazard", "disruption", "event", "other"]
    severity: Literal["minor", "moderate", "serious"]
    location: str  # a specific London place/road, or "" if none is stated
    summary: str   # one concise line


EXTRACT_SYSTEM = (
    "You triage London news headlines into map incidents. An incident is a "
    "CURRENT, physically-located event happening now or in the last hour or two "
    "(a crash, fire, closure, police cordon, flooding, disruption). It is NOT a "
    "court case, sentencing, policy story, statistic, or anything without a "
    "specific London location. If it isn't a current located incident, set "
    "is_incident=false. Only extract a location you can point to on a map "
    "(road, junction, station, area, borough). Keep summary under 18 words."
)


def _hash(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()[:12]


def _parse_date(s: str | None) -> float | None:
    if not s:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
    return None


class NewsSource(Source):
    name = "news"

    def __init__(self, store: IncidentStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._key = settings.anthropic_api_key
        self._model = settings.camera_vision_model
        self._geocache: dict[str, tuple[float, float] | None] = {}
        self._client: anthropic.AsyncAnthropic | None = None
        # id -> (Incident, first_seen) so news persists across polls then TTLs out.
        self._live: dict[str, Incident] = {}

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def _fetch_items(self, client: httpx.AsyncClient) -> list[dict]:
        now = time.time()
        out: list[dict] = []
        for url in FEEDS:
            try:
                r = await client.get(url)
                r.raise_for_status()
                root = ET.fromstring(r.content)
            except (httpx.HTTPError, ET.ParseError):
                continue
            for it in root.findall(".//item"):
                title = (it.findtext("title") or "").strip()
                desc = re.sub(r"<[^>]+>", "", it.findtext("description") or "").strip()
                link = (it.findtext("link") or "").strip()
                ts = _parse_date(it.findtext("pubDate")) or now
                if now - ts > FRESH_SEC:
                    continue
                if not _KEYWORDS.search(f"{title} {desc}"):
                    continue
                out.append({"title": title, "desc": desc, "link": link, "ts": ts})
        return out

    async def _extract(self, item: dict) -> NewsExtract | None:
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self._key, max_retries=1)
        try:
            resp = await self._client.messages.parse(
                model=self._model,
                max_tokens=200,
                system=EXTRACT_SYSTEM,
                messages=[{"role": "user", "content": f"{item['title']}. {item['desc']}"}],
                output_format=NewsExtract,
            )
            return resp.parsed_output
        except Exception as exc:  # noqa: BLE001
            log.warning("[news] extract failed: %s", exc)
            return None

    async def _geocode(self, place: str, client: httpx.AsyncClient) -> tuple[float, float] | None:
        key = place.lower().strip()
        if key in self._geocache:
            return self._geocache[key]
        # Try the full phrase, then a simplified fallback (drop "near/at/between
        # …" and any trailing clause) so "A40 Westway near Paddington" still hits.
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
        self._geocache[key] = result
        return result

    async def _consume(self) -> None:
        if not self._key:
            await self._stop.wait()
            return
        async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": _UA}, follow_redirects=True) as client:
            self.connected = True
            while not self._stop.is_set():
                now = time.time()
                items = await self._fetch_items(client)
                for item in items:
                    iid = f"news:{_hash(item['link'] or item['title'])}"
                    if iid in self._live:  # already surfaced this story
                        continue
                    ex = await self._extract(item)
                    if ex is None or not ex.is_incident or not ex.location:
                        continue
                    pt = await self._geocode(ex.location, client)
                    if pt is None:
                        continue
                    self.messages_seen += 1
                    self.last_msg_ts = time.time()
                    self._live[iid] = Incident(
                        id=iid,
                        source="news",
                        category=_CATEGORY_MAP.get(ex.category, "other"),
                        severity=ex.severity,
                        confidence="reported",
                        title=ex.summary,
                        detail=item["title"],
                        location=ex.location,
                        lat=pt[0],
                        lon=pt[1],
                        url=item["link"] or None,
                        ts=item["ts"],
                        updated=now,
                    )
                # Age out stale news, then publish the live set.
                self._live = {i: v for i, v in self._live.items() if now - v.ts < TTL_SEC}
                await self._store.replace_source("news", list(self._live.values()))
                await asyncio.sleep(POLL_SEC)
