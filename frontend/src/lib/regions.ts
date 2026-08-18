/**
 * Regions — the front door of Argus Eyes.
 *
 * A visitor cares about one place, so *place* is the primary control: picking a
 * region is the only thing that flies the map, and it lights the eyes that make
 * sense there. Layer switches never move the camera. Everything else (deep
 * links, the incidents rail's scope, per-region defaults) hangs off this table.
 *
 * `bounds` are generous — they decide when the picker reads "Custom view" as
 * you pan away, and scope the incidents rail; they are not a hard fence.
 */
import type { LayerKey } from "./layers";

export type RegionId = "gb" | "london" | "scotland";

export interface RegionView {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface RegionProfile {
  id: RegionId;
  label: string;
  /** One-line "what this place is about" for the picker. */
  tagline: string;
  view: RegionView;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
  /** Eyes switched on when you arrive. Everything else goes off — a scene. */
  eyes: LayerKey[];
}

export const REGIONS: RegionProfile[] = [
  {
    id: "gb",
    label: "Great Britain",
    tagline: "sea · rail · roads",
    view: { longitude: -2.8, latitude: 54.7, zoom: 5.5 },
    bounds: [-11.5, 49.0, 3.5, 61.5],
    eyes: ["vessels", "incidents", "cameras"],
  },
  {
    id: "london",
    label: "London",
    tagline: "incidents · cameras · tube",
    view: { longitude: -0.11, latitude: 51.5, zoom: 11 },
    bounds: [-0.65, 51.2, 0.4, 51.8],
    eyes: ["incidents", "cameras", "tube"],
  },
  {
    id: "scotland",
    label: "Scotland",
    tagline: "roads · ferries · coast",
    view: { longitude: -4.3, latitude: 56.8, zoom: 6.3 },
    bounds: [-8.5, 54.5, 0.0, 61.2],
    eyes: ["incidents", "cameras", "ferry", "vessels", "bus"],
  },
];

export const DEFAULT_REGION: RegionId = "gb";

export function regionById(id: string | null | undefined): RegionProfile | null {
  return REGIONS.find((r) => r.id === id) ?? null;
}

/** Legacy `?region=` slugs that predate the picker — keep old links working. */
export const LEGACY_REGION_VIEWS: Record<string, RegionView> = {
  channel: { longitude: -1.0, latitude: 50.2, zoom: 7.2 },
};

/** Is a lon/lat inside a region's (generous) bounds? */
export function inBounds(
  b: [number, number, number, number],
  lon: number,
  lat: number,
): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Do two [w,s,e,n] boxes overlap at all? */
export function boundsIntersect(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Region views are tuned for a laptop; phones show a narrower slice of the
 *  world at the same zoom, so back off a little to keep the whole place in. */
export function viewFor(view: RegionView, narrow: boolean): RegionView {
  return narrow ? { ...view, zoom: view.zoom - 0.8 } : view;
}
