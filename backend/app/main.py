"""FastAPI application entrypoint.

Wires together the three long-lived pieces inside a lifespan context:
  1. VesselStore   — shared state (in-memory or Redis)
  2. AISClient     — the single upstream WebSocket
  3. Broadcaster   — batched fan-out to browser clients
plus a periodic sweeper that evicts vessels that have gone silent.

Routes:
  GET  /healthz        liveness + basic status
  GET  /api/meta       config the frontend needs (bbox, ship-type legend, …)
  GET  /api/snapshot   all current vessels (REST warm-start)
  GET  /api/vessel/{mmsi}/trail   recent track for one vessel
  WS   /ws             live vessel stream
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .flags import get_flags
from .geofence.evaluator import GeofenceEvaluator
from .geofence.models import Geofence
from .geofence.store import GeofenceStore
from .ownership import OwnershipStore
from .registry import VesselRegistry
from .briefing import BriefingService, BriefingUnavailable
from .density import DensityRecorder
from .risk import RiskEngine
from .risk_score import compute_risk
from .sanctions import SanctionsStore
from .weather import WeatherSource
from .weather_point import WindyPoint
from .ship_types import SHIP_TYPE_GROUPS
from .sources import create_sources
from .store import create_store
from .ws.broadcaster import Broadcaster

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("main")


async def _stale_sweeper(app: FastAPI) -> None:
    """Background loop evicting vessels that have stopped transmitting."""
    settings = app.state.settings
    while True:
        await asyncio.sleep(max(settings.vessel_ttl_sec // 4, 30))
        try:
            removed = await app.state.store.evict_stale(settings.vessel_ttl_sec)
            if removed:
                log.info("evicted %d stale vessels", removed)
        except Exception as exc:  # noqa: BLE001
            log.warning("stale sweep failed: %s", exc)


async def _geofence_loop(app: FastAPI) -> None:
    """Periodic geofence evaluation → enter/exit/dwell events over the WS."""
    interval = app.state.settings.geofence_eval_sec
    while True:
        await asyncio.sleep(interval)
        try:
            await app.state.evaluator.evaluate(emit=True)
        except Exception as exc:  # noqa: BLE001
            log.warning("geofence evaluation failed: %s", exc)


async def _weather_loop(app: FastAPI) -> None:
    """Refresh the GFS wind field on startup and every few hours."""
    interval = app.state.settings.weather_refresh_sec
    while True:
        try:
            await app.state.weather.refresh()
        except Exception as exc:  # noqa: BLE001
            log.warning("weather refresh failed: %s", exc)
        await asyncio.sleep(interval)


async def _density_loop(app: FastAPI) -> None:
    """Periodically bin the live fleet into the historical density store."""
    interval = app.state.settings.density_sample_sec
    while True:
        await asyncio.sleep(interval)
        try:
            snap = await app.state.store.snapshot()
            await asyncio.to_thread(app.state.density.sample, snap)
        except Exception as exc:  # noqa: BLE001
            log.warning("density sample failed: %s", exc)


async def _risk_loop(app: FastAPI) -> None:
    """Periodic behavioral risk detection (gated by the risk_engine flag)."""
    interval = app.state.settings.risk_eval_sec
    while True:
        await asyncio.sleep(interval)
        if not get_flags().get("risk_engine"):
            continue
        try:
            await app.state.risk_engine.evaluate()
        except Exception as exc:  # noqa: BLE001
            log.warning("risk evaluation failed: %s", exc)


async def _bootstrap_sanctions(app: FastAPI) -> None:
    """Download OFAC SDN sanctions onto the volume when missing (Fly first boot)."""
    settings = app.state.settings
    path = settings.sanctions_path
    if os.path.isfile(path):
        return
    log.info("sanctions missing at %s — bootstrapping from OpenSanctions", path)
    try:
        from scripts.import_sanctions import DEFAULT_URL, build_sanctions_file

        await asyncio.to_thread(build_sanctions_file, DEFAULT_URL, path)
        app.state.sanctions.reload()
        log.info("sanctions bootstrap complete")
    except Exception as exc:  # noqa: BLE001
        log.warning("sanctions bootstrap failed: %s", exc)


async def _registry_flush(app: FastAPI) -> None:
    """Periodically persist newly-learned vessel identities to SQLite."""
    while True:
        await asyncio.sleep(15)
        try:
            n = app.state.registry.flush()
            if n:
                log.info("registry flushed %d vessels", n)
        except Exception as exc:  # noqa: BLE001
            log.warning("registry flush failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.settings = settings

    store = create_store()
    await store.start()
    app.state.store = store

    broadcaster = Broadcaster(store, settings.broadcast_hz)
    broadcaster.start()
    app.state.broadcaster = broadcaster

    # Persistent vessel registry — backfills static details onto every message.
    registry = VesselRegistry(settings.registry_path) if settings.enable_registry else None
    if registry is not None:
        registry.open()
    app.state.registry = registry

    # Lloyd's ownership store (read-only enrichment).
    ownership = OwnershipStore(settings.ownership_path)
    ownership.open()
    app.state.ownership = ownership

    # Sanctions screening.
    sanctions = SanctionsStore(settings.sanctions_path)
    sanctions.open()
    app.state.sanctions = sanctions

    # Data sources — each owns one upstream connection, all feed the same store.
    sources = create_sources(store, settings, registry)
    for src in sources:
        src.start()
    app.state.sources = sources

    # Geofences: file-backed store + authoritative evaluator.
    geofence_store = GeofenceStore(settings.geofence_path)
    app.state.geofence_store = geofence_store
    evaluator = GeofenceEvaluator(store, broadcaster)
    evaluator.set_fences(geofence_store.list())
    await evaluator.evaluate(emit=False)  # seed membership silently
    app.state.evaluator = evaluator

    # Windy point forecast (per-vessel conditions).
    app.state.windy = WindyPoint(settings.windy_key)

    # GFS wind field (particle overlay).
    app.state.weather = (
        WeatherSource(settings.weather_bbox, settings.weather_dir)
        if settings.weather_enabled
        else None
    )

    # Historical traffic-density recorder.
    density = DensityRecorder(
        settings.density_path, settings.density_res, settings.density_bucket_sec
    )
    density.open()
    app.state.density = density

    # Behavioral risk engine (rendezvous / spoof) + sanctions-aware flagging.
    app.state.risk_engine = RiskEngine(store, broadcaster, settings, sanctions)

    # LLM risk briefing (lazy client — only hits Claude on demand).
    app.state.briefing = BriefingService(
        settings.briefing_model,
        settings.anthropic_api_key,
        settings.briefing_web_search,
        settings.briefing_search_model,
        settings.tavily_api_key,
    )

    sweeper = asyncio.create_task(_stale_sweeper(app), name="stale-sweeper")
    geofence_task = asyncio.create_task(_geofence_loop(app), name="geofence-eval")
    risk_task = asyncio.create_task(_risk_loop(app), name="risk-eval")
    density_task = asyncio.create_task(_density_loop(app), name="density-sample")
    weather_task = (
        asyncio.create_task(_weather_loop(app), name="weather-refresh")
        if app.state.weather is not None
        else None
    )
    registry_task = (
        asyncio.create_task(_registry_flush(app), name="registry-flush")
        if registry is not None
        else None
    )
    sanctions_task = asyncio.create_task(_bootstrap_sanctions(app), name="sanctions-bootstrap")

    log.info(
        "ready — store=%s, sources=%s",
        "redis" if settings.use_redis else "memory",
        [s.name for s in sources],
    )
    try:
        yield
    finally:
        sweeper.cancel()
        geofence_task.cancel()
        risk_task.cancel()
        density_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper
        with contextlib.suppress(asyncio.CancelledError):
            await geofence_task
        with contextlib.suppress(asyncio.CancelledError):
            await risk_task
        with contextlib.suppress(asyncio.CancelledError):
            await density_task
        if weather_task is not None:
            weather_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await weather_task
        density.close()
        if registry_task is not None:
            registry_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await registry_task
        sanctions_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sanctions_task
        for src in sources:
            await src.stop()
        if registry is not None:
            registry.close()
        ownership.close()
        await broadcaster.stop()
        await store.close()


app = FastAPI(title="AIS Tracker API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _source_status(src) -> dict:
    return {
        "name": src.name,
        "connected": src.connected,
        "configured": src.configured,
        "messages_seen": src.messages_seen,
    }


@app.get("/healthz")
async def healthz():
    settings = app.state.settings
    return {
        "status": "ok",
        "sources": [_source_status(s) for s in app.state.sources],
        "vessels": await app.state.store.count(),
        "clients": app.state.broadcaster.client_count,
        "registry": app.state.registry.count() if app.state.registry else 0,
        "data": {
            "aisstream_key_set": bool(settings.aisstream_api_key),
            "sanctions_loaded": app.state.sanctions.loaded,
            "ownership_loaded": app.state.ownership.available,
            "briefing_ready": bool(settings.anthropic_api_key),
        },
    }


@app.get("/api/flags")
async def feature_flags():
    return {"flags": get_flags()}


@app.get("/api/sources")
async def list_sources():
    return {"sources": [_source_status(s) for s in app.state.sources]}


@app.get("/api/meta")
async def meta():
    settings = app.state.settings
    return {
        "bbox": settings.ais_bbox,
        "ship_type_groups": SHIP_TYPE_GROUPS,
        "trail_len": settings.trail_len,
    }


@app.get("/api/snapshot")
async def snapshot():
    vessels = await app.state.store.snapshot()
    return {"vessels": [v.model_dump() for v in vessels]}


@app.get("/api/vessel/{mmsi}/trail")
async def vessel_trail(mmsi: int):
    return {"mmsi": mmsi, "trail": await app.state.store.trail(mmsi)}


@app.get("/api/density")
async def density_buckets():
    """Available density time-buckets (epoch-second starts) for the timeline."""
    if not get_flags().get("density_timeline"):
        return {"buckets": [], "bucket_sec": app.state.settings.density_bucket_sec}
    return {
        "buckets": app.state.density.buckets(),
        "bucket_sec": app.state.settings.density_bucket_sec,
    }


@app.get("/api/density/{bucket}")
async def density_bucket(bucket: int):
    """Density cells (lat/lon/count) for one bucket."""
    return {"points": app.state.density.points(bucket)}


@app.get("/api/vessel/{mmsi}/conditions")
async def vessel_conditions(mmsi: int):
    """Windy point forecast (wind/waves/temp) at a vessel's current position."""
    if not get_flags().get("weather"):
        return {"conditions": None}
    v = await app.state.store.get(mmsi)
    if v is None or v.lat is None or v.lon is None:
        return {"conditions": None}
    return {"conditions": await app.state.windy.forecast(v.lat, v.lon)}


