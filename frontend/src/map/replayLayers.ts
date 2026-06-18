import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { ReplayTrack, Alert } from "@/types";
import { colorRgbFor } from "@/lib/shipTypes";
import { HEAT_COLOR_RANGE } from "./layers";
import { getIconAtlas, ICON_MAPPING } from "./vesselIcons";

export type TrailMode = "full" | "comet";
export type ColorMode = "speed" | "type" | "mono";

type RGB = [number, number, number];

// Speed → colour ramp (knots → RGB), tuned to pop on the dark basemap: a muted
// indigo for near-stationary, climbing through cyan/green to a hot red for fast
// transits. Lets the lanes read as "where vessels move fast vs. manoeuvre/loiter".
const SPEED_STOPS: [number, RGB][] = [
  [0, [72, 92, 160]],
  [2, [56, 135, 230]],
  [5, [34, 211, 238]],
  [9, [74, 222, 128]],
  [13, [250, 204, 21]],
  [17, [249, 115, 22]],
  [22, [239, 68, 68]],
];
export const SPEED_RAMP = SPEED_STOPS;
export const SPEED_MAX_KN = 22;

// Monochrome route colour (clean MapWeave-style white-blue).
const MONO: RGB = [210, 225, 255];
const ALERT_COLOR: RGB = [250, 204, 21]; // amber

