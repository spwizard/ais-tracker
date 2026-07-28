/**
 * Hazards layer — three quiet registers that only speak when something is
 * genuinely in force:
 *   - Flood-warning areas as translucent polygons (SEPA), coloured by severity.
 *   - Severe-weather warnings as ⚠ glyphs at region centroids (Met Office).
 *   - Recent quakes as magnitude-scaled rings with an M-label (BGS).
 * An empty layer is the expected steady state.
 */
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Hazard } from "@/types";

export const HAZARD_MIN_ZOOM = 4;

const SEVERITY_RGB: Record<string, [number, number, number]> = {
  minor: [250, 204, 21], // amber-yellow
  moderate: [251, 146, 60], // orange
  serious: [244, 63, 94], // rose
};

// Derived subsets cached by input identity (builder runs on every 10Hz tick).
let _derived: {
  hazards: Hazard[];
  floods: GeoJSON.FeatureCollection;
  weather: Hazard[];
  quakes: Hazard[];
} | null = null;

function derive(hazards: Hazard[]) {
  if (_derived?.hazards !== hazards) {
    _derived = {
      hazards,
      floods: {
        type: "FeatureCollection",
        features: hazards
          .filter((h) => h.kind === "flood" && h.geometry)
          .map((h) => ({
            type: "Feature" as const,
            geometry: h.geometry as GeoJSON.Geometry,
            properties: h,
          })),
      },
      weather: hazards.filter((h) => h.kind === "weather"),
      quakes: hazards.filter((h) => h.kind === "quake"),
    };
  }
  return _derived;
}

export interface HazardLayerOptions {
  hazards: Hazard[];
  zoom: number;
}

export function buildHazardLayers(opts: HazardLayerOptions) {
  const { hazards, zoom } = opts;
  if (zoom < HAZARD_MIN_ZOOM || hazards.length === 0) return [];
  const { floods, weather, quakes } = derive(hazards);

  return [
    new GeoJsonLayer({
      id: "hazard-floods",
      data: floods,
      pickable: true,
      stroked: true,
      filled: true,
      getFillColor: (f) => {
        const c = SEVERITY_RGB[(f.properties as Hazard).severity] ?? SEVERITY_RGB.minor;
        return [c[0], c[1], c[2], 60];
      },
      getLineColor: (f) => {
        const c = SEVERITY_RGB[(f.properties as Hazard).severity] ?? SEVERITY_RGB.minor;
        return [c[0], c[1], c[2], 220];
      },
      lineWidthMinPixels: 1.5,
    }),
    new ScatterplotLayer<Hazard>({
      id: "hazard-quake-rings",
      data: quakes,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 4 + (d.magnitude ?? 1) * 3,
      radiusUnits: "pixels",
      radiusMinPixels: 5,
      stroked: true,
      filled: false,
      getLineColor: (d) => {
        const c = SEVERITY_RGB[d.severity] ?? SEVERITY_RGB.minor;
        return [c[0], c[1], c[2], 230];
      },
      lineWidthMinPixels: 2,
    }),
    new TextLayer<Hazard>({
      id: "hazard-quake-labels",
      data: quakes,
      getPosition: (d) => [d.lon, d.lat],
      getText: (d) => `M${d.magnitude ?? "?"}`,
      getSize: 11,
      getPixelOffset: [0, -16],
      getColor: (d) => {
        const c = SEVERITY_RGB[d.severity] ?? SEVERITY_RGB.minor;
        return [c[0], c[1], c[2], 255];
      },
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 700,
    }),
    new TextLayer<Hazard>({
      id: "hazard-weather",
      data: weather,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getText: () => "⚠",
      getSize: 26,
      getColor: (d) => {
        const c = SEVERITY_RGB[d.severity] ?? SEVERITY_RGB.minor;
        return [c[0], c[1], c[2], 255];
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
    }),
  ];
}
