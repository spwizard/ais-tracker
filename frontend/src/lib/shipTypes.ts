import type { ShipTypeGroup } from "@/types";

/**
 * Ship-type groups + colors. Mirrors backend app/ship_types.py so the legend,
 * filters, and map colors all agree. Colors are stored as hex and as RGB
 * tuples (deck.gl wants [r,g,b]).
 */
export const SHIP_TYPE_GROUPS: ShipTypeGroup[] = [
  { key: "passenger", label: "Passenger", color: "#38bdf8", ranges: [[60, 69]] },
  { key: "cargo", label: "Cargo", color: "#22c55e", ranges: [[70, 79]] },
  { key: "tanker", label: "Tanker", color: "#ef4444", ranges: [[80, 89]] },
  { key: "highspeed", label: "High-speed", color: "#a855f7", ranges: [[40, 49]] },
  { key: "tug", label: "Tug / Special", color: "#f59e0b", ranges: [[50, 59], [31, 35]] },
  { key: "fishing", label: "Fishing", color: "#14b8a6", ranges: [[30, 30]] },
  { key: "pleasure", label: "Pleasure / Sailing", color: "#ec4899", ranges: [[36, 37]] },
  { key: "other", label: "Other / Unknown", color: "#94a3b8", ranges: [[0, 29], [90, 99]] },
];

const GROUP_BY_KEY = new Map(SHIP_TYPE_GROUPS.map((g) => [g.key, g]));

export function groupKeyFor(shipType: number | null): string {
  if (shipType == null) return "other";
  for (const g of SHIP_TYPE_GROUPS) {
    for (const [lo, hi] of g.ranges) {
      if (shipType >= lo && shipType <= hi) return g.key;
    }
  }
  return "other";
}

export function colorHexFor(shipType: number | null): string {
  return GROUP_BY_KEY.get(groupKeyFor(shipType))?.color ?? "#94a3b8";
}

/** Cached hex -> [r,g,b] conversion for deck.gl getColor accessors. */
const rgbCache = new Map<string, [number, number, number]>();
export function hexToRgb(hex: string): [number, number, number] {
  let cached = rgbCache.get(hex);
  if (cached) return cached;
  const n = parseInt(hex.slice(1), 16);
  cached = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, cached);
  return cached;
}

export function colorRgbFor(shipType: number | null): [number, number, number] {
  return hexToRgb(colorHexFor(shipType));
}

/** Human label for an AIS navigational status code. */
export const NAV_STATUS: Record<number, string> = {
  0: "Under way (engine)",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Fishing",
  8: "Under way (sailing)",
  15: "Undefined",
};
