/** Mirrors the backend `Vessel` model (app/models.py). */
export interface Vessel {
  mmsi: number;
  lat: number | null;
  lon: number | null;
  sog: number | null; // speed over ground (knots)
  cog: number | null; // course over ground (deg)
  heading: number | null; // true heading (deg)
  nav_status: number | null;
  rot: number | null;
  name: string | null;
  callsign: string | null;
  imo: number | null;
  ship_type: number | null;
  destination: string | null;
  draught: number | null;
  length: number | null;
  width: number | null;
  ts: number; // last update, epoch seconds
}

/** Lloyd's ownership & particulars (GET /api/vessel/{mmsi}/ownership). */
export interface Ownership {
  imo: number | null;
  name: string | null;
  ex_name: string | null;
  flag: string | null;
  ship_type: string | null;
  status: string | null;
  gross_tonnage: number | null;
  port_of_registry: string | null;
  reg_owner: string | null;
  reg_owner_domicile: string | null;
  reg_owner_control: string | null;
  reg_owner_reg: string | null;
  operator: string | null;
  operator_domicile: string | null;
  beneficial_owner: string | null;
  beneficial_owner_domicile: string | null;
  beneficial_owner_control: string | null;
  manager: string | null;
  manager_domicile: string | null;
}

/** Client-side enriched record: vessel + accumulated trail. */
export interface TrackedVessel extends Vessel {
  /** Recent positions as [lon, lat, epochSeconds], oldest first. */
  trail: [number, number, number][];
}

/** One vessel's historical track for movement replay (GET /api/replay).
 *  Each path point is [lon, lat, epochSeconds, sog, cog, heading]. */
export interface ReplayTrack {
  mmsi: number;
  name: string | null;
  ship_type: number | null;
  path: [number, number, number, number | null, number | null, number | null][];
}

// --- Global search (GET /api/search) ---
export interface SearchVessel {
  mmsi: number;
  name: string | null;
  callsign: string | null;
  imo: number | null;
  ship_type: number | null;
  live: boolean;
  lat: number | null;
  lon: number | null;
  /** Last-known fix time (epoch s) for non-live vessels, from the history store. */
  last_ts?: number | null;
}
export interface SearchLocation {
  id: string;
  name: string;
  kind: "geofence" | "region";
  lat: number;
  lon: number;
  zoom?: number;
  category?: string;
}
export interface SearchIntel {
  kind: "sanction" | "risk";
  title: string | null;
  subtitle: string;
  mmsi: number | null;
  imo?: number | null;
  lat?: number | null;
  lon?: number | null;
  ts?: number;
}
/** A named place you act on: a rail station (→ departure board) or a traffic
 *  camera (→ live feed). */
export interface SearchPlace {
  kind: "station" | "camera";
  id: string; // CRS for stations, camera id for cameras
  name: string;
  subtitle: string;
  lat: number | null;
  lon: number | null;
  available?: boolean;
}

export type SearchCategory = "vessels" | "events" | "locations" | "intelligence" | "places";
export interface SearchResults {
  q: string;
  vessels: SearchVessel[];
  events: Alert[];
  locations: SearchLocation[];
  intelligence: SearchIntel[];
  places: SearchPlace[];
  counts: Record<SearchCategory, number>;
}

/** A geofence enter/exit/dwell event from the backend evaluator. */
export interface GeofenceEvent {
  type: "geofence_event";
  event: "enter" | "exit" | "dwell" | "speed" | "dark";
  fence_id: string;
  fence_name: string;
  category: string;
  color: string;
  mmsi: number;
  name: string | null;
  sog: number | null;
  lat: number;
  lon: number;
  ts: number;
}

