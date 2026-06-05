import { PolygonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import circle from "@turf/circle";
import { hexToRgb } from "@/lib/shipTypes";
import type { CompiledFence } from "@/geofence/geometry";
import { haversineM, rectRing } from "@/geofence/geometry";
import type { FenceShape } from "@/geofence/types";

type Rgb = [number, number, number];

function rgba(hex: string, a: number): [number, number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, a];
}

/** Rendered fences: translucent fill + solid border, brighter when occupied. */
const PULSE_SEC = 3.5; // how long a fence border "pulses" after an event

export function buildFenceLayers(
  compiled: CompiledFence[],
  insideCounts: Record<string, number>,
  selectedId: string | null,
  pickable: boolean,
  onSelect: (id: string) => void,
  flash: Record<string, number>,
  now: number,
): unknown[] {
  const data = compiled.filter((c) => c.fence.visible);
  if (data.length === 0) return [];

  // 0..1 pulse intensity from the most recent event on a fence.
  const pulse = (id: string) => {
    const ts = flash[id];
    return ts ? Math.max(0, 1 - (now - ts) / PULSE_SEC) : 0;
  };

  return [
    new PolygonLayer<CompiledFence>({
      id: "fences",
      data,
      pickable,
      onClick: (info) => {
        if (info.object) onSelect((info.object as CompiledFence).fence.id);
      },
      getPolygon: (c) => c.ring,
      stroked: true,
      filled: true,
      getFillColor: (c) => {
        const occupied = (insideCounts[c.fence.id] ?? 0) > 0;
        return rgba(c.fence.color, (occupied ? 55 : 28) + pulse(c.fence.id) * 60);
      },
      getLineColor: (c) => rgba(c.fence.color, 235),
      getLineWidth: (c) =>
        (c.fence.id === selectedId ? 3 : 1.6) + pulse(c.fence.id) * 5,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 1.5,
      updateTriggers: {
        getFillColor: [insideCounts, flash, now],
        getLineWidth: [selectedId, flash, now],
      },
    }),
  ];
}

export interface DraftState {
  shape: FenceShape;
  points: [number, number][]; // committed click points
  hover: [number, number] | null; // live cursor
  color: string;
}

/** Live preview layers while the user is drawing a fence. */
export function buildDraftLayers(d: DraftState | null): unknown[] {
  if (!d) return [];
  const { shape, points, hover, color } = d;
  const layers: unknown[] = [];
  const accent = hexToRgb(color) as Rgb;

  if (shape === "circle" && points.length === 1 && hover) {
    const r = haversineM(points[0], hover);
    if (r > 1) {
      const ring = circle(points[0], r / 1000, { steps: 64, units: "kilometers" })
        .geometry.coordinates[0] as [number, number][];
      layers.push(draftPolygon("draft-circle", ring, accent));
    }
  } else if (shape === "rectangle" && points.length === 1 && hover) {
    layers.push(draftPolygon("draft-rect", rectRing(points[0], hover), accent));
  } else if (shape === "polygon" && points.length >= 1) {
    const line = hover ? [...points, hover] : points;
    layers.push(
      new PathLayer<{ path: [number, number][] }>({
        id: "draft-poly-line",
        data: [{ path: line }],
        getPath: (p) => p.path,
        getColor: [...accent, 230],
        widthMinPixels: 2,
        getWidth: 2,
      }),
    );
  }

  // Vertex / anchor handles.
  if (points.length > 0) {
    layers.push(
      new ScatterplotLayer<[number, number]>({
        id: "draft-handles",
        data: points,
        getPosition: (p) => p,
        getFillColor: [...accent, 255],
        getLineColor: [255, 255, 255, 255],
        stroked: true,
        lineWidthMinPixels: 1.5,
        getRadius: 5,
        radiusUnits: "pixels",
        radiusMinPixels: 5,
      }),
    );
  }
  return layers;
}

function draftPolygon(id: string, ring: [number, number][], accent: Rgb) {
  return new PolygonLayer<{ ring: [number, number][] }>({
    id,
    data: [{ ring }],
    getPolygon: (d) => d.ring,
    stroked: true,
    filled: true,
    getFillColor: [...accent, 40],
    getLineColor: [...accent, 240],
    getLineWidth: 2,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 2,
  });
}