@app.get("/api/weather/wind")
async def weather_wind():
    """Metadata for the current GFS wind field (bounds, unscale, cycle)."""
    src = app.state.weather
    if not get_flags().get("weather") or src is None or src.meta is None:
        return {"available": False}
    return {"available": True, **src.meta}


@app.get("/api/weather/wind.png")
async def weather_wind_png():
    """The encoded U/V velocity image for the particle layer."""
    src = app.state.weather
    path = src.png_path if src is not None else None
    if not path:
        raise HTTPException(status_code=404, detail="no wind field yet")
    return FileResponse(path, media_type="image/png")


async def _assemble_risk_inputs(mmsi: int):
    """Shared evidence inputs for the risk score and the LLM briefing.

    Returns (vessel, ownership, sanctioned_vessel, owner_hits, recent) or None
    if the vessel isn't currently tracked.
    """
    v = await app.state.store.get(mmsi)
    if v is None:
        return None
    own = app.state.ownership.lookup(mmsi=mmsi, imo=v.imo, callsign=v.callsign)
    sanc = app.state.sanctions
    sanctioned_vessel = sanc.screen_vessel(
        imo=v.imo, mmsi=mmsi, name=v.name, callsign=v.callsign
    )
    owner_hits = []
    if own:
        for role, key in (
            ("Registered owner", "reg_owner"),
            ("Operator", "operator"),
            ("Beneficial owner", "beneficial_owner"),
            ("Manager", "manager"),
        ):
            if sanc.screen_entity(own.get(key)):
                owner_hits.append((role, own[key]))
    recent = app.state.risk_engine.recent_for(mmsi)
    return v, own, sanctioned_vessel, owner_hits, recent


