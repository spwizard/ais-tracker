/**
 * Delay-hotspot layers — the "where's the pain" view. A red-hot heatmap of
 * delayed-train positions weighted by delay minutes, plus labelled rings on
 * the worst clusters with their accumulated delay. Nobody else surfaces
 * where lateness is concentrating on the network live.
 */
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import type { HeatPoint, Hotspot } from "@/hooks/useDelayHotspots";

const HEAT_RANGE: [number, number, number][] = [
  [40, 20, 8],
  [120, 40, 20],
  [200, 70, 30],
  [240, 120, 30],
  [252, 176, 64],
  [255, 230, 150],
];

export interface HotspotLayerOptions {
  points: HeatPoint[];
  hotspots: Hotspot[];
  onClick: (h: Hotspot) => void;
}

export function buildHotspotLayers(opts: HotspotLayerOptions) {
  const { points, hotspots, onClick } = opts;
  if (points.length === 0) return [];
  const layers: unknown[] = [
    new HeatmapLayer<HeatPoint>({
      id: "delay-heat",
      data: points,
      getPosition: (d) => [d.lon, d.lat],
      getWeight: (d) => d.delay,
      radiusPixels: 55,
      intensity: 1,
      threshold: 0.04,
      colorRange: HEAT_RANGE,
      opacity: 0.55,
    }),
    // Clickable rings on the worst clusters.
    new ScatterplotLayer<Hotspot>({
      id: "delay-hotspot-rings",
      data: hotspots,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 8 + Math.min(d.count, 12),
      radiusUnits: "pixels",
      filled: false,
      stroked: true,
      getLineColor: [255, 180, 90, 230],
      lineWidthMinPixels: 2,
      onClick: (info) => {
        const h = info.object as Hotspot | undefined;
        if (h) onClick(h);
      },
    }),
    new TextLayer<Hotspot>({
      id: "delay-hotspot-labels",
      data: hotspots,
      getPosition: (d) => [d.lon, d.lat],
      getText: (d) => `${d.count} late · +${d.delay_sum} min`,
      getSize: 11.5,
      getColor: [255, 226, 184, 245],
      getPixelOffset: [0, -16],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 600,
      outlineColor: [10, 16, 26],
      outlineWidth: 2,
      fontSettings: { sdf: true },
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      // Adjacent clusters (e.g. across London) would stack their labels — keep
      // only non-overlapping ones, worst delay winning.
      extensions: [new CollisionFilterExtension()],
      ...({
        collisionEnabled: true,
        collisionGroup: "delay-hotspot-labels",
        getCollisionPriority: (d: Hotspot) => d.delay_sum,
      } as object),
    }),
  ];
  return layers;
}
