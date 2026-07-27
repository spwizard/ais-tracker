/**
 * Wildfire layer (fire domain) — NASA FIRMS thermal detections rendered as a
 * living ember field. Three registers stacked for depth:
 *   1. A heatmap bloom weighted by fire radiative power — the glow that reads
 *      from continental zoom, so you see *where the country is burning* at a
 *      glance.
 *   2. Per-pixel cores coloured along a heat ramp (deep ember → white-hot),
 *      so individual detections have texture up close.
 *   3. A slow pulsing halo on the fiercest fires (high FRP), drawing the eye
 *      to what actually matters.
 * Colour encodes intensity (FRP, megawatts); nighttime passes read cooler.
 */
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import type { FireDetection, FireComplex } from "@/types";

export const FIRE_MIN_ZOOM = 3; // fires are regional — visible whenever toggled

// FRP (MW) → heat colour. Deep ember at low power to white-hot at extreme.
const HEAT_RANGE: [number, number, number][] = [
  [90, 22, 12],
  [176, 34, 22],
  [239, 68, 68],
  [249, 115, 22],
  [251, 191, 36],
  [255, 240, 207],
];

const FRP_STOPS: [number, [number, number, number]][] = [
  [0, [150, 34, 20]],
  [40, [220, 60, 32]],
  [120, [239, 88, 60]],
  [250, [249, 132, 40]],
  [400, [251, 200, 90]],
  [600, [255, 244, 214]],
];

function frpColor(frp: number): [number, number, number] {
  if (frp <= FRP_STOPS[0][0]) return FRP_STOPS[0][1];
  for (let i = 1; i < FRP_STOPS.length; i++) {
    if (frp <= FRP_STOPS[i][0]) {
      const [a, ca] = FRP_STOPS[i - 1];
      const [b, cb] = FRP_STOPS[i];
      const t = (frp - a) / (b - a);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
      ];
    }
  }
  return FRP_STOPS[FRP_STOPS.length - 1][1];
}

const BIG_FIRE_FRP = 100; // detections above this get a pulsing halo

const CELL_DEG = 0.15; // must match the backend clustering grid (fire/cluster.py)

// Derived subsets, cached by (fires, complexes) identity — this builder runs on
// every 10Hz animation tick; recomputing fresh each tick would hand deck.gl new
// array references (attribute re-uploads) for data that changes every ~15 min.
let _derived: {
  fires: FireDetection[];
  complexes: FireComplex[];
  visible: FireDetection[];
  big: FireDetection[];
  industrial: FireComplex[];
} | null = null;

function derive(fires: FireDetection[], complexes: FireComplex[]) {
  if (_derived?.fires !== fires || _derived?.complexes !== complexes) {
    const industrial = complexes.filter((c) => c.kind === "industrial");
    // The ember field glows only where the clustering believes a wildfire is.
    // Raw pixels the backend rejected — refinery flares, solar glint, one-off
    // field burns — and pixels of industrial complexes render no embers (the
    // slate marker carries those). Until the first complex list arrives, show
    // everything rather than a briefly-blank map.
    const wildfireCells = new Set<string>();
    for (const c of complexes) {
      if (c.kind === "industrial") continue;
      for (const [x, y] of c.cells ?? []) wildfireCells.add(`${x},${y}`);
    }
    const visible = complexes.length
      ? fires.filter((f) =>
          wildfireCells.has(
            `${Math.round(f.lat / CELL_DEG)},${Math.round(f.lon / CELL_DEG)}`,
          ),
        )
      : fires;
    _derived = {
      fires,
      complexes,
      visible,
      big: visible.filter((f) => f.frp >= BIG_FIRE_FRP),
      industrial,
    };
  }
  return _derived;
}

export interface FireLayerOptions {
  fires: FireDetection[];
  complexes: FireComplex[]; // clustered truth — gates the ember field
  currentTime: number; // drives the halo pulse
  zoom: number;
  onClick?: (f: FireDetection | null) => void;
  onSelectComplex?: (c: FireComplex | null) => void;
}