@app.get("/api/vessel/{mmsi}/risk")
async def vessel_risk(mmsi: int):
    """Composite risk assessment: sanctions + ownership + behavioral signals."""
    if not get_flags().get("risk_engine"):
        return {"risk": None}
    inputs = await _assemble_risk_inputs(mmsi)
    if inputs is None:
        return {"risk": compute_risk(None, None, None, [], [])}
    return {"risk": compute_risk(*inputs)}


@app.post("/api/vessel/{mmsi}/briefing")
async def vessel_briefing(mmsi: int, web: bool = False):
    """Claude-generated, cited risk briefing from the assembled evidence pack.
    Pass ?web=true to additionally search the open web (slower, costs more)."""
    if not get_flags().get("llm_briefing"):
        raise HTTPException(status_code=404, detail="briefing disabled")
    inputs = await _assemble_risk_inputs(mmsi)
    if inputs is None:
        raise HTTPException(status_code=404, detail="vessel not tracked")
    try:
        return await app.state.briefing.generate(*inputs, web_search=web)
    except BriefingUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/vessel/{mmsi}/ownership")
async def vessel_ownership(mmsi: int):
    """Lloyd's ownership & particulars for a vessel, joined by IMO→MMSI→callsign."""
    if not get_flags().get("ownership"):
        return {"ownership": None}
    v = await app.state.store.get(mmsi)
    rec = app.state.ownership.lookup(
        mmsi=mmsi,
        imo=v.imo if v else None,
        callsign=v.callsign if v else None,
    )
    return {"ownership": rec}


