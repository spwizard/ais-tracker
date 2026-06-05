/** Geofence domain model (frontend). Mirrors the eventual backend schema and
 *  serialises cleanly to GeoJSON for portability. */

export type FenceShape = "circle" | "rectangle" | "polygon" | "corridor";

export type FenceCategory =
  | "custom"
  | "port"
  | "anchorage"
  | "restricted"
  | "environmental";

export type TriggerKind = "enter" | "exit" | "dwell" | "speed" | "dark";

export interface FenceTrigger {
  on: TriggerKind;
  /** dwell threshold in seconds (for on === "dwell"). */
  dwellSec?: number;
  /** speed threshold in knots (for on === "speed"). */
  speedKn?: number;
  /** whether the speed alert fires above or below the threshold. */
  speedOp?: "over" | "under";
  /** silence before a vessel counts as "gone dark" (for on === "dark"). */
  darkSec?: number;
}

export interface Geofence {
  id: string;
  name: string;
  category: FenceCategory;
  shape: FenceShape;
  color: string; // hex
  visible: boolean;
  triggers: FenceTrigger[];

  // Parametric source-of-truth (depends on shape). Lon/lat order throughout.
  center?: [number, number]; // circle
  radiusM?: number; // circle
  ring?: [number, number][]; // rectangle / polygon outer ring (open, lon/lat)
  path?: [number, number][]; // corridor centre-line
  bufferM?: number; // corridor half-width
}

export interface FenceCategoryDef {
  key: FenceCategory;
  label: string;
  color: string;
}

export const FENCE_CATEGORIES: FenceCategoryDef[] = [
  { key: "custom", label: "Custom area", color: "#22d3ee" },
  { key: "port", label: "Port / terminal", color: "#22c55e" },
  { key: "anchorage", label: "Anchorage", color: "#f59e0b" },
  { key: "restricted", label: "Restricted / no-go", color: "#ef4444" },
  { key: "environmental", label: "Environmental", color: "#14b8a6" },
];

export function categoryColor(cat: FenceCategory): string {
  return FENCE_CATEGORIES.find((c) => c.key === cat)?.color ?? "#22d3ee";
}
