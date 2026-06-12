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
  /** Free-text finder query (name or MMSI). Drives the results list, not the
   *  map predicate — searching locates vessels rather than hiding the rest. */
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

  return true;
}

export interface VesselMatch {
  vessel: TrackedVessel;
  score: number;
}

/** Rank vessels against a finder query (name or MMSI). Exact → prefix →
 *  substring; name matches rank above MMSI matches. Empty query → []. */
export function searchVessels(vessels: TrackedVessel[], query: string): TrackedVessel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: VesselMatch[] = [];
  for (const v of vessels) {
    const name = (v.name ?? "").toLowerCase();
    const mmsi = String(v.mmsi);
    let score = -1;
    if (name === q || mmsi === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (mmsi.startsWith(q)) score = 2;
    else if (name && name.includes(q)) score = 3;
    else if (mmsi.includes(q)) score = 4;
    if (score >= 0) scored.push({ vessel: v, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.vessel.name ?? "~").localeCompare(b.vessel.name ?? "~"),
  );
  return scored.map((s) => s.vessel);
}