/** Interpolated colour for a speed-over-ground in knots. */
export function speedColor(sog: number | null): RGB {
  const v = sog ?? 0;
  if (v <= SPEED_STOPS[0][0]) return SPEED_STOPS[0][1];
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [hi, cHi] = SPEED_STOPS[i];
    if (v <= hi) {
      const [lo, cLo] = SPEED_STOPS[i - 1];
      const f = (v - lo) / (hi - lo);
      return [
        Math.round(cLo[0] + (cHi[0] - cLo[0]) * f),
        Math.round(cLo[1] + (cHi[1] - cLo[1]) * f),
        Math.round(cLo[2] + (cHi[2] - cLo[2]) * f),
      ];
    }
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export interface ReplayLayerOptions {
  tracks: ReplayTrack[];
  alerts: Alert[];
  currentTime: number; // epoch seconds, driven by the replay clock
  zoom: number; // map zoom — drives the heads → routes → heat cross-fades
  trailMode: TrailMode; // "full" = persistent revealed routes, "comet" = fading tail
  colorMode: ColorMode;
  movingOnly: boolean; // hide stationary vessels + their tracks
  windowSec: number; // replay window length (the persist-everything trail length)
  selectedMmsi: number | null;
  onClick: (mmsi: number | null) => void;
  onAlertClick: (a: Alert) => void;
}

// In comet mode, how far back the bright tail reaches before fading out — a
// short tail flowing behind each vessel, not a permanent route.
const COMET_SEC = 600;

/** A vessel's interpolated position at the scrub time. */
interface Head {
  mmsi: number;
  ship_type: number | null;
  position: [number, number];
  angle: number; // compass degrees (clockwise from north)
  sog: number; // speed over ground, knots
  moving: boolean;
}

function everMoves(t: ReplayTrack): boolean {
  return t.path.some((p) => (p[3] ?? 0) > 0.5);
}

/**
 * Replay layer stack. The star is the route line each vessel traces as the clock
 * advances. A faint full-route underlay shows the lane structure; a brighter
 * revealed line grows over it; heads ride the front. Rendering is zoom-aware:
 * heads fade out when zoomed out (clean routes for the wide view) and a traffic
 * heat fades in far out, so the whole-region view never becomes a wall of arrows.
 */
export function buildReplayLayers(opts: ReplayLayerOptions) {
  const {
    tracks: allTracks,
    alerts,
    currentTime,
    zoom,
    trailMode,
    colorMode,
    movingOnly,
    windowSec,
    selectedMmsi,
    onClick,
    onAlertClick,
  } = opts;
  const layers: unknown[] = [];

  const tracks = movingOnly ? allTracks.filter(everMoves) : allTracks;

  const persistent = trailMode === "full";
  const trailLength = persistent ? Math.max(windowSec, 60) : COMET_SEC;
  const fadeTrail = !persistent;

  // Zoom cross-fades: routes carry the wide view, heads only the close view, and
  // a traffic heat takes over when zoomed right out.
  const lineOpacity = 0.3 + 0.7 * clamp01((zoom - 4) / 2); // 0.3 @4 → 1 @6+
  const headOpacity = clamp01((zoom - 5.5) / 1.5); // 0 @5.5 → 1 @7+ (visible at Channel zoom)
  const heatOpacity = 1 - clamp01((zoom - 5) / 1.5); // 1 @5 → 0 @6.5+

  // --- colour helpers (per colour mode) ---
  const baseRgb = (d: ReplayTrack): RGB =>
    colorMode === "type" ? colorRgbFor(d.ship_type) : MONO;
  const lineColor =
    colorMode === "speed"
      ? (d: ReplayTrack) => d.path.map((p) => speedColor(p[3]))
      : (d: ReplayTrack) => baseRgb(d);
  const underlayColor =
    colorMode === "speed"
      ? (d: ReplayTrack) =>
          d.path.map((p) => {
            const c = speedColor(p[3]);
            return [c[0], c[1], c[2], 48] as [number, number, number, number];
          })
      : (d: ReplayTrack) => [...baseRgb(d), 48] as [number, number, number, number];
  const headRgb = (d: Head): RGB =>
    colorMode === "speed"
      ? speedColor(d.sog)
      : colorMode === "type"
        ? colorRgbFor(d.ship_type)
        : MONO;

  // 1. Faint full-track underlay — the thin line of the whole route each vessel
  //    took, so you can watch the vessel (and its comet tail) travel along it.
  //    Drawn in both modes; the comet's bright tail rides on top of this.
  if (lineOpacity > 0.01) {
    layers.push(
      new PathLayer<ReplayTrack>({
        id: "replay-routes-base",
        data: tracks,
        getPath: (d) => d.path.map((p) => [p[0], p[1]] as [number, number]),
        getColor: underlayColor,
        opacity: lineOpacity,
        widthMinPixels: 0.7,
        widthMaxPixels: 1.5,
        capRounded: true,
        jointRounded: true,
        updateTriggers: { getColor: colorMode },
      }),
    );
  }

  // 2. Revealed line: a soft glow under a bright core.
  if (lineOpacity > 0.01) {
    const trailProps = {
      data: tracks,
      getPath: (d: ReplayTrack) => d.path.map((p) => [p[0], p[1]] as [number, number]),
      getTimestamps: (d: ReplayTrack) => d.path.map((p) => p[2]),
      getColor: lineColor,
      trailLength,
      currentTime,
      fadeTrail,
      // Flat cap: a rounded cap puts a half-width blob on the leading end that
      // overhangs the vessel's position and reads as a "thick line in front".
      capRounded: false,
      jointRounded: true,
      updateTriggers: { getColor: colorMode },
    } as const;

    layers.push(
      new TripsLayer<ReplayTrack>({
        id: "replay-glow",
        ...trailProps,
        opacity: 0.1 * lineOpacity,
        widthMinPixels: 2,
        widthMaxPixels: 4,
      }),
    );
    layers.push(
      new TripsLayer<ReplayTrack>({
        id: "replay-trails",
        ...trailProps,
        opacity: 0.8 * lineOpacity,
        widthMinPixels: 1,
        widthMaxPixels: 2,
      }),
    );
  }

  // Selected vessel's complete route, neutral white so it reads over the fleet.
  if (selectedMmsi != null) {
    const sel = tracks.find((t) => t.mmsi === selectedMmsi);
    if (sel && sel.path.length >= 2) {
      layers.push(
        new PathLayer<ReplayTrack>({
          id: "replay-route",
          data: [sel],
          getPath: (d) => d.path.map((p) => [p[0], p[1]] as [number, number]),
          getColor: [235, 240, 255, 170],
          widthMinPixels: 1.5,
          widthMaxPixels: 2.5,
          capRounded: true,
          jointRounded: true,
        }),
      );
    }
  }

  // Interpolate each track to the scrub time.
  let heads: Head[] = [];
  for (const t of tracks) {
    const h = interpolate(t, currentTime);
    if (h) heads.push(h);
  }
  if (movingOnly) heads = heads.filter((h) => h.moving);

  // Far-out traffic heat — where the action is, without thousands of marks.
  if (heatOpacity > 0.01 && heads.length > 0) {
    layers.push(
      new HeatmapLayer<Head>({
        id: "replay-heat",
        data: heads,
        getPosition: (d) => d.position,
        getWeight: 1,
        aggregation: "SUM",
        radiusPixels: 34,
        intensity: 1,
        threshold: 0.05,
        colorRange: HEAT_COLOR_RANGE,
        opacity: heatOpacity,
        updateTriggers: { getPosition: currentTime },
      }),
    );
  }

  // Heads (close-zoom only). Glow disc only behind moving/selected to avoid blobs.
  if (headOpacity > 0.01) {
    layers.push(
      new ScatterplotLayer<Head>({
        id: "replay-head-glow",
        data: heads,
        getPosition: (d) => d.position,
        getFillColor: (d) => [...headRgb(d), 70],
        getRadius: (d) => (d.mmsi === selectedMmsi ? 9 : d.moving ? 5 : 0),
        radiusUnits: "pixels",
        opacity: headOpacity,
        stroked: false,
        filled: true,
        updateTriggers: {
          getPosition: currentTime,
          getFillColor: [currentTime, colorMode],
          getRadius: [currentTime, selectedMmsi],
        },
      }),
    );
    layers.push(
      new IconLayer<Head>({
        id: "replay-heads",
        data: heads,
        pickable: true,
        opacity: headOpacity,
        iconAtlas: getIconAtlas(),
        iconMapping: ICON_MAPPING,
        getIcon: (d) => (d.moving ? "arrow" : "dot"),
        getPosition: (d) => d.position,
        // IconLayer angle is counter-clockwise; AIS angles are clockwise-from-north.
        getAngle: (d) => -d.angle,
        getColor: (d) => [...headRgb(d), d.moving ? 255 : 150],
        getSize: (d) => (d.mmsi === selectedMmsi ? 26 : d.moving ? 15 : 9),
        sizeUnits: "pixels",
        sizeMinPixels: 7,
        sizeMaxPixels: 30,
        onClick: (info) => onClick((info.object as Head)?.mmsi ?? null),
        updateTriggers: {
          getPosition: currentTime,
          getAngle: currentTime,
          getIcon: currentTime,
          getColor: [currentTime, colorMode],
          getSize: [currentTime, selectedMmsi],
        },
      }),
    );
  }

  // 3. Alerts surface at the moment they fired (ts <= scrub time): amber halo +
  //    solid core, clickable to select the vessel involved. Always visible.
  const fired = alerts.filter((a) => a.ts <= currentTime && a.lat != null && a.lon != null);
  if (fired.length > 0) {
    layers.push(
      // Ring (not a filled disc) so overlapping alerts read as concentric rings
      // rather than merging into one solid yellow blob at busy spots.
      // The whole disc (ring + a generous invisible hit area) is clickable, so
      // alerts in a tight cluster are easy to grab — not just a 3px centre.
      new ScatterplotLayer<Alert>({
        id: "replay-alert-halo",
        data: fired,
        pickable: true,
        getPosition: (d) => [d.lon as number, d.lat as number],
        filled: true,
        getFillColor: [...ALERT_COLOR, 12], // near-invisible fill enlarges the hit area
        stroked: true,
        getLineColor: [...ALERT_COLOR, 180],
        lineWidthMinPixels: 1.5,
        getRadius: 9,
        radiusUnits: "pixels",
        onClick: (info) => info.object && onAlertClick(info.object as Alert),
        updateTriggers: { getPosition: fired },
      }),
      new ScatterplotLayer<Alert>({
        id: "replay-alert-core",
        data: fired,
        pickable: true,
        getPosition: (d) => [d.lon as number, d.lat as number],
        getFillColor: [...ALERT_COLOR, 255],
        getLineColor: [20, 20, 20, 220],
        stroked: true,
        lineWidthMinPixels: 1,
        getRadius: 3,
        radiusUnits: "pixels",
        onClick: (info) => info.object && onAlertClick(info.object as Alert),
        updateTriggers: { getPosition: fired },
      }),
    );
  }

  return layers;
}

/** Linearly interpolate a track to time `t`. Returns null when `t` falls outside
 *  the track's recorded span (the vessel hasn't appeared yet, or has gone). */
function interpolate(track: ReplayTrack, t: number): Head | null {
  const path = track.path;
  const n = path.length;
  if (n === 0) return null;
  if (t < path[0][2] || t > path[n - 1][2]) return null;

  // Binary search for the segment [i, i+1] bracketing t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid][2] <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const span = b[2] - a[2];
  const f = span > 0 ? (t - a[2]) / span : 0;

  const lon = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const sog = a[3] ?? 0;
  const moving = sog > 0.5;
  // Prefer course/heading from the bracketing fix; fall back to the segment
  // bearing so the arrow always points the way the vessel is travelling.
  const angle = a[4] ?? a[5] ?? bearing(a[0], a[1], b[0], b[1]);

  return { mmsi: track.mmsi, ship_type: track.ship_type, position: [lon, lat], angle, sog, moving };
}

/** Initial great-circle bearing from (lon1,lat1) to (lon2,lat2), degrees. */
function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
