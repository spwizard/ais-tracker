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
import time
from contextlib import asynccontextmanager

import anthropic
import httpx
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .alerts import AlertStore
from .analyst import AnalystService
from .config import get_settings
from .flags import get_flags
from .geofence.evaluator import GeofenceEvaluator
from .geofence.models import Geofence
from .geofence.store import GeofenceStore
from .ownership import OwnershipStore
from .registry import VesselRegistry
from .briefing import BriefingService, BriefingUnavailable
from .density import DensityRecorder
from .history import TrackHistory
from .regions import search_regions
from .risk import RiskEngine
from .risk_score import compute_risk
from .sanctions import SanctionsStore
from .weather import WeatherSource, WaveSource
from .weather_point import WindyPoint
from .ship_types import SHIP_TYPE_GROUPS
from .air.enrich import AircraftEnricher
from .land.cameras import CameraCatalog
from .land.tube import TubeNetwork
from .land.vision import CameraAnalyst, VisionUnavailable
from .sources import AdsbLolSource, BodsSource, create_sources
from .sources.darwin import DarwinSource
from .sources.rail_sim import SimRailSource
from .sources.tube import TubeSource
from .sources.tfl_road import TflRoadSource
from .incidents.news import NewsSource
from .incidents.social import SocialSource
from .store import create_store
from .store.aircraft import AircraftStore
from .store.bus import BusStore
from .store.train import TrainStore
from .store.tube import TubeStore
from .store.incident import IncidentStore
from .ws.broadcaster import Broadcaster

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("main")

# Shared pooled client for the Google 3D Tiles proxy (high request volume).
_http = httpx.AsyncClient(
    timeout=httpx.Timeout(20.0),
    limits=httpx.Limits(max_connections=64, max_keepalive_connections=16),
)

GOOGLE_3D_HOST = "https://tile.googleapis.com"


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
    """Refresh the GFS wind + wave fields on startup and every few hours."""
    interval = app.state.settings.weather_refresh_sec
    while True:
        try:
            await app.state.weather.refresh()
        except Exception as exc:  # noqa: BLE001
            log.warning("weather refresh failed: %s", exc)
        if app.state.waves is not None:
            try:
                await app.state.waves.refresh()
            except Exception as exc:  # noqa: BLE001
                log.warning("wave refresh failed: %s", exc)
        await asyncio.sleep(interval)


async def _rate_loop(app: FastAPI) -> None:
    """Refresh each source's messages/sec on a fixed 5s cadence for the health UI."""
    while True:
        await asyncio.sleep(5)
        now = time.time()
        for src in app.state.sources:
            src.sample_rate(now)


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


async def _history_loop(app: FastAPI) -> None:
    """Periodically append the live fleet to the position-history store."""
    interval = app.state.settings.history_sample_sec
    while True:
        await asyncio.sleep(interval)
        try:
            snap = await app.state.store.snapshot()
            await asyncio.to_thread(app.state.history.sample, snap)
        except Exception as exc:  # noqa: BLE001
            log.warning("history sample failed: %s", exc)


