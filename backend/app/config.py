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
    risk_teleport_kn: float = Field(default=70.0, alias="RISK_TELEPORT_KN")
    risk_rendezvous_slow_kn: float = Field(default=5.0, alias="RISK_RDV_SLOW_KN")
    risk_rendezvous_nm: float = Field(default=0.5, alias="RISK_RDV_NM")
    risk_rendezvous_min: float = Field(default=20.0, alias="RISK_RDV_MIN")

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
