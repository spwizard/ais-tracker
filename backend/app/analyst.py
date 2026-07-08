"""AI analyst — conversational intelligence over the live picture.

Claude runs a small tool loop over the data the app already produces (live
fleet, Lloyd's ownership, sanctions, behavioral risk events, weather) and
answers questions like "which Russian-flagged tankers are in the Baltic?" or
"anything suspicious near the Estonian coast tonight?". A `show_on_map` tool
lets the model drive the map (highlight vessels, fly the camera) while the
prose answer streams to the chat.

Grounding contract: the model may only state what the tools returned this
conversation — same discipline as the briefing service. Events are streamed
as SSE dicts: delta (answer text), tool (trace chip), map (directive),
final (cost/summary), error.
"""
from __future__ import annotations

import datetime
import json
import logging
from typing import Any, AsyncIterator, Awaitable, Callable

import anthropic

from .briefing import _call_cost, _friendly_error
from .mid import flag_for_mmsi
from .ship_types import group_for

log = logging.getLogger("analyst")

MAX_ROUNDS = 6
MAX_HISTORY = 8  # prior chat turns kept for context

# Named sea regions (W, S, E, N) the model can filter by.
REGIONS: dict[str, tuple[float, float, float, float]] = {
    "english_channel": (-5.5, 48.3, 1.8, 51.2),
    "dover_strait": (0.8, 50.7, 2.2, 51.4),
    "thames_estuary": (0.3, 51.3, 1.8, 51.8),
    "solent": (-1.9, 50.6, -1.0, 51.0),
    "bristol_channel": (-6.5, 50.8, -2.5, 51.8),
    "irish_sea": (-7.0, 51.8, -2.7, 55.3),
    "celtic_sea": (-12.0, 48.0, -4.0, 52.0),
    "bay_of_biscay": (-10.0, 43.3, -0.5, 48.3),
    "north_sea": (-2.0, 51.0, 9.0, 61.0),
    "skagerrak_kattegat": (7.0, 55.3, 13.0, 60.0),
    "baltic_sea": (9.5, 53.5, 30.5, 66.0),
    "gulf_of_finland": (22.5, 59.2, 30.5, 60.8),
    "gulf_of_bothnia": (17.0, 60.0, 25.6, 66.0),
    "norwegian_coast": (4.0, 57.5, 31.0, 71.5),
}

NAV_STATUS = {
    0: "under way", 1: "at anchor", 2: "not under command", 3: "restricted manoeuvre",
    4: "constrained by draught", 5: "moored", 6: "aground", 7: "fishing", 8: "sailing",
}

