"""Normalized domain models shared across the backend.

AISStream emits several message types (PositionReport, ShipStaticData, …) that
each carry *part* of a vessel's information. We merge them by MMSI into a single
``Vessel`` record that the frontend consumes.
"""
from __future__ import annotations

import time
from typing import Optional

from pydantic import BaseModel, Field


class VesselUpdate(BaseModel):
    """A partial update for one vessel, produced by the AIS parser.

    Only the fields present in the source message are set; everything else is
    ``None`` and left untouched when merged into the stored vessel.
    """

    mmsi: int

    # Dynamic (PositionReport)
    lat: Optional[float] = None
    lon: Optional[float] = None
    sog: Optional[float] = None  # speed over ground, knots
    cog: Optional[float] = None  # course over ground, degrees
    heading: Optional[float] = None  # true heading, degrees (511 = not available)
    nav_status: Optional[int] = None  # AIS navigational status code
    rot: Optional[float] = None  # rate of turn

    # Static (ShipStaticData)
    name: Optional[str] = None
    callsign: Optional[str] = None
    imo: Optional[int] = None  # persistent vessel id (joins to registries)
    ship_type: Optional[int] = None  # AIS ship & cargo type code
    destination: Optional[str] = None
    draught: Optional[float] = None
    to_bow: Optional[int] = None
    to_stern: Optional[int] = None
    to_port: Optional[int] = None
    to_starboard: Optional[int] = None

    ts: float = Field(default_factory=time.time)


class Vessel(BaseModel):
    """Full current state for one vessel (the merged record)."""

    mmsi: int
    lat: Optional[float] = None
    lon: Optional[float] = None
    sog: Optional[float] = None
    cog: Optional[float] = None
    heading: Optional[float] = None
    nav_status: Optional[int] = None
    rot: Optional[float] = None

    name: Optional[str] = None
    callsign: Optional[str] = None
    imo: Optional[int] = None
    ship_type: Optional[int] = None
    destination: Optional[str] = None
    draught: Optional[float] = None
    length: Optional[int] = None  # derived from to_bow + to_stern
    width: Optional[int] = None  # derived from to_port + to_starboard

    ts: float = 0.0  # last update (epoch seconds)

    def merge(self, u: VesselUpdate) -> "Vessel":
        """Apply a partial update in place, keeping previously-known fields."""
        data = u.model_dump(exclude_none=True, exclude={"mmsi"})
        # Derive dimensions when the static offsets are present.
        if u.to_bow is not None and u.to_stern is not None:
            self.length = u.to_bow + u.to_stern
        if u.to_port is not None and u.to_starboard is not None:
            self.width = u.to_port + u.to_starboard
        for key in ("to_bow", "to_stern", "to_port", "to_starboard"):
            data.pop(key, None)
        for key, value in data.items():
            setattr(self, key, value)
        return self


class Aircraft(BaseModel):
    """Full current state for one aircraft — the air-domain analogue of ``Vessel``.

    Sourced from ADS-B (adsb.lol). Unlike AIS, each poll returns a *complete*
    record, so there's no partial-merge: the source replaces the record wholesale.
    Keyed by ``hex`` (the ICAO24 transponder address).
    """

    hex: str  # ICAO24 transponder address — the stable key
    callsign: Optional[str] = None  # flight number / callsign
    lat: Optional[float] = None
    lon: Optional[float] = None
    track: Optional[float] = None  # ground track, degrees clockwise from north
    gs: Optional[float] = None  # ground speed, knots
    alt_baro: Optional[float] = None  # barometric altitude, feet (None on the ground)
    baro_rate: Optional[float] = None  # vertical rate, feet/min (+climb / -descend)
    on_ground: bool = False
    category: Optional[str] = None  # ADS-B emitter category (A1..C7)
    ac_type: Optional[str] = None  # ICAO aircraft type designator (e.g. B738)
    reg: Optional[str] = None  # registration / tail number
    squawk: Optional[str] = None  # transponder code (7500/7600/7700 = emergencies)

    ts: float = 0.0  # last update (epoch seconds)