async def _heli_loop(app: FastAPI) -> None:
    """Inference eyes: helicopter circling + bus-swarm road holds."""
    if app.state.incident_store is None:
        return
    heli = app.state.heli_detector
    swarm = app.state.swarm_detector
    while True:
        await asyncio.sleep(10)
        now = time.time()
        try:
            if heli is not None and app.state.air_store is not None:
                incs = heli.update(await app.state.air_store.snapshot(), now)
                await app.state.incident_store.replace_source("heli", incs)
            if swarm is not None and app.state.bus_store is not None:
                incs = swarm.update(await app.state.bus_store.snapshot(), now)
                await app.state.incident_store.replace_source("bus-swarm", incs)
            if app.state.incident_verifier is not None:
                await app.state.incident_verifier.run(app.state.incident_store, now)
        except Exception as exc:  # noqa: BLE001
            log.warning("inference detection failed: %s", exc)


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

    # Aircraft (ADS-B) domain — a parallel in-memory store, fanned out on the
    # same socket. None when the air feed is disabled.
    air_store = AircraftStore() if settings.enable_air else None
    if air_store is not None:
        await air_store.start()
    app.state.air_store = air_store
    # Land domain: London buses (BODS SIRI-VM), fanned out on the same socket.
    bus_store = BusStore() if settings.enable_bus else None
    if bus_store is not None:
        await bus_store.start()
    app.state.bus_store = bus_store
    # Rail domain: GB trains, Tier-1 interpolated positions (sim or Darwin).
    train_store = TrainStore() if settings.enable_train else None
    if train_store is not None:
        await train_store.start()
    app.state.train_store = train_store
    app.state.pulse_history = __import__("collections").deque(maxlen=60)  # (ts, on_time_pct)
    app.state.pulse_narrative = {"text": None, "ts": 0.0}
    # Land domain: London Underground (TfL) — inferred live positions.
    tube_store = TubeStore() if settings.enable_tube else None
    app.state.tube_store = tube_store
    app.state.tube_network = TubeNetwork(settings.tfl_app_key) if settings.enable_tube else None
    # Incident spine (Argus): TfL road disruptions now, more eyes later.
    incident_store = IncidentStore() if settings.enable_incidents else None
    app.state.incident_store = incident_store
    from .incidents.helicopter import HelicopterDetector
    from .incidents.bus_swarm import BusSwarmDetector
    _inc = incident_store is not None
    app.state.heli_detector = HelicopterDetector() if (_inc and settings.enable_air) else None
    app.state.swarm_detector = (
        BusSwarmDetector() if (_inc and settings.enable_bus and settings.enable_bus_swarm) else None
    )
    from .incidents.verify import IncidentVerifier
    app.state.incident_verifier = None  # set after camera analyst/catalog exist
    # Aircraft enrichment (registration / operator / route / photo) via adsbdb.
    app.state.air_enricher = AircraftEnricher() if settings.enable_air else None
    # Land domain: London traffic cameras (TfL JamCams), lazily fetched + cached.
    app.state.cameras = (
        CameraCatalog(settings.tfl_jamcam_url, settings.tfl_app_key)
        if settings.enable_cameras
        else None
    )
    # Claude-vision "analyze scene" for cameras (aggregate counts + congestion).
    app.state.camera_analyst = (
        CameraAnalyst(settings.camera_vision_model, settings.anthropic_api_key)
        if settings.enable_cameras
        else None
    )
    if incident_store is not None and app.state.camera_analyst is not None:
        app.state.incident_verifier = IncidentVerifier(app.state.camera_analyst, app.state.cameras)

    broadcaster = Broadcaster(
        store, settings.broadcast_hz,
        air_store=air_store, bus_store=bus_store, train_store=train_store,
        tube_store=tube_store, incident_store=incident_store,
    )
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
    # Aircraft feed writes into the air store but shares the same health/rate/
    # supervisor rails, so it lives alongside the vessel sources.
    if air_store is not None:
        sources.append(AdsbLolSource(air_store, settings))
    if bus_store is not None:
        sources.append(BodsSource(bus_store, settings))
    if train_store is not None:
        # Sim feed for the Tier-1 prototype; Darwin takes over once configured.
        if settings.darwin_bootstrap and settings.darwin_user:
            sources.append(DarwinSource(train_store, settings))
        elif settings.train_sim:
            sources.append(SimRailSource(train_store, settings))
    if tube_store is not None:
        sources.append(TubeSource(tube_store, app.state.tube_network, settings))
    if incident_store is not None:
        app.state.tfl_road = TflRoadSource(incident_store, settings)
        sources.append(app.state.tfl_road)
        if settings.enable_news and settings.anthropic_api_key:
            sources.append(NewsSource(incident_store, settings))
        if settings.enable_social and settings.anthropic_api_key:
            sources.append(SocialSource(incident_store, settings))
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

    # GFS wind field (particle overlay) + GFS-Wave sea-state field, each
    # encoding several forecast hours for the time scrubber.
    fhours = settings.weather_forecast_hours
    app.state.weather = (
        WeatherSource(settings.weather_bbox, settings.weather_dir, fhours)
        if settings.weather_enabled
        else None
    )
    app.state.waves = (
        WaveSource(settings.weather_bbox, settings.weather_dir, fhours)
        if settings.weather_enabled
        else None
    )

    # Historical traffic-density recorder.
    density = DensityRecorder(
        settings.density_path, settings.density_res, settings.density_bucket_sec
    )
    density.open()
    app.state.density = density

    # Historical vessel-position store (powers the replay/scrubbing timeline).
    history = TrackHistory(settings.history_path, settings.history_window_sec)
    history.open()
    app.state.history = history

    # Persistent alert history (risk + geofence events), fed from the broadcaster.
    alerts = AlertStore(settings.alerts_path)
    alerts.open()
    app.state.alerts = alerts
    broadcaster.alert_sink = alerts.record

    # Behavioral risk engine (rendezvous / spoof) + sanctions-aware flagging.
    app.state.risk_engine = RiskEngine(store, broadcaster, settings, sanctions)

    # LLM risk briefing (lazy client — only hits the provider on demand).
    app.state.briefing = BriefingService(
        settings.briefing_model,
        settings.anthropic_api_key,
        settings.briefing_web_search,
        settings.briefing_search_model,
        settings.tavily_api_key,
        provider=settings.llm_provider,
        gemini_key=settings.gemini_api_key,
        gemini_model=settings.gemini_briefing_model,
        gemini_search_model=settings.gemini_search_model,
    )

    # Analyst eyes: look through a TfL camera — vision analysis of its snapshot.
    async def _analyst_camera_view(cam_id: str) -> dict:
        cams = await app.state.cameras.list()
        cam = next((c for c in cams if c["id"] == cam_id), None)
        if cam is None:
            return {"error": "unknown camera id — use find_cameras first"}
        if not cam.get("available"):
            return {"error": "camera offline"}
        try:
            analysis = await app.state.camera_analyst.analyze(cam["image"])
        except Exception as exc:  # noqa: BLE001 — surface as a tool error, not a 500
            return {"error": f"vision analysis failed: {exc}"}
        return {
            "camera": {
                "id": cam["id"], "name": cam["name"], "view": cam["view"],
                "lat": cam["lat"], "lon": cam["lon"], "image": cam["image"],
            },
            "analysis": analysis.model_dump(),
        }

    # AI analyst — conversational tool loop over everything above.
    app.state.analyst = AnalystService(
        settings.analyst_model,
        settings.anthropic_api_key,
        provider=settings.llm_provider,
        gemini_key=settings.gemini_api_key,
        gemini_model=settings.gemini_analyst_model,
        snapshot=store.snapshot,
        dossier=_analyst_dossier,
        events=app.state.risk_engine.recent_events,
        conditions=app.state.windy.forecast,
        flagged=app.state.risk_engine.flagged_set,
        cameras=app.state.cameras.list if app.state.cameras else None,
        camera_view=_analyst_camera_view if app.state.cameras else None,
        trains=train_store.snapshot if train_store else None,
    )
    log.info("LLM provider: %s", settings.llm_provider)

    sweeper = asyncio.create_task(_stale_sweeper(app), name="stale-sweeper")
    geofence_task = asyncio.create_task(_geofence_loop(app), name="geofence-eval")
    risk_task = asyncio.create_task(_risk_loop(app), name="risk-eval")
    heli_task = asyncio.create_task(_heli_loop(app), name="heli-detect")
    density_task = asyncio.create_task(_density_loop(app), name="density-sample")
    rate_task = asyncio.create_task(_rate_loop(app), name="source-rate")
    history_task = asyncio.create_task(_history_loop(app), name="history-sample")
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
        heli_task.cancel()
        density_task.cancel()
        rate_task.cancel()
        history_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper
        with contextlib.suppress(asyncio.CancelledError):
            await rate_task
        with contextlib.suppress(asyncio.CancelledError):
            await geofence_task
        with contextlib.suppress(asyncio.CancelledError):
            await risk_task
        with contextlib.suppress(asyncio.CancelledError):
            await density_task
        with contextlib.suppress(asyncio.CancelledError):
            await history_task
        if weather_task is not None:
            weather_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await weather_task
        density.close()
        history.close()
        alerts.close()
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
        if air_store is not None:
            await air_store.close()
        if bus_store is not None:
            await bus_store.close()
        if app.state.air_enricher is not None:
            await app.state.air_enricher.close()
        if app.state.cameras is not None:
            await app.state.cameras.close()
        if app.state.camera_analyst is not None:
            await app.state.camera_analyst.close()
        await _http.aclose()


