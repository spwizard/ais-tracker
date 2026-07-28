"""Ferry service-status eye — CalMac + NorthLink route status for the sea layer.

The vessels themselves are already live on AIS; this adds whether the *service*
is running. CalMac's site runs on an open GraphQL API (keyless, verified): one
query gives all 30 routes with port coordinates and a NORMAL/BE_AWARE/
DISRUPTIONS status, another gives the notice text — joined by route id, keeping
the most severe notice (WARNING first) for any route not running normally.
NorthLink (Orkney/Shetland) has no status API; its ops updates are a public
WordPress feed, matched to routes by port keywords, with disruption-ish wording
downgrading the route to be_aware. Both are undocumented feeds — parsers are
defensive and a failed poll keeps the last good set.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

import httpx

from ..config import Settings
from ..models import FerryPort, FerryRoute
from ..store.ferry import FerryStore
from .base import Source

log = logging.getLogger("source")

_UA = "arguseyes/1.0 (+land-air-sea situational awareness)"
POLL_SEC = 300.0

CALMAC_GQL = "https://apim.calmac.co.uk/graphql"
_ROUTES_Q = "{ routes { id name status ports { name latitude longitude } } }"
_STATUS_Q = "{ routeStatuses { route { id } status title detail } }"

NORTHLINK_OPS = "https://www.northlinkferries.co.uk/wp-json/wp/v2/opsnews"

# NorthLink's routes, keyed by keywords found in opsnews post titles. Port
# positions are the harbours themselves (well-known fixed locations).
_NORTHLINK_ROUTES = [
    {
        "id": "northlink:pentland",
        "name": "Scrabster - Stromness",
        "keys": ("pentland", "scrabster", "stromness", "hamnavoe"),
        "ports": [FerryPort(name="Scrabster", lat=58.612, lon=-3.554),
                  FerryPort(name="Stromness", lat=58.965, lon=-3.296)],
    },
    {
        "id": "northlink:aberdeen",
        "name": "Aberdeen - Kirkwall - Lerwick",
        "keys": ("aberdeen", "kirkwall", "lerwick", "hatston", "hjaltland", "hrossey"),
        "ports": [FerryPort(name="Aberdeen", lat=57.144, lon=-2.077),
                  FerryPort(name="Kirkwall (Hatston)", lat=58.995, lon=-2.972),
                  FerryPort(name="Lerwick", lat=60.157, lon=-1.144)],
    },
]

# Wording in an ops post that suggests the service isn't running sweetly.
_DISRUPTED = re.compile(
    r"cancel|suspend|disrupt|delayed|unable to sail|not sail|adverse weather", re.I
)
_TAG = re.compile(r"<[^>]+>")


def _plain(html: str | None, limit: int = 500) -> str | None:
    if not html:
        return None
    text = _TAG.sub(" ", html)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] or None


def parse_calmac(routes_body: dict, statuses_body: dict, now: float) -> list[FerryRoute]:
    routes = (routes_body.get("data") or {}).get("routes") or []
    statuses = (statuses_body.get("data") or {}).get("routeStatuses") or []
    # Route id → best notice. WARNING beats the standing SERVICE/INFORMATION
    # boilerplate (freight rules etc.) that every route carries year-round.
    best: dict[str, dict] = {}
    for s in statuses:
        rid = ((s.get("route") or {}).get("id")) or ""
        if not rid:
            continue
        cur = best.get(rid)
        if cur is None or (s.get("status") == "WARNING" and cur.get("status") != "WARNING"):
            best[rid] = s

    out: list[FerryRoute] = []
    for r in routes:
        rid = r.get("id") or ""
        status = (r.get("status") or "NORMAL").lower()  # normal|be_aware|disruptions
        notice = best.get(rid) if status != "normal" else None
        ports = []
        for p in r.get("ports") or []:
            try:
                ports.append(FerryPort(
                    name=p.get("name") or "?",
                    lat=float(p["latitude"]),
                    lon=float(p["longitude"]),
                ))
            except (KeyError, ValueError, TypeError):
                continue
        if len(ports) < 2:
            continue  # can't draw a route without two ends
        out.append(FerryRoute(
            id=f"calmac:{rid.removeprefix('route-')}",
            operator="CalMac",
            name=r.get("name") or "?",
            status=status,
            title=(notice or {}).get("title"),
            detail=_plain((notice or {}).get("detail")),
            ports=ports,
            updated=now,
        ))
    return out


def parse_northlink(posts: list[dict], now: float) -> list[FerryRoute]:
    """Match the latest ops post to each route; disruption-ish wording downgrades
    the route to be_aware (we never claim DISRUPTIONS from wording alone)."""
    out: list[FerryRoute] = []
    for route in _NORTHLINK_ROUTES:
        latest: dict | None = None
        for p in posts:  # posts arrive newest-first
            title = ((p.get("title") or {}).get("rendered") or "").lower()
            if any(k in title for k in route["keys"]):
                latest = p
                break
        text = _plain(((latest or {}).get("content") or {}).get("rendered"))
        disrupted = bool(text and _DISRUPTED.search(text))
        out.append(FerryRoute(
            id=route["id"],
            operator="NorthLink",
            name=route["name"],
            status="be_aware" if disrupted else "normal",
            title=((latest or {}).get("title") or {}).get("rendered"),
            detail=text,
            ports=route["ports"],
            updated=now,
        ))
    return out


class FerrySource(Source):
    name = "ferries"

    def __init__(self, store: FerryStore, settings: Settings) -> None:
        super().__init__(store)  # type: ignore[arg-type]
        self.stale_after = POLL_SEC * 2 + 60.0  # slow poller, like FIRMS

    @property
    def configured(self) -> bool:
        return True

    async def _consume(self) -> None:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0), headers={"User-Agent": _UA}
        ) as client:
            self.connected = True
            while not self._stop.is_set():
                now = time.time()
                routes: list[FerryRoute] = []
                ok = False
                try:
                    r1 = await client.post(CALMAC_GQL, json={"query": _ROUTES_Q})
                    r2 = await client.post(CALMAC_GQL, json={"query": _STATUS_Q})
                    r1.raise_for_status()
                    r2.raise_for_status()
                    routes.extend(parse_calmac(r1.json(), r2.json(), now))
                    ok = True
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    log.warning("[ferries] calmac fetch failed: %s", exc)
                try:
                    r3 = await client.get(NORTHLINK_OPS, params={"per_page": 20})
                    r3.raise_for_status()
                    routes.extend(parse_northlink(r3.json(), now))
                    ok = True
                except (httpx.HTTPError, ValueError, KeyError) as exc:
                    log.warning("[ferries] northlink fetch failed: %s", exc)
                if ok and routes:
                    await self._store.replace(routes)
                    self.messages_seen += len(routes)
                    self.last_msg_ts = now
                await asyncio.sleep(POLL_SEC)