/** A behavioral risk event from the backend risk engine. */
export interface RiskEvent {
  type: "risk_event";
  kind: "rendezvous" | "spoof";
  title: string;
  mmsi: number;
  name: string | null;
  mmsi_b?: number;
  name_b?: string | null;
  lat: number;
  lon: number;
  ts: number;
  detail: Record<string, number>;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskReason {
  code: string;
  label: string;
  severity: RiskLevel;
}

/** Claude-generated risk briefing (POST /api/vessel/{mmsi}/briefing). */
export interface BriefingFinding {
  title: string;
  severity: RiskLevel;
  confidence: "confirmed" | "suspicious";
  evidence_ids: string[];
}

export interface OpenSourceFinding {
  claim: string;
  source_url: string;
  as_of: string;
}

export interface Briefing {
  risk_level: RiskLevel;
  summary: string;
  findings: BriefingFinding[];
  open_source: OpenSourceFinding[];
  recommended_actions: string[];
  caveats: string[];
}

export interface EvidenceItem {
  id: string;
  type: string;
  summary: string;
  source: string;
  observed_at?: number;
}

export interface BriefingSource {
  title: string;
  url: string;
}

export interface BriefingCost {
  usd: number;
  tokens: number;
  searches: number;
}

export interface BriefingResponse {
  briefing: Briefing;
  evidence: EvidenceItem[];
  sources?: BriefingSource[];
  cost?: BriefingCost;
}

/** Windy point forecast at a vessel (GET /api/vessel/{mmsi}/conditions). */
export interface VesselConditions {
  wind_kn?: number;
  wind_dir?: number;
  gust_kn?: number;
  temp_c?: number;
  pressure_hpa?: number;
  wave_m?: number;
  wave_period_s?: number;
  wave_dir?: number;
  ts?: number;
}

/** One forecast hour of a GFS field. */
export interface ForecastStep {
  step: number; // forecast hour (0 = analysis / "now")
  valid: number; // valid time, epoch seconds
  imageUnscale: [number, number];
  width: number;
  height: number;
}

/** GFS field metadata (GET /api/weather/wind | /waves), with forecast steps. */
export interface WeatherResponse {
  available: boolean;
  bounds: [number, number, number, number]; // W,S,E,N
  cycle: string;
  updated: string;
  steps: ForecastStep[];
}

/** What a deck.gl weather layer needs for the currently-displayed step. */
export interface WeatherMeta {
  bounds: [number, number, number, number];
  imageUnscale: [number, number];
}

/** A historical density cell (GET /api/density/{bucket}). */
export interface DensityPoint {
  lat: number;
  lon: number;
  count: number;
}

/** Ownership network (GET /api/vessel/{mmsi}/network). */
export interface NetworkNode {
  id: string;
  type: "vessel" | "company";
  label: string;
  imo?: number | null;
  mmsi?: number | null;
  flag?: string | null;
  roles?: string[];
  code?: string;
  subject?: boolean;
  sanctioned: boolean;
}

export interface NetworkEdge {
  source: string;
  target: string;
  role: string;
}

export interface OwnershipNetwork {
  subject_id: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
}

/** A live aircraft (ADS-B), the air-domain analogue of Vessel. Keyed by `hex`. */
export interface Aircraft {
  hex: string; // ICAO24 transponder address
  callsign: string | null; // flight number / callsign
  lat: number | null;
  lon: number | null;
  track: number | null; // ground track, degrees clockwise from north
  gs: number | null; // ground speed, knots
  alt_baro: number | null; // barometric altitude, feet (null on the ground)
  baro_rate: number | null; // vertical rate, feet/min
  on_ground: boolean;
  category: string | null; // ADS-B emitter category (A1..C7)
  ac_type: string | null; // ICAO aircraft type designator
  reg: string | null; // registration / tail number
  squawk: string | null;
  ts: number; // last update, epoch seconds
}

/** Aircraft carrying a client-side dead-reckoning trail (rendered record). */
export interface TrackedAircraft extends Aircraft {
  trail: [number, number, number][]; // [lon, lat, ts]
}

/** A live London bus (BODS SIRI-VM) — a moving land vehicle. Keyed by `id`. */
export interface Bus {
  id: string;
  route: string | null; // published line name, e.g. "24"
  destination: string | null;
  operator: string | null; // e.g. "TFLO" for TfL
  lat: number | null;
  lon: number | null;
  bearing: number | null; // degrees clockwise from north
  ts: number;
}

export interface TrackedBus extends Bus {
  trail: [number, number, number][]; // [lon, lat, ts]
}

/** One calling point on a train's route. */
export interface TrainStop {
  crs: string;
  name: string;
  lat: number;
  lon: number;
  t: number; // expected time at this stop (epoch seconds)
}

/** A live GB train (rail domain). Positions are INFERRED by interpolating
 *  between calling-point times — Tier-1 accuracy, straight-line between
 *  stations. `sim` marks the prototype's simulated feed. */
export interface Train {
  id: string;
  headcode: string | null;
  operator: string | null;
  origin: string | null;
  destination: string | null;
  lat: number | null;
  lon: number | null;
  bearing: number | null; // degrees clockwise from north
  speed_kn: number | null; // along-segment speed (client-side glide)
  delay_min: number | null;
  next_name: string | null; // next calling point
  stops: TrainStop[];
  sim: boolean;
  ts: number;
}

export type TrackedTrain = Train; // no client-side trail (route line instead)

/** One row of a live station departure board. */
export interface BoardService {
  t: number; // epoch seconds at this station
  id: string; // service id — click-through to the train
  from: string | null;
  to: string | null;
  delay_min: number;
}

export interface RailBoard {
  station: string | null;
  crs: string | null;
  total_upcoming: number;
  services: BoardService[];
}

/** A located incident — the Argus spine's unifying entity. */
export interface Incident {
  id: string;
  source: string; // "tfl-road", …
  category: "collision" | "breakdown" | "hazard" | "works" | "delay" | "event" | "aerial" | "other";
  severity: "minor" | "moderate" | "serious";
  confidence: "official" | "inferred" | "reported";
  title: string;
  detail: string | null;
  location: string | null;
  lat: number;
  lon: number;
  url: string | null;
  ts: number;
  updated: number;
}

/** A GB railway station (for the rail layer's station markers). */
export interface RailStation {
  crs: string;
  name: string;
  lat: number;
  lon: number;
}

/** One Underground line: official geometry + live status. */
export interface TubeLine {
  id: string; // TfL line id, e.g. "victoria"
  name: string;
  paths: [number, number][][]; // route polylines incl. branches [lon, lat]
  status: string; // e.g. "Good Service", "Minor Delays"
  severity: number; // TfL statusSeverity — 10 = good service
}

export interface TubeStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[]; // line ids serving this station
}