app = FastAPI(title="Argus Eyes API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Replay/snapshot payloads are large numeric JSON — gzip shrinks them ~10-20×.
app.add_middleware(GZipMiddleware, minimum_size=1024)


def _source_status(src) -> dict:
    return {
        "name": src.name,
        "connected": src.connected,
        "receiving": src.receiving,  # connected AND data actually flowing
        "configured": src.configured,
        "messages_seen": src.messages_seen,
        "msg_rate": round(src.msg_rate, 1),  # messages/sec (rolling 5s sample)
    }


@app.get("/healthz")
async def healthz():
    settings = app.state.settings
    return {
        "status": "ok",
        "sources": [_source_status(s) for s in app.state.sources],
        "vessels": await app.state.store.count(),
        "aircraft": await app.state.air_store.count() if app.state.air_store else 0,
        "buses": await app.state.bus_store.count() if app.state.bus_store else 0,
        "trains": await app.state.train_store.count() if app.state.train_store else 0,
        "tube": await app.state.tube_store.count() if app.state.tube_store else 0,
        "incidents": await app.state.incident_store.count() if app.state.incident_store else 0,
        "clients": app.state.broadcaster.client_count,
        "registry": app.state.registry.count() if app.state.registry else 0,
        "data": {
            "aisstream_key_set": bool(settings.aisstream_api_key),
            "sanctions_loaded": app.state.sanctions.loaded,
            "ownership_loaded": app.state.ownership.available,
            "briefing_ready": bool(settings.anthropic_api_key),
        },
    }


@app.get("/api/incidents")
async def incidents():
    """All current incidents (the Argus spine)."""
    if app.state.incident_store is None:
        return {"incidents": []}
    return {"incidents": [i.model_dump() for i in await app.state.incident_store.snapshot()]}


@app.get("/api/rail/network")
async def rail_network():
    """GB rail route geometry (Network Rail reference lines, OGL) — the map's
    actual lines. Static file, gzipped by middleware, cached by the browser."""
    from pathlib import Path

    path = Path(__file__).parent / "rail" / "network.geojson"
    if app.state.train_store is None or not path.is_file():
        return Response(status_code=204)
    return FileResponse(
        path, media_type="application/geo+json",
        headers={"Cache-Control": "public, max-age=86400"},
    )


async def _pulse_narrative(pulse: dict) -> str | None:
    """One-line AI headline for the railway pulse, cached ~10 min. Best-effort."""
    st = app.state
    if not st.settings.anthropic_api_key or pulse["total"] == 0:
        return st.pulse_narrative["text"]
    if time.time() - st.pulse_narrative["ts"] < 600:
        return st.pulse_narrative["text"]
    worst = ", ".join(f"{o['name']} {o['on_time_pct']}% on time" for o in pulse["operators"][:3])
    prompt = (
        f"Live GB rail right now: {pulse['total']} services tracked, "
        f"{pulse['on_time_pct']}% on time, {pulse['late']} running late "
        f"({pulse['bad']} by 5+ min), average delay {pulse['avg_delay']} min. "
        f"Worst operators: {worst or 'n/a'}. "
        "Write ONE calm, factual sentence (max 22 words) summarising the state "
        "of the railway for an operations dashboard. No preamble."
    )
    try:
        client = anthropic.AsyncAnthropic(api_key=st.settings.anthropic_api_key, max_retries=1)
        msg = await client.messages.create(
            model=st.settings.camera_vision_model, max_tokens=80,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in msg.content if b.type == "text").strip()
        st.pulse_narrative = {"text": text, "ts": time.time()}
    except Exception as exc:  # noqa: BLE001
        log.warning("pulse narrative failed: %s", exc)
    return st.pulse_narrative["text"]


# Greater-London bbox (W, S, E, N) for cross-modal London stats.
_LONDON_BBOX = (-0.53, 51.28, 0.34, 51.70)


@app.get("/api/london/pulse")
async def london_pulse():
    """One live cross-modal read on London transport: tube + rail + bus fused.
    Nobody else tracks all three live at once."""
    from .rail.pulse import compute_pulse

    w, s2, e, n = _LONDON_BBOX
    out: dict = {"tube": None, "rail": None, "bus": None, "health": None}

    # Tube: line status + trains on the move.
    if app.state.tube_network is not None and app.state.tube_store is not None:
        lines = await app.state.tube_network.lines()
        good = sum(1 for g in lines.values() if g.severity >= 10)
        tubes = await app.state.tube_store.snapshot()
        moving = sum(1 for t in tubes if (t.speed_kn or 0) > 0)
        disrupted = [g.name for g in lines.values() if g.severity < 10]
        out["tube"] = {"trains": len(tubes), "moving": moving,
                       "lines_good": good, "lines_total": len(lines),
                       "disrupted": disrupted[:6]}

    # Rail: services whose current position sits inside the London box.
    if app.state.train_store is not None:
        allt = await app.state.train_store.snapshot()
        lond = [t for t in allt if t.lat is not None and w <= t.lon <= e and s2 <= t.lat <= n]
        rp = compute_pulse(lond)
        out["rail"] = {"count": rp["total"], "on_time_pct": rp["on_time_pct"], "late": rp["late"]}

    # Bus: fleet on the road.
    if app.state.bus_store is not None:
        out["bus"] = {"count": await app.state.bus_store.count()}

    # Blended health: mean of the punctuality-like signals we actually have
    # (tube good-service %, London rail on-time %). Buses have no punctuality,
    # so they count as presence, not health.
    signals = []
    if out["tube"] and out["tube"]["lines_total"]:
        signals.append(100.0 * out["tube"]["lines_good"] / out["tube"]["lines_total"])
    if out["rail"] and out["rail"]["on_time_pct"] is not None and out["rail"]["count"] >= 3:
        signals.append(out["rail"]["on_time_pct"])
    out["health"] = round(sum(signals) / len(signals)) if signals else None
    return out


@app.get("/api/rail/hotspots")
async def rail_hotspots():
    """Live delay hotspots: heat points + the top clusters, worst first."""
    if app.state.train_store is None:
        return {"points": [], "hotspots": []}
    from .rail.hotspots import compute_hotspots

    return compute_hotspots(await app.state.train_store.snapshot())


@app.get("/api/rail/pulse")
async def rail_pulse():
    """State of the Railway: live national punctuality + per-operator + trend."""
    if app.state.train_store is None:
        return {"total": 0}
    from .rail.pulse import compute_pulse

    pulse = compute_pulse(await app.state.train_store.snapshot())
    if pulse["on_time_pct"] is not None:
        app.state.pulse_history.append((time.time(), pulse["on_time_pct"]))
    hist = list(app.state.pulse_history)
    pulse["history"] = [round(p) for _t, p in hist][-30:]
    trend = 0
    if len(hist) >= 4:
        trend = hist[-1][1] - hist[max(0, len(hist) - 12)][1]  # vs ~last 12 samples
    pulse["trend"] = trend
    pulse["narrative"] = await _pulse_narrative(pulse)
    return pulse


@app.get("/api/rail/board")
async def rail_board(station: str, limit: int = 12):
    """Live departure board for a station (name or CRS) from the train picture."""
    if app.state.train_store is None:
        return {"services": []}
    from .rail.board import build_board

    return build_board(await app.state.train_store.snapshot(), station, limit)


@app.get("/api/stations")
async def rail_stations():
    """GB railway stations (CRS + name + position) for the rail layer."""
    if app.state.train_store is None:
        return {"stations": []}
    from .rail.stations import stations_by_crs

    return {
        "stations": [
            {"crs": s.crs, "name": s.name, "lat": s.lat, "lon": s.lon}
            for s in stations_by_crs().values()
        ]
    }


@app.get("/api/tube/board")
async def tube_board(id: str, limit: int = 14):
    """Live tube departure board for a station (TfL StopPoint arrivals)."""
    if app.state.tube_network is None:
        return {"services": []}
    key = app.state.settings.tfl_app_key
    params = {"app_key": key} if key else {}
    try:
        r = await _http.get(f"https://api.tfl.gov.uk/StopPoint/{id}/Arrivals", params=params)
        r.raise_for_status()
        preds = r.json()
    except httpx.HTTPError:
        return {"services": []}
    preds.sort(key=lambda p: p.get("timeToStation", 1e9))
    station = preds[0]["stationName"].replace(" Underground Station", "") if preds else None
    return {
        "station": station,
        "services": [
            {
                "line": p.get("lineId"),
                "line_name": p.get("lineName"),
                "to": (p.get("towards") or p.get("destinationName") or "").replace(" Underground Station", ""),
                "tts": p.get("timeToStation"),
                "platform": p.get("platformName"),
            }
            for p in preds[: max(1, min(limit, 30))]
        ],
    }


@app.get("/api/tube/network")
async def tube_network():
    """Underground line geometry + stations + status for the tube layer."""
    if app.state.tube_network is None:
        return {"lines": [], "stations": []}
    return await app.state.tube_network.payload()


@app.get("/api/flags")
async def feature_flags():
    flags = get_flags()
    # Photoreal 3D available only when a Google key is configured server-side.
    flags["google_3d"] = bool(app.state.settings.google_maps_key)
    # Air-traffic layer available only when the ADS-B feed is enabled server-side.
    flags["air"] = bool(app.state.settings.enable_air)
    # London buses available when the BODS feed is enabled + keyed server-side.
    flags["bus"] = bool(app.state.settings.enable_bus and app.state.settings.bods_api_key)
    # London traffic cameras available when the TfL feed is enabled server-side.
    flags["cameras"] = bool(app.state.settings.enable_cameras)
    # GB trains: hidden until the real feed exists — the layer only surfaces
    # once Darwin Push Port credentials are configured (the simulator stays a
    # dev-only tool via ENABLE_TRAIN + TRAIN_SIM, without the UI toggle).
    s2 = app.state.settings
    # Visible when the rail domain is on AND has a source: real Darwin creds,
    # or the simulator for local dev. The deployed box leaves ENABLE_TRAIN
    # unset, so nothing surfaces publicly until the real feed exists.
    flags["train"] = bool(
        s2.enable_train
        and ((s2.darwin_bootstrap and s2.darwin_user and s2.darwin_pass) or s2.train_sim)
    )
    # London Underground layer (TfL, keyless).
    flags["tube"] = bool(app.state.settings.enable_tube)
    # Incident spine (Argus).
    flags["incidents"] = bool(app.state.settings.enable_incidents)
    return {"flags": flags}


# Hop-by-hop and key-bearing headers we must not echo back to the browser.
_TILE_DROP_HEADERS = {
    "content-encoding", "content-length", "transfer-encoding", "connection",
    "x-goog-api-key", "set-cookie", "alt-svc",
}


def _origin_host_allowed(referer: str, host: str) -> bool:
    """Basic anti-hotlink guard: the request's Referer/Origin must come from our
    own host (so the proxy isn't an open relay billed to us from other sites).
    localhost is always allowed for dev (frontend :5174 → backend :8000). Browsers
    send a same-origin Referer by default; a missing one (e.g. curl) is rejected.
    Not bulletproof (referers are spoofable) but stops casual abuse/hotlinking."""
    from urllib.parse import urlparse

    ref_host = (urlparse(referer).hostname or "").lower() if referer else ""
    if not ref_host:
        return False
    return ref_host == host or ref_host in ("localhost", "127.0.0.1")


@app.get("/v1/3dtiles/{path:path}")
async def google_3d_proxy(path: str, request: Request):
    """Proxy Google Photorealistic 3D Tiles, injecting the API key server-side so
    it's never exposed to the browser. Child tile URIs are host-relative
    (/v1/3dtiles/...), so they resolve back through this same route. The key must
    go in the X-GOOG-API-KEY header (query-param keys are rejected by Google)."""
    key = app.state.settings.google_maps_key
    if not key:
        raise HTTPException(404, "3D tiles not configured")
    req_host = (request.headers.get("host") or "").split(":")[0].lower()
    referer = request.headers.get("referer") or request.headers.get("origin") or ""
    if not _origin_host_allowed(referer, req_host):
        raise HTTPException(403, "forbidden origin")
    try:
        upstream = await _http.get(
            f"{GOOGLE_3D_HOST}/v1/3dtiles/{path}",
            params=dict(request.query_params),
            headers={"X-GOOG-API-KEY": key},
        )
    except httpx.HTTPError as exc:
        log.warning("3d-tiles proxy upstream error: %s", exc)
        raise HTTPException(502, "upstream tile error")
    headers = {
        k: v for k, v in upstream.headers.items() if k.lower() not in _TILE_DROP_HEADERS
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type"),
        headers=headers,
    )


@app.get("/api/sources")
async def list_sources():
    return {"sources": [_source_status(s) for s in app.state.sources]}


@app.get("/api/aircraft/{hex}")
async def aircraft_detail(hex: str):
    """Dossier for one aircraft: the live ADS-B record plus static enrichment
    (airframe/operator/photo + flight route) from adsbdb. The air-domain
    analogue of the per-vessel ownership/conditions lookups."""
    store = app.state.air_store
    if store is None:
        raise HTTPException(404, "air feed disabled")
    ac = await store.get(hex)
    enricher = app.state.air_enricher
    info = await enricher.aircraft(hex) if enricher else None
    route = (
        await enricher.route(ac.callsign)
        if enricher and ac and ac.callsign
        else None
    )
    return {
        "aircraft": ac.model_dump() if ac else None,
        "info": info,
        "route": route,
    }


@app.get("/api/cameras")
async def list_cameras():
    """London traffic cameras (TfL JamCams) — the 'land' surveillance layer.
    Each has a live-ish snapshot + a 5s clip the browser loads directly."""
    catalog = app.state.cameras
    if catalog is None:
        raise HTTPException(404, "cameras disabled")
    try:
        cams = await catalog.list()
    except httpx.HTTPError as exc:
        log.warning("TfL cameras fetch failed: %s", exc)
        raise HTTPException(502, "camera feed unavailable")
    return {"cameras": cams}


@app.post("/api/cameras/{cam_id:path}/analyze")
async def analyze_camera(cam_id: str):
    """Claude-vision scene analysis of a camera's current snapshot — aggregate,
    anonymous counts + congestion. No plate/individual identification."""
    catalog = app.state.cameras
    analyst = app.state.camera_analyst
    if catalog is None or analyst is None:
        raise HTTPException(404, "cameras disabled")
    cams = await catalog.list()
    cam = next((c for c in cams if c["id"] == cam_id), None)
    if cam is None:
        raise HTTPException(404, "unknown camera")
    if not cam.get("available"):
        raise HTTPException(409, "camera offline")
    try:
        analysis = await analyst.analyze(cam["image"])
    except VisionUnavailable as exc:
        raise HTTPException(503, str(exc))
    except anthropic.APIError as exc:
        log.warning("camera vision failed: %s", exc)
        raise HTTPException(502, "vision analysis failed")
    except httpx.HTTPError as exc:
        log.warning("camera snapshot fetch failed: %s", exc)
        raise HTTPException(502, "could not fetch snapshot")
    return {"analysis": analysis.model_dump()}


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


@app.get("/api/vessel/{mmsi}/history")
async def vessel_history(mmsi: int):
    """Stored track for a vessel from the position-history store — used to show
    where a no-longer-live vessel last was (and its recent path)."""
    track = await asyncio.to_thread(app.state.history.vessel_track, mmsi)
    return {"mmsi": mmsi, "track": track, "last": track[-1] if track else None}


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


@app.get("/api/replay")
async def replay(
    start: float, end: float, bbox: str | None = None
) -> dict:
    """Per-vessel position tracks within ``[start, end]`` for movement replay.

    ``bbox`` is an optional ``"west,south,east,north"`` filter. Returns the stored
    span so the frontend can clamp its scrubber to what actually exists. Names are
    joined from the registry (static, so kept out of the per-row history)."""
    if not get_flags().get("replay"):
        return {"tracks": [], "span": None}
    box = None
    if bbox:
        try:
            w, s, e, n = (float(x) for x in bbox.split(","))
            box = (w, s, e, n)
        except ValueError:
            raise HTTPException(400, "bbox must be 'west,south,east,north'")

    tracks = await asyncio.to_thread(
        app.state.history.tracks, int(start), int(end), box
    )
    # Names from the in-memory registry only (a dict lookup) — no per-track
    # `await store.get`, which on a wide window meant tens of thousands of awaits.
    registry = app.state.registry
    if registry is not None:
        for t in tracks:
            t["name"] = registry.name(t["mmsi"])

    points = sum(len(t["path"]) for t in tracks)
    log.info(
        "replay: %d tracks, %d points, %ds window%s",
        len(tracks), points, int(end - start), " (bbox)" if box else "",
    )
    span = await asyncio.to_thread(app.state.history.span)
    return {"tracks": tracks, "span": span}


async def _conditions_for(v) -> dict | None:
    """Windy point forecast at a vessel's position, gated by the weather flag.
    Quota-friendly: WindyPoint caches by ¼° cell × hour."""
    if v is None or v.lat is None or v.lon is None:
        return None
    if not get_flags().get("weather"):
        return None
    return await app.state.windy.forecast(v.lat, v.lon)


@app.get("/api/vessel/{mmsi}/conditions")
async def vessel_conditions(mmsi: int):
    """Windy point forecast (wind/waves/temp) at a vessel's current position."""
    v = await app.state.store.get(mmsi)
    return {"conditions": await _conditions_for(v)}


@app.get("/api/weather/wind")
async def weather_wind():
    """Metadata for the current GFS wind field (bounds, unscale, cycle)."""
    src = app.state.weather
    if not get_flags().get("weather") or src is None or src.meta is None:
        return {"available": False}
    return {"available": True, **src.meta}


@app.get("/api/weather/wind.png")
async def weather_wind_png(step: int = 0):
    """The encoded U/V velocity image for the particle layer, at a forecast hour."""
    src = app.state.weather
    path = src.png_path(step) if src is not None else None
    if not path:
        raise HTTPException(status_code=404, detail="no wind field yet")
    return FileResponse(path, media_type="image/png")


@app.get("/api/weather/waves")
async def weather_waves():
    """Metadata for the current GFS-Wave significant-wave-height field."""
    src = app.state.waves
    if not get_flags().get("weather") or src is None or src.meta is None:
        return {"available": False}
    return {"available": True, **src.meta}


@app.get("/api/weather/waves.png")
async def weather_waves_png(step: int = 0):
    """The encoded significant-wave-height image for the sea-state raster, at a step."""
    src = app.state.waves
    path = src.png_path(step) if src is not None else None
    if not path:
        raise HTTPException(status_code=404, detail="no wave field yet")
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


@app.get("/api/alerts")
async def alerts(
    category: str | None = None,
    kind: str | None = None,
    search: str | None = None,
    mmsi: int | None = None,
    since: float | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """Paged, filterable history of risk + geofence alerts (newest first)."""
    return await asyncio.to_thread(
        app.state.alerts.query,
        category=category,
        kind=kind,
        search=search,
        mmsi=mmsi,
        since=since,
        limit=limit,
        offset=offset,
    )


def _fence_point(f) -> tuple[float, float] | None:
    """A representative (lon, lat) for a geofence, to fly to."""
    if f.shape == "circle" and f.center:
        return f.center
    pts = f.ring or f.path
    if pts:
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return None


@app.get("/api/search")
async def search(q: str, type: str | None = None, limit: int = 6):
    """Unified global search across vessels, events, locations and intelligence.

    With no `type`, every group is returned capped at `limit` with full `counts`
    (for the "All" view + "See more"). Pass `type=<group>` (and a larger `limit`)
    to fetch just one group for its tab."""
    ql = q.strip()
    counts = {"vessels": 0, "events": 0, "locations": 0, "intelligence": 0, "places": 0}
    if len(ql) < 2:
        return {"q": ql, "vessels": [], "events": [], "locations": [], "intelligence": [], "places": [], "counts": counts}

    want = lambda c: type is None or type == c  # noqa: E731
    cap = max(1, min(limit, 50))

    # --- Vessels (registry, enriched with any live position) ---
    vessels: list[dict] = []
    if want("vessels") and app.state.registry is not None:
        rows, counts["vessels"] = app.state.registry.search(ql, cap)
        for r in rows:
            v = await app.state.store.get(r["mmsi"])
            live = bool(v and v.lat is not None and v.lon is not None)
            r["live"] = live
            r["last_ts"] = None
            if live:
                r["lat"], r["lon"] = v.lat, v.lon
            else:
                # Not transmitting now — fall back to its last-known fix from the
                # history store, so the result still has somewhere to fly to.
                last = await asyncio.to_thread(app.state.history.last_position, r["mmsi"])
                r["lat"] = last[1] if last else None
                r["lon"] = last[0] if last else None
                r["last_ts"] = last[2] if last else None
            if not r.get("name") and v and v.name:
                r["name"] = v.name
        vessels = rows

    # --- Events (alert history) ---
    events: list[dict] = []
    if want("events"):
        res = await asyncio.to_thread(app.state.alerts.query, search=ql, limit=cap)
        events, counts["events"] = res["alerts"], res["total"]

    # --- Locations (geofences + region presets) ---
    locations: list[dict] = []
    if want("locations"):
        for f in app.state.geofence_store.list():
            if ql.lower() in f.name.lower():
                pt = _fence_point(f)
                if pt:
                    locations.append({
                        "id": f.id, "name": f.name, "kind": "geofence",
                        "lon": pt[0], "lat": pt[1], "category": f.category,
                    })
        regs, _ = search_regions(ql, 50)
        locations.extend(regs)
        counts["locations"] = len(locations)
        locations = locations[:cap]

    # --- Intelligence (sanctioned vessels + recent behavioral findings) ---
    intelligence: list[dict] = []
    if want("intelligence"):
        sres, scount = app.state.sanctions.search(ql, cap)
        for s in sres:
            prog = f" · {s['program']}" if s.get("program") else ""
            intelligence.append({
                "kind": "sanction", "title": s["name"], "subtitle": f"Sanctioned{prog}",
                "mmsi": s.get("mmsi"), "imo": s.get("imo"),
            })
        rcount = 0
        risk: list[dict] = []
        for e in app.state.risk_engine.recent_events(24.0):
            blob = f"{e.get('title', '')} {e.get('name') or ''} {e.get('name_b') or ''}".lower()
            if ql.lower() in blob:
                rcount += 1
                risk.append({
                    "kind": "risk", "title": e.get("title"),
                    "subtitle": e.get("name") or (f"MMSI {e['mmsi']}" if e.get("mmsi") else ""),
                    "mmsi": e.get("mmsi"), "lat": e.get("lat"), "lon": e.get("lon"), "ts": e.get("ts"),
                })
        counts["intelligence"] = scount + rcount
        intelligence = (intelligence + risk)[:cap]

    # --- Places (rail stations + traffic cameras — named spots you act on) ---
    places: list[dict] = []
    if want("places"):
        qlow = ql.lower()
        # Rail stations → open a live departure board. Rank exact/prefix first.
        if app.state.train_store is not None:
            from .rail.stations import stations_by_crs

            exact, prefix, sub = [], [], []
            for st in stations_by_crs().values():
                nl = st.name.lower()
                row = {
                    "kind": "station", "id": st.crs, "name": st.name,
                    "subtitle": st.crs, "lat": st.lat, "lon": st.lon,
                }
                if nl == qlow or st.crs.lower() == qlow:
                    exact.append(row)
                elif nl.startswith(qlow):
                    prefix.append(row)
                elif qlow in nl:
                    sub.append(row)
            station_hits = exact + sorted(prefix, key=lambda r: r["name"]) + sorted(sub, key=lambda r: r["name"])
        else:
            station_hits = []
        # Traffic cameras → open the live feed.
        camera_hits: list[dict] = []
        if app.state.cameras is not None:
            for c in await app.state.cameras.list():
                name = c.get("name") or ""
                if qlow in name.lower():
                    camera_hits.append({
                        "kind": "camera", "id": c["id"], "name": name,
                        "subtitle": c.get("view") or "Traffic camera",
                        "lat": c.get("lat"), "lon": c.get("lon"),
                        "available": c.get("available", True),
                    })
        counts["places"] = len(station_hits) + len(camera_hits)
        # Interleave so both types are represented in the capped "All" view.
        places = (station_hits + camera_hits)[:cap]

    return {
        "q": ql, "vessels": vessels, "events": events,
        "locations": locations, "intelligence": intelligence,
        "places": places, "counts": counts,
    }


@app.get("/api/vessel/{mmsi}/risk")
async def vessel_risk(mmsi: int):
    """Composite risk assessment: sanctions + ownership + behavioral signals."""
    if not get_flags().get("risk_engine"):
        return {"risk": None}
    inputs = await _assemble_risk_inputs(mmsi)
    if inputs is None:
        return {"risk": compute_risk(None, None, None, [], [])}
    conditions = await _conditions_for(inputs[0])
    return {"risk": compute_risk(*inputs, conditions=conditions)}


async def _analyst_dossier(mmsi: int) -> dict | None:
    """Condensed all-source dossier for the analyst's vessel_dossier tool."""
    inputs = await _assemble_risk_inputs(mmsi)
    if inputs is None:
        return None
    v, own, sanctioned_vessel, owner_hits, recent = inputs
    conditions = await _conditions_for(v)
    risk = compute_risk(*inputs, conditions=conditions)
    from .mid import flag_for_mmsi  # local import: avoid cycle at module load

    def clean(d: dict | None, keys: tuple[str, ...]) -> dict | None:
        if not d:
            return None
        out = {k: d.get(k) for k in keys if d.get(k)}
        return out or None

    return {
        "vessel": {
            "mmsi": v.mmsi,
            "name": v.name,
            "imo": v.imo,
            "callsign": v.callsign,
            "flag": (own or {}).get("flag") or flag_for_mmsi(v.mmsi),
            "type_code": v.ship_type,
            "destination": (v.destination or "").strip() or None,
            "sog_kn": v.sog,
            "lat": v.lat,
            "lon": v.lon,
        },
        "ownership": clean(
            own,
            (
                "reg_owner", "reg_owner_domicile", "reg_owner_control",
                "operator", "operator_domicile",
                "beneficial_owner", "beneficial_owner_domicile", "beneficial_owner_control",
                "manager", "manager_domicile", "ex_name", "gross_tonnage",
            ),
        ),
        "sanctions": {
            "vessel_listed": bool(sanctioned_vessel),
            "vessel_match": clean(sanctioned_vessel, ("name", "imo", "program")),
            "sanctioned_parties": [{"role": r, "name": n} for r, n in owner_hits] or None,
        },
        "risk": risk,
        "recent_events": recent or None,
        "conditions": conditions,
    }


class AnalystQuery(BaseModel):
    question: str
    history: list[dict] = []


@app.post("/api/analyst")
async def analyst(q: AnalystQuery):
    """Conversational AI analyst over the live picture (SSE stream).

    Emits `data: {json}` lines — event types: delta (answer text), tool
    (trace chip), map (highlight/fly directive), final (cost), error."""
    if not get_flags().get("analyst"):
        raise HTTPException(status_code=404, detail="analyst disabled")
    question = q.question.strip()[:2000]
    if not question:
        raise HTTPException(status_code=422, detail="empty question")

    async def gen():
        import json as _json

        async for ev in app.state.analyst.stream(question, q.history):
            yield f"data: {_json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/vessel/{mmsi}/briefing")
async def vessel_briefing(mmsi: int, web: bool = False):
    """Claude-generated, cited risk briefing from the assembled evidence pack.
    Pass ?web=true to additionally search the open web (slower, costs more)."""
    if not get_flags().get("llm_briefing"):
        raise HTTPException(status_code=404, detail="briefing disabled")
    inputs = await _assemble_risk_inputs(mmsi)
    if inputs is None:
        raise HTTPException(status_code=404, detail="vessel not tracked")
    conditions = await _conditions_for(inputs[0])
    try:
        return await app.state.briefing.generate(
            *inputs, web_search=web, conditions=conditions
        )
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
async def replace_geofences(fences: list[Geofence], origin: str = ""):
    """Bulk-replace the geofence set (the frontend syncs its full list). The new
    set is broadcast to every connected client so all browsers stay in sync;
    `origin` identifies the sender so it can ignore its own echo."""
    store: GeofenceStore = app.state.geofence_store
    store.replace_all(fences)
    app.state.evaluator.set_fences(store.list())
    # Seed membership for the new set without firing a burst of stale events.
    await app.state.evaluator.evaluate(emit=False)
    await app.state.broadcaster.send_frame(
        {
            "type": "geofences",
            "geofences": [f.model_dump() for f in store.list()],
            "origin": origin,
        }
    )
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
