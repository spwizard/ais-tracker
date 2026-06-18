// Pure, dependency-free replay maths (no deck.gl / weatherlayers imports) so it
// stays cheap to unit-test and reuse. The layer-building lives in replayLayers.ts.
import type { ReplayTrack } from "@/types";

export type TrailMode = "full" | "comet";
export type ColorMode = "speed" | "type" | "mono";

export type RGB = [number, number, number];

// Speed → colour ramp (knots → RGB), tuned to pop on the dark basemap: a muted
// indigo for near-stationary, climbing through cyan/green to a hot red for fast
// transits. Lets the lanes read as "where vessels move fast vs. manoeuvre/loiter".
const SPEED_STOPS: [number, RGB][] = [
  [0, [72, 92, 160]],
  [2, [56, 135, 230]],
  [5, [34, 211, 238]],
  [9, [74, 222, 128]],
  [13, [250, 204, 21]],
  [17, [249, 115, 22]],
  [22, [239, 68, 68]],
];
export const SPEED_RAMP = SPEED_STOPS;
export const SPEED_MAX_KN = 22;

// Monochrome route colour (clean MapWeave-style white-blue).
export const MONO: RGB = [210, 225, 255];

/** Interpolated colour for a speed-over-ground in knots. */
export function speedColor(sog: number | null): RGB {
  const v = sog ?? 0;
  if (v <= SPEED_STOPS[0][0]) return SPEED_STOPS[0][1];
  for (let i = 1; i < SPEED_STOPS.length; i++) {
    const [hi, cHi] = SPEED_STOPS[i];
    if (v <= hi) {
      const [lo, cLo] = SPEED_STOPS[i - 1];
      const f = (v - lo) / (hi - lo);
      return [
        Math.round(cLo[0] + (cHi[0] - cLo[0]) * f),
        Math.round(cLo[1] + (cHi[1] - cLo[1]) * f),
        Math.round(cLo[2] + (cHi[2] - cLo[2]) * f),
      ];
    }
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1][1];
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Advance the replay clock by `dtSec` at `speed`×, looping back to `start` once
 *  it reaches `end` (or somehow falls below `start`). Pure for testability. */
export function advanceClock(
  time: number,
  dtSec: number,
  speed: number,
  start: number,
  end: number,
): number {
  const next = time + dtSec * speed;
  return next >= end || next < start ? start : next;
}

/** A vessel's interpolated position at the scrub time. */
export interface Head {
  mmsi: number;
  ship_type: number | null;
  position: [number, number];
  angle: number; // compass degrees (clockwise from north)
  sog: number; // speed over ground, knots
  moving: boolean;
}

/** Linearly interpolate a track to time `t`. Returns null when `t` falls outside
 *  the track's recorded span (the vessel hasn't appeared yet, or has gone). */
export function interpolate(track: ReplayTrack, t: number): Head | null {
  const path = track.path;
  const n = path.length;
  if (n === 0) return null;
  if (t < path[0][2] || t > path[n - 1][2]) return null;

  // Binary search for the segment [i, i+1] bracketing t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid][2] <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const span = b[2] - a[2];
  const f = span > 0 ? (t - a[2]) / span : 0;

  const lon = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const sog = a[3] ?? 0;
  const moving = sog > 0.5;
  // Prefer course/heading from the bracketing fix; fall back to the segment
  // bearing so the arrow always points the way the vessel is travelling.
  const angle = a[4] ?? a[5] ?? bearing(a[0], a[1], b[0], b[1]);

  return { mmsi: track.mmsi, ship_type: track.ship_type, position: [lon, lat], angle, sog, moving };
}

/** Initial great-circle bearing from (lon1,lat1) to (lon2,lat2), degrees. */
export function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