class FireDetection(BaseModel):
    """One satellite thermal-anomaly detection — the fire-domain analogue of a
    point observation. Sourced from NASA FIRMS (VIIRS 375 m / MODIS 1 km).

    A detection is a single hot pixel from one satellite overpass; it never
    moves, so there's no dead-reckoning. Keyed by a stable hash of position +
    acquisition time + satellite, so re-polling the same window is idempotent.
    """

    id: str  # hash(lat, lon, acq, satellite) — stable key
    lat: float
    lon: float
    frp: float  # fire radiative power, megawatts — the intensity signal
    brightness: Optional[float] = None  # brightness temperature, Kelvin
    confidence: str = "nominal"  # "low" | "nominal" | "high" (normalised)
    satellite: str = ""  # human label, e.g. "NOAA-20", "S-NPP", "Aqua"
    instrument: str = ""  # "VIIRS" | "MODIS"
    daynight: str = "D"  # "D" daytime pass / "N" nighttime pass

    acq: float = 0.0  # acquisition time (epoch seconds, UTC)
    ts: float = 0.0  # same as acq — the field the broadcaster diffs on


class FireComplex(BaseModel):
    """A clustered wildfire — many detections grouped into one named fire, with
    growth over the last 24 h and a wind-driven spread forecast. This is the
    unit people care about ("the fire near Artana"), derived from the raw pixels.
    """

    id: str  # stable-ish hash of the cluster centroid
    lat: float  # FRP-weighted centroid
    lon: float
    total_frp: float  # summed radiative power — overall intensity
    peak_frp: float  # hottest single pixel
    count: int  # detections in the cluster
    count_24h: int  # detections in the last 24 h
    count_prev: int  # detections in the prior 24 h (for growth)
    growth: float  # count_24h / max(count_prev, 1) — >1 growing, <1 cooling
    status: str  # "spreading" | "active" | "easing" | "cooling"
    kind: str = "wildfire"  # "wildfire" | "industrial" (persistent point source)
    span_km: float  # rough extent (bbox diagonal)
    high_conf: int  # count of high-confidence detections
    first_seen: float  # earliest acquisition (epoch)
    last_seen: float  # latest acquisition (epoch)
    last_satellite: str = ""  # satellite of the most recent pass
    # Grid cells (round(lat/CELL_DEG), round(lon/CELL_DEG)) forming the cluster —
    # the client uses these to attribute raw detections to a complex exactly.
    cells: list[tuple[int, int]] = []

    # Enriched (reverse-geocode + wind) — populated best-effort, may be null.
    place: Optional[str] = None  # nearest settlement to the fire
    region: Optional[str] = None  # admin region / state
    country: Optional[str] = None
    flag: Optional[str] = None  # country flag emoji
    wind_from: Optional[float] = None  # bearing wind blows FROM, degrees
    wind_kmh: Optional[float] = None  # wind speed, km/h
    spread_deg: Optional[float] = None  # bearing the fire is pushed TOWARD
    spread_compass: Optional[str] = None  # e.g. "NE"
    downwind_place: Optional[str] = None  # settlement in the spread path


class Bus(BaseModel):
    """Full current state for one bus — the land-domain analogue of ``Vessel``.

    Sourced from the Bus Open Data Service (SIRI-VM). Each poll is a complete
    snapshot, so no partial-merge. Keyed by ``id`` (the operator's vehicle ref).
    """

    id: str  # "{operator}:{vehicleRef}" — the stable key
    route: Optional[str] = None  # published line name, e.g. "24" / "N5"
    destination: Optional[str] = None
    operator: Optional[str] = None  # operator ref, e.g. "TFLO" (TfL)
    lat: Optional[float] = None
    lon: Optional[float] = None
    bearing: Optional[float] = None  # degrees clockwise from north

    ts: float = 0.0  # last update (epoch seconds)


class TubeTrain(BaseModel):
    """One live London Underground train (positions inferred — see land/tube.py)."""

    id: str  # "{lineId}:{vehicleId}"
    line: str  # TfL line id, e.g. "victoria"
    line_name: str  # display name, e.g. "Victoria"
    towards: Optional[str] = None  # destination
    next_station: Optional[str] = None
    tts: Optional[float] = None  # seconds to next station
    current_location: Optional[str] = None  # TfL's own words
    lat: Optional[float] = None
    lon: Optional[float] = None
    bearing: Optional[float] = None
    speed_kn: Optional[float] = None  # rough along-track speed (client glide)

    ts: float = 0.0  # last update (epoch seconds)


