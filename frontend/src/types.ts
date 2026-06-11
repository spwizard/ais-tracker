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

/** WebSocket frames from the backend broadcaster. */
export type ServerFrame =
  | { type: "snapshot"; vessels: Vessel[] }
  | { type: "update"; vessels: Vessel[]; removed: number[] }
  | GeofenceEvent
  | RiskEvent
  | { type: "flagged"; mmsis: number[] };

export interface ShipTypeGroup {
  key: string;
  label: string;
  color: string;
  ranges: [number, number][];
}

export type ConnectionStatus = "connecting" | "open" | "closed";

/** Per-upstream-source status from GET /api/sources. */
export interface SourceStatus {
  name: string;
  connected: boolean;
  /** False when required credentials are missing (e.g. AISStream API key). */
  configured?: boolean;
  messages_seen: number;
}