@app.get("/api/vessel/{mmsi}/network")
async def vessel_network(mmsi: int):
    """Ownership network: vessel → companies → sister vessels, sanctions-flagged."""
    if not get_flags().get("ownership"):
        return {"network": None}
    v = await app.state.store.get(mmsi)
    rec = app.state.ownership.lookup(
        mmsi=mmsi, imo=v.imo if v else None, callsign=v.callsign if v else None
    )
    if rec is None:
        return {"network": None}
    return {"network": app.state.ownership.network(rec, app.state.sanctions)}


@app.get("/api/geofences")
async def list_geofences():
    store: GeofenceStore = app.state.geofence_store
    return {
        "geofences": [f.model_dump() for f in store.list()],
        "counts": app.state.evaluator.counts(),
    }


@app.put("/api/geofences")
async def replace_geofences(fences: list[Geofence]):
    """Bulk-replace the geofence set (the frontend syncs its full list)."""
    store: GeofenceStore = app.state.geofence_store
    store.replace_all(fences)
    app.state.evaluator.set_fences(store.list())
    # Seed membership for the new set without firing a burst of stale events.
    await app.state.evaluator.evaluate(emit=False)
    return {"ok": True, "count": len(fences)}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    broadcaster: Broadcaster = app.state.broadcaster
    await broadcaster.connect(ws)
    try:
        # We don't expect client->server messages, but keep the socket alive
        # and drain anything the client sends (e.g. ping/keepalive).
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.disconnect(ws)


# Serve the built frontend (single-app deploy). Mounted LAST so /api, /ws,
# /healthz and the docs win; everything else falls through to the SPA. Absent in
# local dev (the Vite dev server serves the UI) — guarded so the API still runs.
_static_dir = os.environ.get("STATIC_DIR", "static")
if os.path.isdir(_static_dir):
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="frontend")
    log.info("serving frontend from %s", _static_dir)
