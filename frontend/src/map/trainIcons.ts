/**
 * Train icon atlas for deck.gl's IconLayer — a top-down train: a long body
 * with an angled nose (heading) and a cab window band, tinted via getColor.
 */
export const TRAIN_ICON_SIZE = 64;

import type { IconMapping } from "./busIcons";

export const TRAIN_ICON_MAPPING: IconMapping = {
  train: {
    x: 0,
    y: 0,
    width: TRAIN_ICON_SIZE,
    height: TRAIN_ICON_SIZE,
    anchorX: TRAIN_ICON_SIZE / 2,
    anchorY: TRAIN_ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

export function getTrainIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = TRAIN_ICON_SIZE;
  canvas.height = TRAIN_ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 2;

  const cx = TRAIN_ICON_SIZE / 2;
  // Body: long slim rectangle with a wedge nose (nose "up").
  ctx.beginPath();
  ctx.moveTo(cx, 6); // nose tip
  ctx.lineTo(cx + 8, 16);
  ctx.lineTo(cx + 8, 56);
  ctx.lineTo(cx - 8, 56);
  ctx.lineTo(cx - 8, 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cab window band + a mid-body articulation gap.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 6, 19);
  ctx.lineTo(cx + 6, 19);
  ctx.moveTo(cx - 8, 37);
  ctx.lineTo(cx + 8, 37);
  ctx.stroke();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
