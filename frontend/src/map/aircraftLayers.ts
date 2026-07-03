/**
 * Air-traffic (ADS-B) deck.gl layer. A single IconLayer of plane glyphs,
 * rotated by ground track, tinted by altitude, and dead-reckoned forward from
 * the last fix so they glide between polls (aircraft move ~10× faster than
 * ships, so interpolation matters more here). Sibling to `buildLayers`, kept in
 * its own module so the air domain stays cleanly separated from vessels.
 */
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { GreatCircleLayer } from "@deck.gl/geo-layers";
import type { TrackedAircraft } from "@/types";
import { deadReckon, DR_SCRATCH } from "./layers";
import { getAircraftIconAtlas, AIRCRAFT_ICON_MAPPING } from "./aircraftIcons";

/** The selected aircraft's origin → destination airports, for the map overlay. */
export interface AirRoute {
  from: [number, number]; // origin [lon, lat]
  to: [number, number]; // destination [lon, lat]
  fromLabel: string;
  toLabel: string;
}

export interface AircraftLayerOptions {
  aircraft: TrackedAircraft[];
  currentTime: number; // epoch seconds, animated for the dead-reckoning glide
  selectedHex: string | null;
  onClick: (a: TrackedAircraft | null) => void;
}

// Altitude → colour ramp (feet): warm amber on the deck, through green and cyan,
// to violet in the flight levels. Reads at a glance as a vertical "heat" scale.
const ALT_STOPS: [number, [number, number, number]][] = [
  [0, [255, 176, 66]], // ground / low — amber
  [8000, [130, 224, 120]], // green
  [20000, [86, 200, 240]], // cyan
  [34000, [120, 150, 246]], // blue
  [45000, [176, 130, 244]], // violet
];

function altColor(alt: number | null): [number, number, number] {
  if (alt == null) return [200, 200, 205]; // on the ground / unknown — grey
  if (alt <= ALT_STOPS[0][0]) return ALT_STOPS[0][1];
  const last = ALT_STOPS[ALT_STOPS.length - 1];
  if (alt >= last[0]) return last[1];
  for (let i = 1; i < ALT_STOPS.length; i++) {
    const [a1, c1] = ALT_STOPS[i - 1];
    const [a2, c2] = ALT_STOPS[i];
    if (alt <= a2) {
      const f = (alt - a1) / (a2 - a1);
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * f),
        Math.round(c1[1] + (c2[1] - c1[1]) * f),
        Math.round(c1[2] + (c2[2] - c1[2]) * f),
      ];
    }
  }
  return last[1];
}

export function buildAircraftLayers(opts: AircraftLayerOptions) {
  const { aircraft, currentTime, selectedHex, onClick } = opts;
  if (aircraft.length === 0) return [];

  return [
    new IconLayer<TrackedAircraft>({
      id: "aircraft",
      data: aircraft,
      pickable: true,
      iconAtlas: getAircraftIconAtlas(),
      iconMapping: AIRCRAFT_ICON_MAPPING,
      // On the ground or without a track → a dot; airborne → the plane glyph.
      getIcon: (d) => (d.on_ground || d.track == null ? "dot" : "plane"),
      getPosition: (d) =>
        deadReckon(d.lat as number, d.lon as number, d.track, d.gs, currentTime - d.ts, DR_SCRATCH),
      // IconLayer angle is counter-clockwise; ADS-B track is clockwise-from-north.
      getAngle: (d) => -(d.track ?? 0),
      getColor: (d) => altColor(d.alt_baro),
      getSize: (d) => (d.hex === selectedHex ? 32 : 22),
      sizeUnits: "pixels",
      sizeMinPixels: 12,
      sizeMaxPixels: 40,
      onClick: (info) => onClick((info.object as TrackedAircraft) ?? null),
      updateTriggers: {
        getPosition: currentTime,
        getColor: currentTime,
        getIcon: currentTime,
        getAngle: currentTime,
        getSize: selectedHex,
      },
    }),
  ];
}

/** The selected aircraft's flight path: a great-circle arc between its origin
 *  and destination airports, plus labelled airport markers. */
export function buildRouteLayers(route: AirRoute | null) {
  if (!route) return [];
  const ends = [
    { pos: route.from, label: route.fromLabel },
    { pos: route.to, label: route.toLabel },
  ];
  return [
    new GreatCircleLayer<{ from: [number, number]; to: [number, number] }>({
      id: "air-route",
      data: [{ from: route.from, to: route.to }],
      getSourcePosition: (d) => d.from,
      getTargetPosition: (d) => d.to,
      getSourceColor: [255, 176, 66],
      getTargetColor: [125, 211, 252],
      getWidth: 2,
      widthMinPixels: 2,
    }),
    new ScatterplotLayer<{ pos: [number, number] }>({
      id: "air-route-airports",
      data: ends,
      getPosition: (d) => d.pos,
      getRadius: 5,
      radiusUnits: "pixels",
      getFillColor: [125, 211, 252],
      stroked: true,
      getLineColor: [10, 16, 26],
      lineWidthMinPixels: 1.5,
    }),
    new TextLayer<{ pos: [number, number]; label: string }>({
      id: "air-route-labels",
      data: ends,
      getPosition: (d) => d.pos,
      getText: (d) => d.label,
      getSize: 12,
      getColor: [230, 238, 247],
      getPixelOffset: [0, -12],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 600,
      outlineColor: [10, 16, 26],
      outlineWidth: 2,
      fontSettings: { sdf: true },
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
    }),
  ];
}
