/**
 * Dead reckoning — pure math, no rendering imports, unit-testable in node.
 * Projects a position forward along a course at a speed; used by every moving
 * layer (vessels, aircraft, trains, tube).
 */

// --- dead reckoning ----------------------------------------------------------

const KNOTS_TO_MS = 0.514444;
const EARTH_R = 6_371_000; // metres
// Cap how far ahead we speculate from a stale fix, so a vessel that has gone
// quiet doesn't drift unrealistically across the map. 60s: straight-line
// projection is only trustworthy for about a minute on winding waters — at
// 150s a Thames clipper that went dark at 10kn rendered ~780m inland, sailing
// up Byward Street. Past the cap the vessel holds that projected position.
const MAX_DR_SEC = 60;

/**
 * Project a position forward along the vessel's course at its speed.
 * Returns [lon, lat]. Stationary/unknown-course vessels stay put.
 * Also used by the aircraft layer (track/ground-speed share these units).
 *
 * Pass `out` to reuse an array instead of allocating. deck.gl accessors copy the
 * returned values into typed attribute buffers synchronously, so hot per-item
 * accessors share one scratch array (DR_SCRATCH) — this path runs tens of
 * thousands of times per clock tick, and allocating there dominated GC churn.
 * Do NOT pass the scratch anywhere the result is retained (paths, layer data).
 */
export const DR_SCRATCH: [number, number] = [0, 0];

export function deadReckon(
  lat: number,
  lon: number,
  cog: number | null,
  sog: number | null,
  dtSec: number,
  out?: [number, number],
): [number, number] {
  if (cog == null || sog == null || sog < 0.2) return write(out, lon, lat);
  const t = Math.min(Math.max(dtSec, 0), MAX_DR_SEC);
  const dist = sog * KNOTS_TO_MS * t; // metres travelled
  if (dist < 0.5) return write(out, lon, lat);

  const ang = dist / EARTH_R; // angular distance
  const brng = (cog * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(ang);
  const cosAng = Math.cos(ang);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brng));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * sinAng * cosLat1,
      cosAng - sinLat1 * Math.sin(lat2),
    );

  return write(out, (lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI);
}

function write(out: [number, number] | undefined, lon: number, lat: number): [number, number] {
  if (!out) return [lon, lat];
  out[0] = lon;
  out[1] = lat;
  return out;
}
