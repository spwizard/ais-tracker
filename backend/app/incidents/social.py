"""Bluesky eye — real-time London incidents from social, extracted by AI.

Bluesky's PUBLIC search endpoint WAF-blocks datacenter IPs, so this uses an
authenticated session (a free account + app password from Bluesky settings →
App Passwords). It searches recent posts for incident terms, runs each fresh
candidate through the shared extract→geocode pipeline, and lands confirmed
ones as "reported" incidents — where camera verification then confirms or
clears them. Idle (amber) until BLUESKY_HANDLE + BLUESKY_APP_PASSWORD are set.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from datetime import datetime, timezone

import anthropic
import httpx

from ..config import Settings
from ..models import Incident
from ..sources.base import Source, log
from ..store.incident import IncidentStore
from .enrich import CATEGORY_MAP, KEYWORDS, extract_incident, geocode_london

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 120.0
FRESH_SEC = 2700.0   # posts from the last ~45 min
TTL_SEC = 5400.0     # a social incident stays live ~90 min then ages out
PDS = "https://bsky.social"
APPVIEW = "https://api.bsky.app"
# Targeted London incident searches — narrower than "London" to cut noise.
QUERIES = [
    "London crash", "London fire", "London police incident",
    "London road closed", "London stabbing", "London collision",
]


def _hash(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()[:12]


class SocialSource(Source):
    name = "bluesky"

    def __init__(self, store: IncidentStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self._handle = settings.bluesky_handle
        self._password = settings.bluesky_app_password
        self._key = settings.anthropic_api_key
        self._model = settings.camera_vision_model
        self._geocache: dict[str, tuple[float, float] | None] = {}
        self._client: anthropic.AsyncAnthropic | None = None
        self._jwt: str | None = None
        self._live: dict[str, Incident] = {}

    @property
    def configured(self) -> bool:
        return bool(self._handle and self._password and self._key)

    async def _login(self, client: httpx.AsyncClient) -> None:
        r = await client.post(
            f"{PDS}/xrpc/com.atproto.server.createSession",
            json={"identifier": self._handle, "password": self._password},
        )
        r.raise_for_status()
        self._jwt = r.json()["accessJwt"]

    async def _search(self, client: httpx.AsyncClient, q: str) -> list[dict]:
        if self._jwt is None:
            await self._login(client)
        headers = {"Authorization": f"Bearer {self._jwt}"}
        r = await client.get(
            f"{APPVIEW}/xrpc/app.bsky.feed.searchPosts",
            params={"q": q, "limit": 25, "sort": "latest"},
            headers=headers,
        )
        if r.status_code == 401:  # token expired → re-login once
            await self._login(client)
            r = await client.get(
                f"{APPVIEW}/xrpc/app.bsky.feed.searchPosts",
                params={"q": q, "limit": 25, "sort": "latest"},
                headers={"Authorization": f"Bearer {self._jwt}"},
            )
        r.raise_for_status()
        return r.json().get("posts", [])

    async def _consume(self) -> None:
        if not self.configured:
            await self._stop.wait()  # no creds → idle (amber in the UI)
            return
        async with httpx.AsyncClient(timeout=30.0, headers={"User-Agent": _UA}) as client:
            if self._client is None:
                self._client = anthropic.AsyncAnthropic(api_key=self._key, max_retries=1)
            self.connected = True
            while not self._stop.is_set():
                now = time.time()
                candidates: dict[str, dict] = {}
                for q in QUERIES:
                    try:
                        for p in await self._search(client, q):
                            rec = p.get("record", {})
                            txt = (rec.get("text") or "").strip()
                            created = rec.get("createdAt", "")
                            try:
                                ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
                            except ValueError:
                                ts = now
                            if now - ts > FRESH_SEC or not KEYWORDS.search(txt):
                                continue
                            uri = p.get("uri", "")
                            candidates[uri] = {"text": txt, "ts": ts, "handle": p.get("author", {}).get("handle")}
                    except httpx.HTTPError as exc:
                        log.warning("[bluesky] search failed: %s", exc)
                        self._jwt = None  # force re-login next cycle

                for uri, c in candidates.items():
                    iid = f"bluesky:{_hash(uri)}"
                    if iid in self._live:
                        continue
                    ex = await extract_incident(self._client, self._model, c["text"])
                    if ex is None or not ex.is_incident or not ex.location:
                        continue
                    pt = await geocode_london(ex.location, client, self._geocache)
                    if pt is None:
                        continue
                    self.messages_seen += 1
                    self.last_msg_ts = time.time()
                    handle = c.get("handle")
                    web = uri.replace("at://", "https://bsky.app/profile/").replace("/app.bsky.feed.post/", "/post/")
                    self._live[iid] = Incident(
                        id=iid,
                        source="bluesky",
                        category=CATEGORY_MAP.get(ex.category, "other"),
                        severity=ex.severity,
                        confidence="reported",
                        title=ex.summary,
                        detail=f"@{handle} on Bluesky" if handle else "Reported on Bluesky",
                        location=ex.location,
                        lat=pt[0],
                        lon=pt[1],
                        url=web,
                        ts=c["ts"],
                        updated=now,
                    )
                self._live = {i: v for i, v in self._live.items() if now - v.ts < TTL_SEC}
                await self._store.replace_source("bluesky", list(self._live.values()))
                await asyncio.sleep(POLL_SEC)
