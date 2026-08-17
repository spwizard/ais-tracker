"""Application configuration.

All settings are read from environment variables (or a local ``.env`` file).
The only required value is ``AISSTREAM_API_KEY``; everything else has a sensible
default so the app boots with zero infra (in-memory store, UK/Channel bbox).

List-shaped settings (``AIS_BBOX``, ``CORS_ORIGINS``) are stored as raw strings
and exposed via parsed properties — this sidesteps pydantic-settings' eager
JSON-decoding of complex env fields (which rejects values like ``*``).
"""
from __future__ import annotations

import json
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# AISStream expects bounding boxes as [[lat, lon], [lat, lon]] (SW corner, NE corner).
# Default covers NW Europe + the western/central Mediterranean — the central Med
# (35N, taking in Sicily/Malta) up to mid-Norway, the Atlantic approaches across
# to the eastern Baltic and Aegean. AISStream is a global network, so a wider box
# just pulls in more of its stations' traffic; the overlap with the Kystverket /
# Digitraffic feeds is merged by MMSI in the store (no dedup needed).
DEFAULT_BBOX = [[35.0, -12.0], [63.0, 32.0]]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Sources -----------------------------------------------------------
    enable_aisstream: bool = Field(default=True, alias="ENABLE_AISSTREAM")
    enable_digitraffic: bool = Field(default=True, alias="ENABLE_DIGITRAFFIC")
    digitraffic_host: str = Field(
        default="meri.digitraffic.fi", alias="DIGITRAFFIC_HOST"
    )
    enable_kystverket: bool = Field(default=True, alias="ENABLE_KYSTVERKET")
    kystverket_host: str = Field(default="153.44.253.27", alias="KYSTVERKET_HOST")
    kystverket_port: int = Field(default=5631, alias="KYSTVERKET_PORT")

    # --- Air traffic (ADS-B via adsb.lol — free, no key, non-commercial) ----
    enable_air: bool = Field(default=True, alias="ENABLE_AIR")
    adsb_url: str = Field(default="https://api.adsb.lol", alias="ADSB_URL")
    # Poll regions as JSON: a list of [lat, lon, radius_nm] circles (adsb.lol max
    # 250 nm each). Defaults cover the same footprint as the AIS feeds — UK/
    # Channel, Scotland, the Norwegian coast/Skagerrak, and the Baltic/Gulf of
    # Finland — so aircraft appear wherever the vessels do.
    air_regions_raw: str = Field(
        default=json.dumps(
            [[50.5, 0.0, 250], [57.0, -4.5, 250], [59.5, 7.0, 250], [59.5, 23.0, 250]]
        ),
        alias="AIR_REGIONS",
    )
    air_poll_sec: float = Field(default=4.0, alias="AIR_POLL_SEC")
    air_ttl_sec: int = Field(default=90, alias="AIR_TTL_SEC")  # drop if silent >90s

    @property
    def air_regions(self) -> list[tuple[float, float, int]]:
        return [tuple(r) for r in json.loads(self.air_regions_raw)]

    # --- Ferries (CalMac GraphQL + NorthLink notices — keyless) -------------
    enable_ferry: bool = Field(default=True, alias="ENABLE_FERRY")

    # --- Hazards (SEPA floods + Met Office warnings + BGS quakes) -----------
    enable_hazards: bool = Field(default=True, alias="ENABLE_HAZARDS")

    # --- Wildfires (NASA FIRMS — free map key, near-real-time) --------------
    enable_fire: bool = Field(default=True, alias="ENABLE_FIRE")
    firms_url: str = Field(
        default="https://firms.modaps.eosdis.nasa.gov", alias="FIRMS_URL"
    )
    firms_map_key: str = Field(default="", alias="FIRMS_MAP_KEY")
    # Datasets to fuse (VIIRS 375 m across the three satellites for coverage +
    # recency; the store dedupes overlap). Add MODIS_NRT for wider history.
    fire_sources_raw: str = Field(
        default=json.dumps(
            ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]
        ),
        alias="FIRE_SOURCES",
    )
    # Poll regions as JSON: a list of [west, south, east, north] bboxes. Default
    # covers Iberia + France + all of the UK & Ireland (up to Shetland).
    fire_regions_raw: str = Field(
        default=json.dumps([[-11.0, 35.0, 10.0, 61.0]]),
        alias="FIRE_REGIONS",
    )
    fire_day_range: int = Field(default=2, alias="FIRE_DAY_RANGE")  # 1–5
    fire_poll_sec: float = Field(default=900.0, alias="FIRE_POLL_SEC")  # 15 min
    fire_ttl_sec: int = Field(default=172_800, alias="FIRE_TTL_SEC")  # 48 h
    fire_complex_sec: float = Field(default=300.0, alias="FIRE_COMPLEX_SEC")  # 5 min

    @property
    def fire_sources(self) -> list[str]:
        return list(json.loads(self.fire_sources_raw))

    @property
    def fire_regions(self) -> list[tuple[float, float, float, float]]:
        return [tuple(r) for r in json.loads(self.fire_regions_raw)]

    # --- Land: London buses (Bus Open Data Service SIRI-VM — free, needs key) --
    enable_bus: bool = Field(default=False, alias="ENABLE_BUS")
    # Ember coaches (Scottish intercity, open GTFS-RT — keyless). Rides the
    # same bus domain as BODS.
    enable_ember: bool = Field(default=True, alias="ENABLE_EMBER")
    bods_api_key: str = Field(default="", alias="BODS_API_KEY")
    bods_url: str = Field(
        default="https://data.bus-data.dft.gov.uk/api/v1", alias="BODS_URL"
    )
    # Poll region as minLon,minLat,maxLon,maxLat — defaults to Greater London.
    bus_bbox: str = Field(default="-0.53,51.28,0.30,51.70", alias="BUS_BBOX")
    bus_poll_sec: float = Field(default=12.0, alias="BUS_POLL_SEC")
    bus_ttl_sec: int = Field(default=60, alias="BUS_TTL_SEC")

    # --- Rail: GB trains, Tier-1 inferred positions -------------------------
    # Prototype: TRAIN_SIM=1 runs a simulated feed on real routes. The real
    # feed is Darwin Push Port (free registration at opendata.nationalrail.co.uk);
    # set the DARWIN_* credentials once granted.
    enable_train: bool = Field(default=False, alias="ENABLE_TRAIN")
    train_sim: bool = Field(default=True, alias="TRAIN_SIM")
    # Darwin Push Port via the Rail Data Marketplace (Confluent Kafka).
    darwin_bootstrap: str = Field(default="", alias="DARWIN_BOOTSTRAP")
    darwin_topic: str = Field(default="", alias="DARWIN_TOPIC")
    darwin_group: str = Field(default="", alias="DARWIN_GROUP")
    darwin_user: str = Field(default="", alias="DARWIN_USER")
    darwin_pass: str = Field(default="", alias="DARWIN_PASS")
    # Snapshot warm-start (REST product): full current state on boot.
    darwin_snapshot_url: str = Field(default="", alias="DARWIN_SNAPSHOT_URL")
    darwin_apikey: str = Field(default="", alias="DARWIN_APIKEY")

    # --- Incidents: Argus spine (TfL road disruptions + future eyes) --------
    enable_incidents: bool = Field(default=True, alias="ENABLE_INCIDENTS")
    # Traffic Scotland road eye — Scottish trunk-road incidents, delaying
    # roadworks, snow gates and bridge restrictions (keyless JSON).
    enable_scot_road: bool = Field(default=True, alias="ENABLE_SCOT_ROAD")
    # Bus-swarm inference is off by default: positional stall-detection can't
    # distinguish a genuine blockage from baseline bus-corridor congestion
    # without scheduled-route (diversion) data. Kept for when that lands.
    enable_bus_swarm: bool = Field(default=False, alias="ENABLE_BUS_SWARM")
    # News RSS eye — London incidents from news outlets (needs the Anthropic key).
    enable_news: bool = Field(default=True, alias="ENABLE_NEWS")
    # Bluesky social eye — London incidents from posts. Needs a free app password
    # (Bluesky Settings → App Passwords); idles cleanly if the creds are unset.
    enable_social: bool = Field(default=True, alias="ENABLE_SOCIAL")
    bluesky_handle: str = Field(default="", alias="BLUESKY_HANDLE")
    bluesky_app_password: str = Field(default="", alias="BLUESKY_APP_PASSWORD")

    # --- Land: London Underground (TfL — free, keyless; app_key raises limits) --
    enable_tube: bool = Field(default=True, alias="ENABLE_TUBE")

    # --- Land: London traffic cameras (TfL JamCams — free, keyless) --------
    enable_cameras: bool = Field(default=True, alias="ENABLE_CAMERAS")
    tfl_jamcam_url: str = Field(
        default="https://api.tfl.gov.uk/Place/Type/JamCam", alias="TFL_JAMCAM_URL"
    )
    tfl_app_key: str = Field(default="", alias="TFL_APP_KEY")  # optional, raises limits
    # Traffic Scotland LEV cameras — FTP access granted on application (private
    # credentials, never exposed to clients). Idles cleanly when unset.
    scot_lev_host: str = Field(default="ftp.traffic-scotland.co.uk", alias="SCOT_LEV_HOST")
    scot_lev_user: str = Field(default="", alias="SCOT_LEV_USER")
    scot_lev_password: str = Field(default="", alias="SCOT_LEV_PASSWORD")
    # Claude-vision model for the "analyze scene" camera feature (fast + cheap;
    # it's a simple structured count/congestion read on a tiny still).
    camera_vision_model: str = Field(
        default="claude-haiku-4-5", alias="CAMERA_VISION_MODEL"
    )

    # --- AISStream ---------------------------------------------------------
    aisstream_api_key: str = Field(default="", alias="AISSTREAM_API_KEY")
    aisstream_url: str = Field(
        default="wss://stream.aisstream.io/v0/stream", alias="AISSTREAM_URL"
    )
    # Bounding box(es) as JSON. A single box [[lat,lon],[lat,lon]] or a list of
    # boxes [[[lat,lon],[lat,lon]], ...]. Parsed by the ``ais_bbox`` property.
    ais_bbox_raw: str = Field(default=json.dumps(DEFAULT_BBOX), alias="AIS_BBOX")

    # --- State store -------------------------------------------------------
    # Blank => in-memory store. Set to redis://host:port/db to use Redis.
    redis_url: str = Field(default="", alias="REDIS_URL")

    # --- Behaviour ---------------------------------------------------------
    vessel_ttl_sec: int = Field(default=600, alias="VESSEL_TTL_SEC")  # evict if silent 10m
    trail_len: int = Field(default=200, alias="TRAIL_LEN")  # positions kept per vessel
    broadcast_hz: float = Field(default=1.0, alias="BROADCAST_HZ")  # fan-out frequency

    # --- Vessel registry (persistent MMSI -> static details) ---------------
    enable_registry: bool = Field(default=True, alias="ENABLE_REGISTRY")
    registry_path: str = Field(default="data/registry.sqlite", alias="REGISTRY_PATH")

    # --- Ownership (Lloyd's) -----------------------------------------------
    ownership_path: str = Field(default="data/ownership.sqlite", alias="OWNERSHIP_PATH")
    sanctions_path: str = Field(default="data/sanctions.json", alias="SANCTIONS_PATH")

    # --- LLM risk briefing -------------------------------------------------
    briefing_model: str = Field(default="claude-opus-4-8", alias="BRIEFING_MODEL")
    # Web open-source enrichment: Tavily does the search/scrape (cheap, fast),
    # a small model turns the results into cited findings. Opt-in per request.
    briefing_search_model: str = Field(default="claude-haiku-4-5", alias="BRIEFING_SEARCH_MODEL")
    briefing_web_search: bool = Field(default=False, alias="BRIEFING_WEB_SEARCH")
    tavily_api_key: str = Field(default="", alias="TAVILY_API_KEY")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")

    # --- AI analyst (conversational tool loop over the live picture) -------
    # Sonnet by default: the chat wants low latency and runs several tool
    # rounds per question; bump to opus via env if depth beats speed.
    analyst_model: str = Field(default="claude-sonnet-4-6", alias="ANALYST_MODEL")

    # --- LLM provider -----------------------------------------------------
    # Which backend powers the briefing + analyst: "gemini" or "anthropic".
    # Flip back to Anthropic by setting LLM_PROVIDER=anthropic.
    llm_provider: str = Field(default="gemini", alias="LLM_PROVIDER")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    # 2.5-pro is not on the free tier (quota 0); flash works there and is plenty
    # for a structured briefing with a thinking budget. Bump to pro once billed.
    gemini_briefing_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_BRIEFING_MODEL")
    gemini_analyst_model: str = Field(default="gemini-2.5-flash", alias="GEMINI_ANALYST_MODEL")
    gemini_search_model: str = Field(default="gemini-2.5-flash-lite", alias="GEMINI_SEARCH_MODEL")

    # --- Geofences ---------------------------------------------------------
    geofence_path: str = Field(default="data/geofences.json", alias="GEOFENCE_PATH")
    geofence_eval_sec: float = Field(default=2.0, alias="GEOFENCE_EVAL_SEC")

    # --- Alerts history (persistent risk + geofence events) ----------------
    alerts_path: str = Field(default="data/alerts.sqlite", alias="ALERTS_PATH")

    # --- Density timeline (spatial-temporal traffic bins) ------------------
    density_path: str = Field(default="data/density.sqlite", alias="DENSITY_PATH")
    density_res: int = Field(default=5, alias="DENSITY_RES")  # H3 resolution
    density_bucket_sec: int = Field(default=3600, alias="DENSITY_BUCKET_SEC")  # 1h buckets
    density_sample_sec: float = Field(default=60.0, alias="DENSITY_SAMPLE_SEC")

    # --- Google Photorealistic 3D Tiles (proxied so the key stays server-side) -
    google_maps_key: str = Field(default="", alias="GOOGLE_MAPS_KEY")

    # --- Vessel-movement replay (historical position track store) ----------
    history_path: str = Field(default="data/positions.sqlite", alias="HISTORY_PATH")
    history_window_sec: int = Field(default=172800, alias="HISTORY_WINDOW_SEC")  # 48h
    history_sample_sec: float = Field(default=30.0, alias="HISTORY_SAMPLE_SEC")

    # --- Weather (GFS wind field) ------------------------------------------
    weather_enabled: bool = Field(default=True, alias="WEATHER_ENABLED")
    weather_dir: str = Field(default="data/weather", alias="WEATHER_DIR")
    weather_refresh_sec: float = Field(default=10800.0, alias="WEATHER_REFRESH_SEC")  # 3h
    # Region as W,S,E,N — matches the AIS coverage: the central Mediterranean
    # (35N, incl. Sicily/Malta) up to the Norwegian Sea (72N), Atlantic
    # approaches (-12) to the eastern Baltic / Aegean (32E).
    weather_bbox_raw: str = Field(default="-12,35,32,72", alias="WEATHER_BBOX")
    # GFS forecast hours to encode for the time scrubber (the first is "now").
    weather_forecast_hours_raw: str = Field(
        default="0,6,12,18,24,36,48", alias="WEATHER_FORECAST_HOURS"
    )

    @property
    def weather_bbox(self) -> tuple[float, float, float, float]:
        w, s, e, n = (float(x) for x in self.weather_bbox_raw.split(","))
        return (w, s, e, n)

    @property
    def weather_forecast_hours(self) -> tuple[int, ...]:
        return tuple(int(x) for x in self.weather_forecast_hours_raw.split(",") if x.strip())

    # Windy Point Forecast — per-vessel conditions in the detail panel.
    windy_key: str = Field(default="", alias="WINDY_KEY")

    # --- Risk engine -------------------------------------------------------
    risk_eval_sec: float = Field(default=20.0, alias="RISK_EVAL_SEC")
    risk_teleport_kn: float = Field(default=80.0, alias="RISK_TELEPORT_KN")
    risk_rendezvous_slow_kn: float = Field(default=4.0, alias="RISK_RDV_SLOW_KN")
    risk_rendezvous_nm: float = Field(default=0.35, alias="RISK_RDV_NM")
    # Sustained proximity required (min). Higher = fewer congestion false positives.
    risk_rendezvous_min: float = Field(default=45.0, alias="RISK_RDV_MIN")

    # --- HTTP / CORS -------------------------------------------------------
    # Comma-separated list, a JSON array, or ``*``.
    cors_origins_raw: str = Field(default="*", alias="CORS_ORIGINS")

    @property
    def ais_bbox(self) -> list:
        """Normalised list of bounding boxes for the AISStream subscription."""
        v = json.loads(self.ais_bbox_raw)
        # Allow a single box [[lat,lon],[lat,lon]] -> wrap into a list of boxes.
        if v and isinstance(v[0][0], (int, float)):
            v = [v]
        return v

    @property
    def cors_origins(self) -> list[str]:
        v = self.cors_origins_raw.strip()
        if v.startswith("["):
            return json.loads(v)
        return [o.strip() for o in v.split(",") if o.strip()]

    @property
    def use_redis(self) -> bool:
        return bool(self.redis_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
