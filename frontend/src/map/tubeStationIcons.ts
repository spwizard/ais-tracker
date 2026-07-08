/**
 * London Underground roundel for tube-station markers — the authentic map
 * convention (red ring + blue bar), drawn into an icon atlas. The full
 * "UNDERGROUND" wordmark is unreadable at marker size, so we use the roundel
 * as TfL does on maps. Two-colour, so not mask-tinted.
 */
import type { IconMapping } from "./busIcons";

export const ROUNDEL_SIZE = 64;

export const ROUNDEL_MAPPING: IconMapping = {
  roundel: {
    x: 0,
    y: 0,
    width: ROUNDEL_SIZE,
    height: ROUNDEL_SIZE,
    anchorX: ROUNDEL_SIZE / 2,
    anchorY: ROUNDEL_SIZE / 2,
    mask: false,
  },
};

const RED = "#E1251F"; // official TfL "corporate red"
const BLUE = "#2233B8"; // TfL blue, lifted a touch so the bar reads on a dark map

let cached: string | null = null;

export function getRoundelAtlas(): string {
  if (cached) return cached;
  const s = ROUNDEL_SIZE;
  const c = s / 2;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;

  // Red ring.
  ctx.strokeStyle = RED;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(c, c, 19, 0, Math.PI * 2);
  ctx.stroke();

  // Blue bar across the middle, extending just past the ring (classic roundel).
  ctx.fillStyle = BLUE;
  ctx.fillRect(5, c - 6.5, s - 10, 13);

  cached = canvas.toDataURL("image/png");
  return cached;
}