TOOLS: list[dict] = [
    {
        "name": "query_vessels",
        "description": (
            "Search the live fleet (vessels currently transmitting AIS in coverage). "
            "All filters are optional and combine with AND. Returns the total match "
            "count plus up to `limit` vessels."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "flag": {"type": "string", "description": "Flag state, e.g. 'Russia', 'Panama', 'United Kingdom'"},
                "type": {
                    "type": "string",
                    "enum": ["cargo", "tanker", "passenger", "fishing", "highspeed", "tug", "pleasure", "other"],
                },
                "region": {"type": "string", "enum": list(REGIONS)},
                "min_speed_kn": {"type": "number"},
                "max_speed_kn": {"type": "number"},
                "status": {"type": "string", "enum": ["underway", "anchored", "moored"]},
                "name_contains": {"type": "string"},
                "flagged_only": {
                    "type": "boolean",
                    "description": "Only vessels currently flagged: sanctions-listed or with a recent behavioral risk event",
                },
                "sort": {"type": "string", "enum": ["speed_desc", "speed_asc"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
    },
    {
        "name": "vessel_dossier",
        "description": (
            "Full intelligence dossier for one vessel: identity, flag, position, "
            "Lloyd's ownership chain, sanctions screening (vessel + owners), "
            "deterministic risk score with reasons, recent behavioral events, and "
            "current sea conditions. Use after query_vessels to dig into a vessel."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"mmsi": {"type": "integer"}},
            "required": ["mmsi"],
        },
    },
    {
        "name": "recent_events",
        "description": (
            "Behavioral risk events detected recently across the whole fleet: "
            "possible STS rendezvous (two vessels loitering together at sea) and "
            "AIS spoofing (impossible position jumps)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"hours": {"type": "number", "minimum": 0.1, "maximum": 72}},
        },
    },
    {
        "name": "weather_at",
        "description": "Current wind, gusts, waves, temperature and pressure at a sea position.",
        "input_schema": {
            "type": "object",
            "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}},
            "required": ["lat", "lon"],
        },
    },
    {
        "name": "show_on_map",
        "description": (
            "Drive the user's map: highlight specific vessels and/or fly the camera "
            "to a position. Call this whenever your answer references specific "
            "vessels or a specific area, BEFORE writing the final answer."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mmsis": {"type": "array", "items": {"type": "integer"}, "description": "Vessels to ring-highlight"},
                "lat": {"type": "number"},
                "lon": {"type": "number"},
                "zoom": {"type": "number", "minimum": 3, "maximum": 14},
            },
        },
    },
]

# Land-domain eyes — only offered when the TfL camera feed is enabled.
CAMERA_TOOLS: list[dict] = [
    {
        "name": "find_cameras",
        "description": (
            "Search London's ~880 live TfL traffic cameras (the app's land-domain "
            "eyes). Filter by a road/place name substring and/or sort by distance "
            "to a lat/lon. Returns camera ids, names, positions and view direction."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Road or place substring, e.g. 'A40', 'Earls Court', 'Tower Bridge'",
                },
                "lat": {"type": "number", "description": "With lon: sort nearest-first to this point"},
                "lon": {"type": "number"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 15},
            },
        },
    },
    {
        "name": "view_camera",
        "description": (
            "LOOK through one traffic camera right now: runs AI vision on its live "
            "snapshot and returns congestion (clear/light/moderate/heavy/jam), "
            "approximate counts of road users by type, and a one-line scene "
            "description. Use find_cameras first to get a camera_id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"camera_id": {"type": "string"}},
            "required": ["camera_id"],
        },
    },
]

