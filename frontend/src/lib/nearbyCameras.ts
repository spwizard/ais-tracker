import type { Bus, Camera } from "@/types";
import { haversineM } from "@/geofence/geometry";

export interface NearbyCamera {
  camera: Camera;
  distM: number;
  facing: boolean; // the camera's view roughly points toward the bus
}

/** TfL camera `view` word ("West", "North East"…) → degrees clockwise from N. */
function viewDeg(v: string | null): number | null {
  if (!v) return null;
  const s = v.toLowerCase();
  const n = s.includes("north");
  const so = s.includes("south");
  const e = s.includes("east");
  const w = s.includes("west");
  if (n && e) return 45;
  if (so && e) return 135;
  if (so && w) return 225;
  if (n && w) return 315;
  if (n) return 0;
  if (e) return 90;
  if (so) return 180;
  if (w) return 270;
  return null;
}

/** Initial bearing from `from` to `to` ([lon, lat]), degrees clockwise from N. */
function bearingDeg(from: [number, number], to: [number, number]): number {
  const p1 = (from[1] * Math.PI) / 180;
  const p2 = (to[1] * Math.PI) / 180;
  const dl = ((to[0] - from[0]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * The nearest available cameras to a bus, within `radiusM`, capped to `n`.
 * Cameras whose view faces the bus are preferred (scored as if closer), so the
 * feeds most likely to actually show it float to the top.
 */
export function nearbyCameras(
  bus: Pick<Bus, "lat" | "lon">,
  cameras: Camera[],
  n = 9,
  radiusM = 900,
): NearbyCamera[] {
  if (bus.lat == null || bus.lon == null) return [];
  const bp: [number, number] = [bus.lon, bus.lat];
  const out: NearbyCamera[] = [];
  for (const c of cameras) {
    if (!c.available) continue;
    const dist = haversineM(bp, [c.lon, c.lat]);
    if (dist > radiusM) continue;
    const vd = viewDeg(c.view);
    let facing = false;
    if (vd != null) {
      const camToBus = bearingDeg([c.lon, c.lat], bp);
      const diff = Math.abs(((camToBus - vd + 540) % 360) - 180);
      facing = diff <= 70;
    }
    out.push({ camera: c, distM: dist, facing });
  }
  out.sort((a, b) => a.distM * (a.facing ? 0.6 : 1) - b.distM * (b.facing ? 0.6 : 1));
  return out.slice(0, n);
}

/**
 * The camera the bus should reach next: the nearest one that lies **ahead** of
 * it — within ~±55° of its heading. Returns the camera id, or null if the bus
 * has no heading or nothing is ahead. `nearby` is expected nearest-first.
 */
export function nextCameraAhead(
  bus: { lat: number | null; lon: number | null; bearing: number | null },
  nearby: NearbyCamera[],
): string | null {
  if (bus.lat == null || bus.lon == null || bus.bearing == null) return null;
  const bp: [number, number] = [bus.lon, bus.lat];
  for (const { camera } of nearby) {
    const brg = bearingDeg(bp, [camera.lon, camera.lat]);
    const diff = Math.abs(((brg - bus.bearing + 540) % 360) - 180);
    if (diff <= 55) return camera.id;
  }
  return null;
}