export function buildFireLayers(opts: FireLayerOptions) {
  const { fires, complexes, currentTime, zoom, onClick, onSelectComplex } = opts;
  if (zoom < FIRE_MIN_ZOOM || fires.length === 0) return [];
  const { visible, big, industrial } = derive(fires, complexes);

  // Suspected industrial / persistent thermal sources — a calm slate marker so a
  // power station never reads as a wildfire. Sits above the ember field.
  const industrialLayer =
    industrial.length
      ? new ScatterplotLayer<FireComplex>({
          id: "fire-industrial",
          data: industrial,
          pickable: Boolean(onSelectComplex),
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 6,
          radiusUnits: "pixels",
          radiusMinPixels: 6,
          radiusMaxPixels: 9,
          stroked: true,
          filled: true,
          getFillColor: [51, 65, 85, 240], // slate-700
          getLineColor: [203, 213, 225, 240], // slate-300 ring
          lineWidthMinPixels: 2,
          onClick: (info) => onSelectComplex?.((info.object as FireComplex) ?? null),
        })
      : null;

  // High-confidence weighting: a "high" pixel counts a little heavier so a
  // confirmed front glows brighter than scattered nominal noise.
  const weightOf = (d: FireDetection) =>
    d.frp * (d.confidence === "high" ? 1.35 : d.confidence === "low" ? 0.7 : 1);

  const pulse = 0.5 + 0.5 * Math.sin(currentTime * 2.2);
  // Cores get denser/larger as you zoom in; kept tiny at continental zoom so the
  // heatmap bloom carries the wide view.
  const coreRadius = zoom < 6 ? 1.4 : zoom < 9 ? 2.2 : 3.4;

  return [
    // 1. The bloom — where the land is burning, visible from far out.
    new HeatmapLayer<FireDetection>({
      id: "fire-heat",
      data: visible,
      getPosition: (d) => [d.lon, d.lat],
      getWeight: weightOf,
      aggregation: "SUM",
      radiusPixels: zoom < 6 ? 34 : 46,
      intensity: 1.3,
      threshold: 0.03,
      colorRange: HEAT_RANGE,
      opacity: 0.85,
    }),
    // 2. Pulsing halo under the fiercest fires — the eye-magnet, and a big,
    //    tap-friendly hit target for selecting a fire on the map.
    new ScatterplotLayer<FireDetection>({
      id: "fire-halo",
      data: big,
      pickable: Boolean(onClick),
      getPosition: (d) => [d.lon, d.lat],
      // Pulse via radiusScale (a uniform) rather than a getRadius updateTrigger:
      // a trigger regenerates the radius attribute for every point every tick,
      // a uniform costs nothing.
      getRadius: 1,
      radiusScale: 6 + pulse * 7,
      radiusUnits: "pixels",
      radiusMinPixels: 10, // generous touch target
      getFillColor: (d) => {
        const c = frpColor(d.frp);
        return [c[0], c[1], c[2], 55];
      },
      onClick: (info) => onClick?.((info.object as FireDetection) ?? null),
    }),
    // 3. Per-pixel hot cores — texture + the pickable detection.
    new ScatterplotLayer<FireDetection>({
      id: "fire-cores",
      data: visible,
      pickable: Boolean(onClick),
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.frp >= BIG_FIRE_FRP ? coreRadius * 1.5 : coreRadius),
      radiusUnits: "pixels",
      radiusMinPixels: 1,
      radiusMaxPixels: 7,
      getFillColor: (d) => {
        const c = frpColor(d.frp);
        // Nighttime passes read a touch cooler (dimmer alpha).
        return [c[0], c[1], c[2], d.daynight === "N" ? 190 : 235];
      },
      onClick: (info) => onClick?.((info.object as FireDetection) ?? null),
      updateTriggers: { getRadius: coreRadius },
    }),
    ...(industrialLayer ? [industrialLayer] : []),
  ];
}
