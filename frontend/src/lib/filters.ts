import type { TrackedVessel } from "@/types";
import { groupKeyFor, SHIP_TYPE_GROUPS } from "./shipTypes";

export type StatusFilter = "all" | "sailing" | "docked" | "anchored";

export const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "sailing", label: "Sailing" },
  { key: "docked", label: "Docked" },
  { key: "anchored", label: "Anchored" },
];

export interface Filters {
  /** Quick navigational-status segment (mirrors the reference top bar). */
  status: StatusFilter;
  /** Enabled ship-type group keys. */
  groups: Set<string>;
  /** [minKnots, maxKnots]. */
  speed: [number, number];
  /** Free-text match on name or MMSI. */
  search: string;
}

export const SPEED_MAX = 40;

export function defaultFilters(): Filters {
  return {
    status: "all",
    groups: new Set(SHIP_TYPE_GROUPS.map((g) => g.key)),
    speed: [0, SPEED_MAX],
    search: "",
  };
}

function matchesStatus(v: TrackedVessel, status: StatusFilter): boolean {
  if (status === "all") return true;
  const ns = v.nav_status;
  const sog = v.sog ?? 0;
  switch (status) {
    case "sailing": // under way (engine/sailing), or moving with no status
      return ns === 0 || ns === 8 || (ns == null && sog > 0.5);
    case "docked": // moored / alongside
      return ns === 5;
    case "anchored":
      return ns === 1;
  }
}

export function matchesFilter(v: TrackedVessel, f: Filters): boolean {
  if (!matchesStatus(v, f.status)) return false;
  if (!f.groups.has(groupKeyFor(v.ship_type))) return false;

  const sog = v.sog ?? 0;
  // Upper bound is inclusive of "max+" (anything >= SPEED_MAX passes the top).
  if (sog < f.speed[0]) return false;
  if (f.speed[1] < SPEED_MAX && sog > f.speed[1]) return false;

  if (f.search) {
    const q = f.search.toLowerCase();
    const name = (v.name ?? "").toLowerCase();
    if (!name.includes(q) && !String(v.mmsi).includes(q)) return false;
  }
  return true;
}