/** A live Underground train. Position is INFERRED from TfL's arrival
 *  predictions (no GPS exists underground) — indicative by nature. */
export interface TubeTrain {
  id: string; // "{line}:{vehicleId}"
  line: string;
  line_name: string;
  towards: string | null;
  next_station: string | null;
  tts: number | null; // seconds to next station
  current_location: string | null; // TfL's own words
  lat: number | null;
  lon: number | null;
  bearing: number | null;
  speed_kn: number | null;
  ts: number;
}

/** An airport in a flight route (from GET /api/aircraft/{hex}). */
export interface Airport {
  name: string | null;
  iata: string | null;
  icao: string | null;
  municipality: string | null;
  country: string | null;
  country_iso: string | null;
  lat: number | null;
  lon: number | null;
}

/** Static airframe/operator enrichment (adsbdb). */
export interface AircraftInfo {
  registration: string | null;
  type: string | null;
  icao_type: string | null;
  manufacturer: string | null;
  owner: string | null;
  owner_country: string | null;
  owner_country_iso: string | null;
  operator_flag: string | null;
  photo: string | null;
  photo_thumb: string | null;
}

export interface AircraftRoute {
  airline: { name: string | null; icao: string | null; iata: string | null };
  origin: Airport | null;
  destination: Airport | null;
}

/** Response of GET /api/aircraft/{hex} — live record + enrichment. */
export interface AircraftDossier {
  aircraft: Aircraft | null;
  info: AircraftInfo | null;
  route: AircraftRoute | null;
}

/** Claude-vision scene analysis of a camera snapshot (aggregate, anonymous). */
export interface CameraAnalysis {
  congestion: "clear" | "light" | "moderate" | "heavy" | "jam";
  cars: number;
  buses: number;
  trucks: number;
  motorcycles: number;
  cyclists: number;
  pedestrians: number;
  summary: string;
}

/** A London traffic camera (TfL JamCam) — the "land" domain. */
export interface Camera {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  view: string | null; // direction the camera faces, e.g. "West"
  image: string; // JPEG snapshot (refreshed every few minutes)
  video: string | null; // 5-second looped MP4
  available: boolean;
}

/** WebSocket frames from the backend broadcaster. */
export type ServerFrame =
  | { type: "snapshot"; vessels: Vessel[] }
  | { type: "update"; vessels: Vessel[]; removed: number[] }
  | { type: "air_snapshot"; aircraft: Aircraft[] }
  | { type: "air_update"; aircraft: Aircraft[]; removed: string[] }
  | { type: "bus_snapshot"; buses: Bus[] }
  | { type: "bus_update"; buses: Bus[]; removed: string[] }
  | { type: "train_snapshot"; trains: Train[] }
  | { type: "train_update"; trains: Train[]; removed: string[] }
  | { type: "tube_snapshot"; trains: TubeTrain[] }
  | { type: "tube_update"; trains: TubeTrain[]; removed: string[] }
  | { type: "incident_snapshot"; incidents: Incident[] }
  | { type: "incident_update"; incidents: Incident[]; removed: string[] }
  | GeofenceEvent
  | RiskEvent
  | { type: "flagged"; mmsis: number[] }
  | { type: "geofences"; geofences: unknown[]; origin?: string };

export interface ShipTypeGroup {
  key: string;
  label: string;
  color: string;
  ranges: [number, number][];
}

/** A persisted alert (GET /api/alerts) — risk or geofence event. */
export interface Alert {
  id: number;
  ts: number; // epoch seconds
  category: "risk" | "geofence";
  kind: string; // rendezvous|spoof | enter|exit|dwell|speed|dark
  title: string | null;
  mmsi: number | null;
  name: string | null;
  mmsi_b: number | null;
  name_b: string | null;
  lat: number | null;
  lon: number | null;
  fence_id: string | null;
  fence_name: string | null;
  fence_category: string | null;
  detail: Record<string, number | string | null>;
}

export interface AlertsResponse {
  total: number;
  alerts: Alert[];
}

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Per-upstream-source status from GET /api/sources. */
export interface SourceStatus {
  name: string;
  connected: boolean;
  /** Connected AND data actually flowing (false = open socket but silent/stale). */
  receiving?: boolean;
  /** Messages/sec, rolling 5s sample — live throughput for the health readout. */
  msg_rate?: number;
  /** False when required credentials are missing (e.g. AISStream API key). */
  configured?: boolean;
  messages_seen: number;
}