class FerryPort(BaseModel):
    name: str
    lat: float
    lon: float


class FerryRoute(BaseModel):
    """One ferry route with live service status — the sea-domain service layer
    (the vessels themselves are already on the AIS layer; this is whether the
    *service* is running). CalMac via their GraphQL API; NorthLink via notices.
    """

    id: str  # operator-prefixed stable key, e.g. "calmac:5"
    operator: str  # "CalMac" | "NorthLink"
    name: str  # e.g. "Ullapool - Stornoway"
    status: str  # "normal" | "be_aware" | "disruptions"
    title: Optional[str] = None  # headline of the current disruption notice
    detail: Optional[str] = None  # notice text (plain)
    ports: list[FerryPort] = []
    updated: float = 0.0


class Hazard(BaseModel):
    """An environmental hazard in force — flood warning, severe-weather warning
    or earthquake. Mostly an empty layer (which is the good news); severity is
    normalised so all three kinds share one visual language.
    """

    id: str  # source-prefixed stable key, e.g. "quake:20260728030953"
    kind: str  # "flood" | "weather" | "quake"
    severity: str  # minor | moderate | serious (normalised)
    title: str
    detail: Optional[str] = None
    region: Optional[str] = None
    lat: float
    lon: float
    # GeoJSON geometry for area hazards (flood-warning polygons); points omit it.
    geometry: Optional[dict] = None
    url: Optional[str] = None
    magnitude: Optional[float] = None  # quakes only
    ts: float = 0.0  # event/issue time (epoch)
    updated: float = 0.0


class Incident(BaseModel):
    """A located, timestamped thing-happening — the unifying entity of the
    Argus incident spine. Every eye (official feeds, inference, news/social)
    produces Incidents of the same shape, so they all flow into the same alert
    rail / eyes-on-alert / analyst / map machinery.
    """

    id: str  # source-prefixed stable key, e.g. "tfl-road:TIMS-229103"
    source: str  # which eye produced it: "tfl-road", later "heli", "news"…
    category: str  # collision | breakdown | hazard | works | delay | event | other
    severity: str  # minor | moderate | serious (normalised)
    confidence: str  # official | inferred | reported
    title: str
    detail: Optional[str] = None
    location: Optional[str] = None
    lat: float
    lon: float
    url: Optional[str] = None

    # Camera verification (Argus's credibility superpower): an inferred incident
    # near a camera is checked with vision → confirmed / cleared, or None.
    verification: Optional[str] = None  # "confirmed" | "cleared" | None
    verification_note: Optional[str] = None  # Claude's one-line finding
    verified_camera: Optional[str] = None  # camera name it looked through
    verified_at: float = 0.0

    ts: float = 0.0  # first seen / start (epoch seconds)
    updated: float = 0.0  # last update


class TrainStop(BaseModel):
    """One calling point on a train's route (detail panel + route line)."""

    crs: str
    name: str
    lat: float
    lon: float
    t: float  # expected time at this stop (epoch seconds)


class Train(BaseModel):
    """Full current state for one train — rail (land domain).

    Positions are INFERRED, not broadcast: trains report times at calling
    points and the position is interpolated along the route between them
    (straight-line for Tier 1). `sim` marks the prototype's simulated feed.
    """

    id: str  # service id (Darwin RID, or "sim:*" for the simulator)
    headcode: Optional[str] = None  # e.g. "1A23"
    operator: Optional[str] = None  # e.g. "GWR"
    origin: Optional[str] = None
    destination: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    bearing: Optional[float] = None  # degrees clockwise from north
    speed_kn: Optional[float] = None  # along-segment speed (client glide)
    delay_min: Optional[float] = None
    delay_reason: Optional[str] = None  # human cause, from Darwin reason code
    next_name: Optional[str] = None  # next calling point
    stops: list[TrainStop] = []  # full calling pattern
    sim: bool = False

    ts: float = 0.0  # last update (epoch seconds)
