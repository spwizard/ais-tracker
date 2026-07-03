/** Helpers for a TfL camera `view` string ("West", "North East", …). */

const ORDER = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Short compass label for a view string, or "" if unknown. */
export function compassLabel(view: string | null): string {
  if (!view) return "";
  const s = view.toLowerCase();
  const n = s.includes("north");
  const so = s.includes("south");
  const e = s.includes("east");
  const w = s.includes("west");
  if (n && e) return "NE";
  if (so && e) return "SE";
  if (so && w) return "SW";
  if (n && w) return "NW";
  if (n) return "N";
  if (e) return "E";
  if (so) return "S";
  if (w) return "W";
  return "";
}

/** Sort key so cameras facing the same way group together (unknowns last). */
export function compassOrder(view: string | null): number {
  const l = compassLabel(view);
  const i = l ? ORDER.indexOf(l) : -1;
  return i === -1 ? 99 : i;
}
