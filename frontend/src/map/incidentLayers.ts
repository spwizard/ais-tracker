/**
 * Incident layer (Argus spine) — pins for located things-happening, coloured
 * by severity with a soft pulsing halo on serious ones so they draw the eye.
 * Category sets the glyph via an emoji text mark (crash/breakdown/hazard…).
 */
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Incident } from "@/types";

export const INCIDENT_MIN_ZOOM = 8;

const SEVERITY_COLOR: Record<string, [number, number, number]> = {
  serious: [244, 63, 94], // rose
  moderate: [251, 146, 60], // orange
  minor: [250, 204, 21], // amber
};

const GLYPH: Record<string, string> = {
  collision: "✕",
  breakdown: "⚠",
  hazard: "⚠",
  delay: "◷",
  works: "⚒",
  event: "◆",
  aerial: "✚",
  other: "•",
};

export interface IncidentLayerOptions {
  incidents: Incident[];
  currentTime: number; // for the serious-incident pulse
  zoom: number;
  onClick: (i: Incident | null) => void;
}

export function buildIncidentLayers(opts: IncidentLayerOptions) {
  const { incidents, currentTime, zoom, onClick } = opts;
  if (zoom < INCIDENT_MIN_ZOOM || incidents.length === 0) return [];
  const pulse = 0.5 + 0.5 * Math.sin(currentTime * 3);
  const serious = incidents.filter((i) => i.severity === "serious");

  return [
    // Pulsing halo under serious incidents.
    new ScatterplotLayer<Incident>({
      id: "incident-halo",
      data: serious,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10 + pulse * 8,
      radiusUnits: "pixels",
      getFillColor: [244, 63, 94, 60],
      updateTriggers: { getRadius: currentTime },
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
      getFillColor: (d) => SEVERITY_COLOR[d.severity] ?? SEVERITY_COLOR.minor,
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
