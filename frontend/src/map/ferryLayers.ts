/**
 * Ferry service-status layer — each route drawn port-to-port, coloured by
 * whether the service is running: calm emerald when normal, amber when
 * be-aware, rose (and heavier) when disrupted. Ports get small anchor dots.
 * The ferries themselves already sail on the AIS layer underneath — these
 * lines carry the *service* story.
 */
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { FerryPort, FerryRoute } from "@/types";

export const FERRY_MIN_ZOOM = 5;

const STATUS_COLOR: Record<string, [number, number, number, number]> = {
  normal: [52, 211, 153, 110], // emerald, quiet
  be_aware: [251, 191, 36, 200], // amber
  disruptions: [244, 63, 94, 230], // rose, loud
};

// Derived arrays cached by input identity — built on every animation tick.
let _derived: {
  routes: FerryRoute[];
  paths: FerryRoute[];
  ports: { port: FerryPort; route: FerryRoute }[];
} | null = null;

function derive(routes: FerryRoute[]) {
  if (_derived?.routes !== routes) {
    // Draw disrupted routes last so they sit on top of calm ones.
    const rank = { normal: 0, be_aware: 1, disruptions: 2 } as Record<string, number>;
    const paths = [...routes].sort((a, b) => (rank[a.status] ?? 0) - (rank[b.status] ?? 0));
    const seen = new Set<string>();
    const ports: { port: FerryPort; route: FerryRoute }[] = [];
    for (const r of paths) {
      for (const p of r.ports) {
        const key = `${p.lat},${p.lon}`;
        if (!seen.has(key)) {
          seen.add(key);
          ports.push({ port: p, route: r });
        }
      }
    }
    _derived = { routes, paths, ports };
  }
  return _derived;
}

export interface FerryLayerOptions {
  routes: FerryRoute[];
  zoom: number;
  selectedId?: string | null;
  onSelect?: (r: FerryRoute | null) => void;
}

export function buildFerryLayers(opts: FerryLayerOptions) {
  const { routes, zoom, selectedId, onSelect } = opts;
  if (zoom < FERRY_MIN_ZOOM || routes.length === 0) return [];
  const { paths, ports } = derive(routes);

  return [
    new PathLayer<FerryRoute>({
      id: "ferry-routes",
      data: paths,
      pickable: Boolean(onSelect),
      getPath: (d) => d.ports.map((p) => [p.lon, p.lat] as [number, number]),
      getColor: (d) => STATUS_COLOR[d.status] ?? STATUS_COLOR.normal,
      getWidth: (d) => (d.status === "disruptions" ? 3.5 : d.id === selectedId ? 3 : 1.8),
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      capRounded: true,
      jointRounded: true,
      onClick: (info) => onSelect?.((info.object as FerryRoute) ?? null),
      updateTriggers: { getWidth: selectedId },
    }),
    new ScatterplotLayer<{ port: FerryPort; route: FerryRoute }>({
      id: "ferry-ports",
      data: ports,
      getPosition: (d) => [d.port.lon, d.port.lat],
      getRadius: 2.5,
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      radiusMaxPixels: 4,
      stroked: true,
      filled: true,
      getFillColor: [15, 23, 42, 230],
      getLineColor: (d) => {
        const c = STATUS_COLOR[d.route.status] ?? STATUS_COLOR.normal;
        return [c[0], c[1], c[2], 255];
      },
      lineWidthMinPixels: 1.5,
    }),
  ];
}
