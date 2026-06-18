import type { Alert } from "@/types";

/** Degrees of lat/lon within which alerts are treated as "the same spot". */
export const ALERT_CLUSTER_DEG = 0.015;

/** Group the alerts stacked at (roughly) the same location as `target`, limited
 *  to those that have already fired at scrub time `maxTs`. Returns the group
 *  (always including `target`) and the index of `target` within it, so the alert
 *  card can page through a cluster. Pure — no React, easy to test. */
export function alertsAt(
  alerts: Alert[],
  target: Alert,
  maxTs: number,
  radiusDeg: number = ALERT_CLUSTER_DEG,
): { group: Alert[]; index: number } {
  if (target.lat == null || target.lon == null) return { group: [target], index: 0 };
  const group = alerts.filter(
    (x) =>
      x.lat != null &&
      x.lon != null &&
      x.ts <= maxTs &&
      Math.abs(x.lat - (target.lat as number)) < radiusDeg &&
      Math.abs(x.lon - (target.lon as number)) < radiusDeg,
  );
  const index = Math.max(
    0,
    group.findIndex((x) => x.id === target.id),
  );
  return { group: group.length ? group : [target], index };
}
