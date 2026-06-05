/** Geometry helpers: reduce every fence shape to a polygon ring for rendering
 *  and point-in-polygon tests, plus readouts (area, radius). Uses Turf. */
import circle from "@turf/circle";
import area from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon as turfPolygon } from "@turf/helpers";
import type { Geofence } from "./types";

const EARTH_R = 6_371_000;
const M_PER_NM = 1852;

/** Great-circle distance in metres between two [lon,lat] points. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/** Axis-aligned rectangle ring from two opposite corners. */
export function rectRing(
  a: [number, number],
  b: [number, number],
): [number, number][] {
  const [x1, x2] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y1, y2] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];
}

/** A closed polygon ring (lon/lat) representing the fence's footprint. */
export function fenceToRing(f: Geofence): [number, number][] {
  if (f.shape === "circle" && f.center && f.radiusM) {
    const poly = circle(f.center, f.radiusM / 1000, { steps: 64, units: "kilometers" });
    return poly.geometry.coordinates[0] as [number, number][];
  }
  if ((f.shape === "rectangle" || f.shape === "polygon") && f.ring) {
    return closeRing(f.ring);
  }
  // corridor handled in a later phase
  return [];
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Bounding box [minLon, minLat, maxLon, maxLat] for a quick pre-filter. */
export function ringBbox(ring: [number, number][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** A fence compiled once for fast repeated point-in-polygon tests. */
export interface CompiledFence {
  fence: Geofence;
  ring: [number, number][];
  bbox: [number, number, number, number];
  feature: ReturnType<typeof turfPolygon>;
}

export function compileFence(f: Geofence): CompiledFence | null {
  const ring = fenceToRing(f);
  if (ring.length < 4) return null; // need a closed ring
  return { fence: f, ring, bbox: ringBbox(ring), feature: turfPolygon([ring]) };
}

export function containsPoint(c: CompiledFence, lon: number, lat: number): boolean {
  const [minX, minY, maxX, maxY] = c.bbox;
  if (lon < minX || lon > maxX || lat < minY || lat > maxY) return false; // bbox prefilter
  return booleanPointInPolygon(point([lon, lat]), c.feature);
}

/** Area in square nautical miles (for the draw readout). */
export function areaSqNm(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  return area(turfPolygon([closeRing(ring)])) / (M_PER_NM * M_PER_NM);
}

export function metresToNm(m: number): number {
  return m / M_PER_NM;
}
