/**
 * Incident layer (Argus spine) — pins for located things-happening, coloured
 * by severity with a soft pulsing halo on serious ones so they draw the eye.
 * Category sets the glyph via an emoji text mark (crash/breakdown/hazard…).
 */
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { incidentTier, type Incident } from "@/types";

export const INCIDENT_MIN_ZOOM = 8;

const SEVERITY_COLOR: Record<string, [number, number, number]> = {
  serious: [244, 63, 94], // rose
  moderate: [251, 146, 60], // orange
  minor: [250, 204, 21], // amber
};

// A camera-verified or human/news-reported incident is more than a dot on a
// map — it wears a coloured ring so it reads apart from routine roadworks.
const RING_COLOR: Record<string, [number, number, number]> = {
  confirmed: [16, 185, 129], // emerald — a camera saw it
  reported: [56, 189, 248], // sky — a named source claims it
};

const GLYPH: Record<string, string> = {
  collision: "✕",
  breakdown: "⚠",
  hazard: "⚠",
  delay: "◷",
  works: "⚒",
  event: "◆",
  aerial: "✚",
  congestion: "≣",
  other: "•",
};

export interface IncidentLayerOptions {
  incidents: Incident[];
  currentTime: number; // for the serious-incident pulse
  zoom: number;
  onClick: (i: Incident | null) => void;
}

const tierOf = (i: Incident) => incidentTier(i);

// Halo/ring subsets cached by input identity — this builder runs on every 10Hz
// animation tick, and a fresh filter each tick would hand deck.gl new array
// references (attribute re-uploads) for data that changes every few minutes.
let _subsets: { src: Incident[]; notable: Incident[]; ringed: Incident[] } | null = null;
function subsetsOf(incidents: Incident[]) {
  if (_subsets?.src !== incidents) {
    _subsets = {
      src: incidents,
      // Draw the eye to what matters: serious incidents, and any human-reported
      // or camera-confirmed one regardless of severity.
      notable: incidents.filter(
        (i) => i.verification !== "cleared" &&
          (i.severity === "serious" || tierOf(i) === "reported" || tierOf(i) === "confirmed"),
      ),
      ringed: incidents.filter(
        (i) => i.verification !== "cleared" && RING_COLOR[tierOf(i)] !== undefined,
      ),
    };
  }
  return _subsets;
}

export function buildIncidentLayers(opts: IncidentLayerOptions) {
  const { incidents, currentTime, zoom, onClick } = opts;
  if (zoom < INCIDENT_MIN_ZOOM || incidents.length === 0) return [];
  const pulse = 0.5 + 0.5 * Math.sin(currentTime * 3);
  const { notable, ringed } = subsetsOf(incidents);

  return [
    // Pulsing halo under everything notable — colour it by credibility so a
    // reported/confirmed incident glows in its own hue, not just severity red.
    new ScatterplotLayer<Incident>({
      id: "incident-halo",
      data: notable,
      getPosition: (d) => [d.lon, d.lat],
      // Pulse via radiusScale (a uniform), not a getRadius trigger — a trigger
      // regenerates the radius attribute for every point every tick.
      getRadius: 1,
      radiusScale: 10 + pulse * 8,
      radiusUnits: "pixels",
      getFillColor: (d) => {
        const c = RING_COLOR[tierOf(d)] ?? SEVERITY_COLOR.serious;
        return [c[0], c[1], c[2], 60];
      },
    }),
    // Crisp credibility ring on reported/confirmed pins — the visual signature
    // that separates a witnessed/verified incident from a routine roadwork.
    new ScatterplotLayer<Incident>({
      id: "incident-rings",
      data: ringed,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.severity === "serious" ? 12 : 10),
      radiusUnits: "pixels",
      radiusMinPixels: 8,
      stroked: true,
      filled: false,
      getLineColor: (d) => {
        const c = RING_COLOR[tierOf(d)] ?? SEVERITY_COLOR.serious;
        return [c[0], c[1], c[2], 230];
      },
      lineWidthMinPixels: 2,
    }),
    // The pin.
    new ScatterplotLayer<Incident>({
      id: "incidents",
      data: incidents,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.severity === "serious" ? 8 : 6),
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      getFillColor: (d) => {
        const c = SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.minor;
        // A camera looked and saw nothing → fade it right back.
        return d.verification === "cleared" ? [c[0], c[1], c[2], 70] : [...c, 255];
      },
      stroked: true,
      getLineColor: [12, 18, 32, 220],
      lineWidthMinPixels: 1.5,
      onClick: (info) => onClick((info.object as Incident) ?? null),
    }),
    // Category glyph on top.
    new TextLayer<Incident>({
      id: "incident-glyph",
      data: incidents,
      getPosition: (d) => [d.lon, d.lat],
      getText: (d) => GLYPH[d.category] ?? "•",
      getSize: 11,
      getColor: [15, 20, 32, 255],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 700,
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
    }),
  ];
}