# Rail-domain tools — offered when the live Darwin feed is wired in.
RAIL_TOOLS: list[dict] = [
    {
        "name": "query_trains",
        "description": (
            "Search live GB rail services (national Darwin feed). Filters "
            "combine with AND. `to`/`from` match origin/destination names. "
            "Returns total matches plus up to `limit` services with their "
            "current position, next calling point and lateness."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Destination contains, e.g. 'Manchester'"},
                "from": {"type": "string", "description": "Origin contains"},
                "min_delay_min": {"type": "number", "description": "Only services at least this late"},
                "sort": {"type": "string", "enum": ["delay_desc", "delay_asc"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 25},
            },
        },
    },
    {
        "name": "train_dossier",
        "description": (
            "One service in full: origin, destination, lateness, current "
            "inferred position and the complete calling pattern with predicted "
            "times. Use the `id` from query_trains or station_board."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "station_board",
        "description": (
            "A live departure/arrival board for any GB station, built from the "
            "live feed: the next services calling there with predicted times, "
            "where they started and where they're going, and lateness. "
            "Match by station name or 3-letter CRS code."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "station": {"type": "string", "description": "Name or CRS, e.g. 'Reading' or 'RDG'"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            "required": ["station"],
        },
    },
]

SYSTEM_PROMPT = """\
You are the on-duty maritime intelligence analyst inside a live vessel-tracking \
application. The user is looking at a map of live AIS traffic; you have tools \
that query the same live picture plus the app's intelligence holdings (Lloyd's \
ownership, OFAC sanctions screening, behavioral risk detections, weather).

COVERAGE — the app currently tracks the UK / English Channel (AISStream), the \
Baltic and Finnish waters (Digitraffic), and the Norwegian coast (Kystverket). \
Only vessels currently transmitting inside that coverage are visible. If asked \
about somewhere else, say it's outside coverage.

THE RAILWAY — when rail tools are available you also watch every live GB
train (the national Darwin feed): query_trains to search, station_board for
live departures at any station, train_dossier for one service's full calling
pattern. Positions are inferred between calling points (indicative). Services
have no public headcode in this feed — refer to them as "the HH:MM Origin to
Destination" using their first calling-point time. Times are UK local. After
rail answers, call show_on_map with the service's lat/lon to point the map at
it when the user asks about a specific train or area.

EYES ON LAND — when camera tools are available you can literally look at London \
road traffic: find_cameras locates TfL junction cameras, view_camera runs vision \
on one's live snapshot. Use them for questions about London roads, congestion or \
conditions at a place. When several found cameras cover the asked location, view \
EACH relevant one (up to 3) before answering — one viewpoint misses what another \
shows, and the user is shown every frame you analyze as evidence. The feed is a \
low-resolution snapshot refreshed every few minutes: report reads as indicative \
("looks heavy right now"), counts as approximate, and never claim to identify a \
specific vehicle or person.

RULES
1. Ground every claim in tool results from THIS conversation. Never invent \
   vessels, counts, owners, or events. If the tools return nothing, say so.
2. Do not allege criminality — flag risk for human review using calibrated \
   language ("consistent with", "warrants a closer look").
3. Drive the map with REAL data only. First call the data tools and read their \
   results; THEN, in a later step (never in the same step as a search), call \
   show_on_map with the exact MMSIs you retrieved, and answer. Never pass an \
   MMSI you have not retrieved this conversation — do not guess identifiers.
4. Be an analyst, not a search box: prioritize what matters (sanctions hits and \
   rendezvous/spoofing first), give one line of context per vessel, and suggest \
   the obvious next question when useful.
5. Do NOT narrate your tool use — never write "Let me check…", "I'll query…", \
   or describe what you're about to do. The user already sees a live trace of \
   your tools. Use the tools silently, then write only the finished answer.
6. Formatting (the chat panel is ~360px wide):
   • Bold each vessel as NAME then its 9-digit MMSI in parentheses, once: \
     **KAPITAN LEONTIY (273358000)** — this becomes a clickable chip.
   • For several vessels use a short "- " bullet list, one vessel per line.
   • NEVER use markdown tables or headings — they overflow the panel.
   • No preamble, no sign-off. A few sentences or a short list is right; never pad.
7. Quietly note material caveats (ownership snapshot age, name-only matches) \
   in one clause, not a paragraph."""


def _round(x: float | None, nd: int = 3) -> float | None:
    return None if x is None else round(x, nd)


def _compact(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [])}


def _mmsis_in(result) -> set[int]:
    """MMSIs a tool result actually surfaced — used to ground show_on_map so the
    model can only highlight vessels it really retrieved (no hallucinated IDs)."""
    out: set[int] = set()
    if not isinstance(result, dict):
        return out
    for v in result.get("vessels") or []:
        if isinstance(v, dict) and v.get("mmsi"):
            out.add(int(v["mmsi"]))
    for e in result.get("events") or []:
        for k in ("mmsi", "mmsi_b"):
            if isinstance(e, dict) and e.get(k):
                out.add(int(e[k]))
    v = result.get("vessel")
    if isinstance(v, dict) and v.get("mmsi"):
        out.add(int(v["mmsi"]))
    return out


def _camera_peek(tool_name: str, result: Any) -> dict | None:
    """A `camera` SSE event for the chat UI when the analyst looked through a
    camera — carries the snapshot URL so the panel can show the actual frame."""
    if tool_name != "view_camera" or not isinstance(result, dict):
        return None
    cam = result.get("camera")
    if not isinstance(cam, dict) or not cam.get("image"):
        return None
    analysis = result.get("analysis") or {}
    return {
        "type": "camera",
        "camera": {
            "id": cam.get("id"),
            "name": cam.get("name"),
            "image": cam.get("image"),
            "view": cam.get("view"),
        },
        "congestion": analysis.get("congestion"),
    }


class AnalystService:
    """Claude tool loop over callables supplied by the app (no direct app deps)."""

    def __init__(
        self,
        model: str,
        api_key: str = "",
        *,
        provider: str = "anthropic",
        gemini_key: str = "",
        gemini_model: str = "gemini-2.5-flash",
        snapshot: Callable[[], Awaitable[list]],
        dossier: Callable[[int], Awaitable[dict | None]],
        events: Callable[[float], list[dict]],
        conditions: Callable[[float, float], Awaitable[dict | None]],
        flagged: Callable[[], Awaitable[set[int]]],
        cameras: Callable[[], Awaitable[list[dict]]] | None = None,
        camera_view: Callable[[str], Awaitable[dict]] | None = None,
        trains: Callable[[], Awaitable[list]] | None = None,
    ) -> None:
        self._model = model
        self._api_key = api_key or None
        self._provider = provider
        self._gemini_key = gemini_key
        self._gemini_model = gemini_model
        self._client: anthropic.AsyncAnthropic | None = None
        self._snapshot = snapshot
        self._dossier = dossier
        self._events = events
        self._conditions = conditions
        self._flagged = flagged
        self._cameras = cameras
        self._camera_view = camera_view
        self._trains = trains

    def _tools(self) -> list[dict]:
        """The tool set for this deployment — camera tools only when the land
        camera feed is wired in."""
        tools = list(TOOLS)
        if self._cameras and self._camera_view:
            tools += CAMERA_TOOLS
        if self._trains is not None:
            tools += RAIL_TOOLS
        return tools

    def _ensure_client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self._api_key, max_retries=1)
        return self._client

    # --- tool implementations ---------------------------------------------

    async def _query_vessels(self, p: dict) -> dict:
        snap = await self._snapshot()
        region = REGIONS.get(p.get("region") or "")
        flag_q = (p.get("flag") or "").strip().lower()
        name_q = (p.get("name_contains") or "").strip().lower()
        want_type = p.get("type")
        status = p.get("status")
        fset = await self._flagged() if p.get("flagged_only") else None

        rows = []
        for v in snap:
            if v.lat is None or v.lon is None:
                continue
            if region:
                W, S, E, N = region
                if not (W <= v.lon <= E and S <= v.lat <= N):
                    continue
            if want_type and group_for(v.ship_type) != want_type:
                continue
            flag = flag_for_mmsi(v.mmsi)
            if flag_q and (flag or "").lower().find(flag_q) < 0:
                continue
            if name_q and name_q not in (v.name or "").lower():
                continue
            sog = v.sog if v.sog is not None else 0.0
            if p.get("min_speed_kn") is not None and sog < p["min_speed_kn"]:
                continue
            if p.get("max_speed_kn") is not None and sog > p["max_speed_kn"]:
                continue
            if status == "anchored" and v.nav_status != 1:
                continue
            if status == "moored" and v.nav_status != 5:
                continue
            if status == "underway" and (v.nav_status in (1, 5) or sog < 0.5):
                continue
            if fset is not None and v.mmsi not in fset:
                continue
            rows.append(v)

        if p.get("sort") == "speed_desc":
            rows.sort(key=lambda v: -(v.sog or 0))
        elif p.get("sort") == "speed_asc":
            rows.sort(key=lambda v: v.sog or 0)

        limit = min(int(p.get("limit") or 20), 50)
        out = [
            _compact(
                {
                    "mmsi": v.mmsi,
                    "name": v.name,
                    "flag": flag_for_mmsi(v.mmsi),
                    "type": group_for(v.ship_type),
                    "sog_kn": _round(v.sog, 1),
                    "status": NAV_STATUS.get(v.nav_status or -1),
                    "lat": _round(v.lat),
                    "lon": _round(v.lon),
                    "destination": (v.destination or "").strip() or None,
                }
            )
            for v in rows[:limit]
        ]
        return {"total_matching": len(rows), "returned": len(out), "vessels": out}

    async def _vessel_dossier(self, p: dict) -> dict:
        d = await self._dossier(int(p["mmsi"]))
        return d if d is not None else {"error": "vessel not currently tracked"}

    async def _recent_events(self, p: dict) -> dict:
        evs = self._events(float(p.get("hours") or 24))
        out = [
            _compact(
                {
                    "kind": e.get("kind"),
                    "title": e.get("title"),
                    "vessel": e.get("name") or e.get("mmsi"),
                    "mmsi": e.get("mmsi"),
                    "counterpart": e.get("name_b") or e.get("mmsi_b"),
                    "mmsi_b": e.get("mmsi_b"),
                    "lat": _round(e.get("lat")),
                    "lon": _round(e.get("lon")),
                    "ago_min": round((datetime.datetime.now().timestamp() - e["ts"]) / 60),
                    "detail": e.get("detail"),
                }
            )
            for e in evs
        ]
        return {"count": len(out), "events": out}

    async def _weather_at(self, p: dict) -> dict:
        c = await self._conditions(float(p["lat"]), float(p["lon"]))
        return c or {"error": "no forecast available"}

    async def _find_cameras(self, p: dict) -> dict:
        cams = await self._cameras()  # type: ignore[misc]
        q = (p.get("query") or "").strip().lower()
        out = [
            c for c in cams
            if c.get("available") and (not q or q in (c.get("name") or "").lower())
        ]
        lat, lon = p.get("lat"), p.get("lon")
        if lat is not None and lon is not None:
            import math

            # Scale longitude by cos(lat) so "nearest" is honest — a degree of
            # longitude is only ~60% of a degree of latitude at London.
            k = math.cos(math.radians(lat))
            out.sort(
                key=lambda c: (c["lat"] - lat) ** 2 + ((c["lon"] - lon) * k) ** 2
            )
        limit = max(1, min(int(p.get("limit") or 8), 15))
        return {
            "total_matching": len(out),
            "cameras": [
                {"id": c["id"], "name": c["name"], "lat": c["lat"], "lon": c["lon"], "view": c["view"]}
                for c in out[:limit]
            ],
        }

    @staticmethod
    def _train_row(t) -> dict:
        first = t.stops[0] if t.stops else None
        dep = (
            datetime.datetime.fromtimestamp(first.t).strftime("%H:%M") if first else "?"
        )
        return _compact({
            "id": t.id,
            "service": f"{dep} {t.origin} to {t.destination}",
            "next": t.next_name,
            "delay_min": round(t.delay_min or 0),
            "lat": _round(t.lat), "lon": _round(t.lon),
        })

    async def _query_trains(self, p: dict) -> dict:
        trains = await self._trains()  # type: ignore[misc]
        to = (p.get("to") or "").lower()
        frm = (p.get("from") or "").lower()
        min_delay = float(p.get("min_delay_min") or 0)
        out = [
            t for t in trains
            if (not to or to in (t.destination or "").lower())
            and (not frm or frm in (t.origin or "").lower())
            and (t.delay_min or 0) >= min_delay
        ]
        reverse = p.get("sort") != "delay_asc"
        out.sort(key=lambda t: t.delay_min or 0, reverse=reverse)
        limit = max(1, min(int(p.get("limit") or 10), 25))
        return {"total_matching": len(out), "trains": [self._train_row(t) for t in out[:limit]]}

    async def _train_dossier(self, p: dict) -> dict:
        trains = await self._trains()  # type: ignore[misc]
        t = next((x for x in trains if x.id == str(p.get("id"))), None)
        if t is None:
            return {"error": "unknown or no-longer-live service id"}
        row = self._train_row(t)
        row["speed_kn"] = t.speed_kn
        row["calling_points"] = [
            {"station": s0.name,
             "time": datetime.datetime.fromtimestamp(s0.t).strftime("%H:%M")}
            for s0 in t.stops
        ]
        return {"train": row}

    async def _station_board(self, p: dict) -> dict:
        from .rail.board import build_board

        trains = await self._trains()  # type: ignore[misc]
        board = build_board(trains, p.get("station") or "", int(p.get("limit") or 10))
        if board.get("error"):
            return board
        return {
            "station_matched": board.get("station"),
            "total_upcoming": board.get("total_upcoming"),
            "services": [
                _compact({
                    "time": datetime.datetime.fromtimestamp(sv["t"]).strftime("%H:%M"),
                    "id": sv["id"],
                    "from": sv["from"],
                    "to": sv["to"],
                    "delay_min": sv["delay_min"],
                })
                for sv in board.get("services", [])
            ],
        }

    async def _run_tool(self, name: str, p: dict) -> Any:
        if name == "query_vessels":
            return await self._query_vessels(p)
        if name == "vessel_dossier":
            return await self._vessel_dossier(p)
        if name == "recent_events":
            return await self._recent_events(p)
        if name == "weather_at":
            return await self._weather_at(p)
        if name == "query_trains" and self._trains is not None:
            return await self._query_trains(p)
        if name == "train_dossier" and self._trains is not None:
            return await self._train_dossier(p)
        if name == "station_board" and self._trains is not None:
            return await self._station_board(p)
        if name == "find_cameras" and self._cameras:
            return await self._find_cameras(p)
        if name == "view_camera" and self._camera_view:
            return await self._camera_view(str(p["camera_id"]))
        if name == "show_on_map":
            return {"ok": True}
        return {"error": f"unknown tool {name}"}

    @staticmethod
    def _trace_label(name: str, p: dict, result: Any) -> str:
        """Human one-liner for the UI's tool-trace chips."""
        if name == "query_vessels":
            bits = [p.get("flag"), p.get("type"), (p.get("region") or "").replace("_", " ")]
            what = " ".join(b for b in bits if b) or "vessels"
            n = result.get("total_matching", "?") if isinstance(result, dict) else "?"
            return f"Searched {what} · {n} match{'es' if n != 1 else ''}"
        if name == "vessel_dossier":
            v = (result or {}).get("vessel", {}) if isinstance(result, dict) else {}
            return f"Pulled dossier · {v.get('name') or p.get('mmsi')}"
        if name == "recent_events":
            n = result.get("count", "?") if isinstance(result, dict) else "?"
            return f"Checked recent risk events · {n} found"
        if name == "weather_at":
            return "Checked sea conditions"
        if name == "query_trains":
            n = result.get("total_matching", "?") if isinstance(result, dict) else "?"
            return f"Searched live trains · {n} match{'es' if n != 1 else ''}"
        if name == "train_dossier":
            tr = (result or {}).get("train", {}) if isinstance(result, dict) else {}
            return f"Pulled service · {tr.get('service') or p.get('id')}"
        if name == "station_board":
            st = result.get("station_matched") if isinstance(result, dict) else None
            n = result.get("total_upcoming", "?") if isinstance(result, dict) else "?"
            return f"Departure board · {st or p.get('station')} · {n} services"
        if name == "find_cameras":
            n = result.get("total_matching", "?") if isinstance(result, dict) else "?"
            return f"Found {n} traffic camera{'s' if n != 1 else ''}"
        if name == "view_camera":
            cam = (result or {}).get("camera", {}) if isinstance(result, dict) else {}
            an = (result or {}).get("analysis", {}) if isinstance(result, dict) else {}
            where = cam.get("name") or "camera"
            cong = an.get("congestion")
            return f"Viewed {where}" + (f" · {cong}" if cong else "")
        if name == "show_on_map":
            n = len(p.get("mmsis") or [])
            return f"Highlighted {n} vessel{'s' if n != 1 else ''} on the map" if n else "Moved the map"
        return name

    # --- the loop -----------------------------------------------------------

    async def stream(self, question: str, history: list[dict]) -> AsyncIterator[dict]:
        """Run the tool loop on the configured provider; yield SSE event dicts.
        Event types: delta, tool, map, discard, final, error."""
        if self._provider == "gemini":
            async for ev in self._stream_gemini(question, history):
                yield ev
        else:
            async for ev in self._stream_anthropic(question, history):
                yield ev

    async def _stream_gemini(self, question: str, history: list[dict]) -> AsyncIterator[dict]:
        from google.genai import types

        from .briefing import _gemini_error
        from .llm_gemini import make_tools, stream_turn, TurnResult, cost as gcost

        if not self._gemini_key:
            yield {"type": "error", "message": "Gemini API not configured — set GEMINI_API_KEY"}
            return

        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        contents = [
            types.Content(
                role="model" if m["role"] == "assistant" else "user",
                parts=[types.Part(text=m["content"])],
            )
            for m in history[-MAX_HISTORY:]
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        contents.append(
            types.Content(role="user", parts=[types.Part(text=f"[time now: {now}]\n{question}")])
        )
        tools = make_tools(self._tools())

        cost = 0.0
        cited: set[int] = set()
        known: set[int] = set()  # MMSIs actually retrieved → groundable highlights
        try:
            for _ in range(MAX_ROUNDS):
                calls: list = []
                turn_content = None
                usage = None
                async for ev in stream_turn(
                    self._gemini_key, self._gemini_model, SYSTEM_PROMPT, contents, tools,
                    max_output_tokens=2000, thinking_budget=0,
                ):
                    if isinstance(ev, TurnResult):
                        turn_content, calls, usage = ev.content, ev.function_calls, ev.usage
                    elif ev.get("text"):
                        yield {"type": "delta", "text": ev["text"]}
                cost += gcost(self._gemini_model, usage)
                if turn_content is not None:
                    contents.append(turn_content)
                if not calls:
                    break
                yield {"type": "discard"}  # tool-round narration → drop it

                # Run the data tools before any show_on_map in the same round so
                # the map can only highlight MMSIs that were actually retrieved.
                ordered = sorted(calls, key=lambda fc: fc.name == "show_on_map")
                resp_parts = []
                for fc in ordered:
                    args = dict(fc.args) if fc.args else {}
                    if fc.name == "show_on_map":
                        wanted = [int(m) for m in (args.get("mmsis") or [])]
                        mmsis = [m for m in wanted if m in known]
                        out = {"ok": True, "highlighted": mmsis, "ignored_unknown": [m for m in wanted if m not in known]}
                        yield {"type": "tool", "label": self._trace_label(fc.name, {"mmsis": mmsis}, out)}
                        cited.update(mmsis)
                        directive = _compact(
                            {"mmsis": mmsis, "lat": args.get("lat"), "lon": args.get("lon"), "zoom": args.get("zoom")}
                        )
                        if directive:
                            yield {"type": "map", **directive}
                    else:
                        out = await self._run_tool(fc.name, args)
                        known |= _mmsis_in(out)
                        yield {"type": "tool", "label": self._trace_label(fc.name, args, out)}
                        peek = _camera_peek(fc.name, out)
                        if peek:
                            yield peek
                    resp_parts.append(
                        types.Part.from_function_response(name=fc.name, response={"result": out})
                    )
                contents.append(types.Content(role="tool", parts=resp_parts))
            yield {"type": "final", "cost_usd": round(cost, 4), "mmsis": sorted(cited)}
        except Exception as exc:  # noqa: BLE001
            log.exception("analyst (gemini) failed")
            yield {"type": "error", "message": _gemini_error(exc)}

    async def _stream_anthropic(self, question: str, history: list[dict]) -> AsyncIterator[dict]:
        """Run the tool loop; yield SSE-able event dicts."""
        try:
            client = self._ensure_client()
        except Exception:
            yield {"type": "error", "message": "Claude API not configured — set ANTHROPIC_API_KEY"}
            return

        now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        msgs: list[dict] = [
            {"role": m["role"], "content": m["content"]}
            for m in history[-MAX_HISTORY:]
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        msgs.append({"role": "user", "content": f"[time now: {now}]\n{question}"})

        cost = 0.0
        cited: set[int] = set()
        try:
            for _ in range(MAX_ROUNDS):
                async with client.with_options(timeout=90).messages.stream(
                    model=self._model,
                    max_tokens=1500,
                    system=[
                        {
                            "type": "text",
                            "text": SYSTEM_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        }
                    ],
                    tools=self._tools(),
                    messages=msgs,
                ) as s:
                    async for ev in s:
                        if (
                            ev.type == "content_block_delta"
                            and getattr(ev.delta, "type", "") == "text_delta"
                        ):
                            yield {"type": "delta", "text": ev.delta.text}
                    final = await s.get_final_message()

                cost += _call_cost(self._model, final.usage)
                msgs.append({"role": "assistant", "content": final.content})
                tool_uses = [b for b in final.content if b.type == "tool_use"]
                if not tool_uses:
                    break
                # This round was a tool step — any text it streamed was the model
                # narrating ("let me check…"). Tell the client to drop it so only
                # the final answer survives; the tool-trace chips show progress.
                yield {"type": "discard"}

                results = []
                for tu in tool_uses:
                    out = await self._run_tool(tu.name, tu.input or {})
                    yield {"type": "tool", "label": self._trace_label(tu.name, tu.input or {}, out)}
                    peek = _camera_peek(tu.name, out)
                    if peek:
                        yield peek
                    if tu.name == "show_on_map":
                        p = tu.input or {}
                        mmsis = [int(m) for m in (p.get("mmsis") or [])]
                        cited.update(mmsis)
                        directive = _compact(
                            {
                                "mmsis": mmsis,
                                "lat": p.get("lat"),
                                "lon": p.get("lon"),
                                "zoom": p.get("zoom"),
                            }
                        )
                        yield {"type": "map", **directive}
                    results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tu.id,
                            "content": json.dumps(out, ensure_ascii=False),
                        }
                    )
                msgs.append({"role": "user", "content": results})
            yield {"type": "final", "cost_usd": round(cost, 4), "mmsis": sorted(cited)}
        except anthropic.APIError as exc:
            log.warning("analyst API error: %s", exc)
            yield {"type": "error", "message": _friendly_error(exc)}
        except Exception as exc:  # noqa: BLE001
            log.exception("analyst failed")
            yield {"type": "error", "message": f"analyst error: {exc}"}
