/**
 * Rail-station icon atlas — the genuine National Rail double arrow, drawn
 * from the public-domain SVG geometry (Wikimedia Commons: a 62x39 logo box
 * containing one zig-zag stroke and two bar strokes, clipped to the box).
 * Mask-tinted via getColor. The symbol itself remains a DfT trademark: its
 * conventional use is denoting stations on maps, but a brand licence belongs
 * on the commercialisation checklist.
 */
import type { IconMapping } from "./busIcons";

export const STATION_ICON_SIZE = 64;

export const STATION_ICON_MAPPING: IconMapping = {
  station: {
    x: 0,
    y: 0,
    width: STATION_ICON_SIZE,
    height: STATION_ICON_SIZE,
    anchorX: STATION_ICON_SIZE / 2,
    anchorY: STATION_ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

export function getStationIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = STATION_ICON_SIZE;
  canvas.height = STATION_ICON_SIZE;
  const ctx = canvas.getContext("2d")!;

  // Authentic geometry, scaled and centred into the square atlas cell.
  const k = 60 / 62;
  const ox = 2;
  const oy = (STATION_ICON_SIZE - 39 * k) / 2;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.rect(0, 0, 62, 39);
  ctx.clip();
  ctx.strokeStyle = "#ffffff"; // mask — tinted by the layer's getColor
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(1, -8.9);
  ctx.lineTo(46, 12.4);
  ctx.lineTo(16, 26.6);
  ctx.lineTo(61, 47.9);
  ctx.stroke();
  ctx.lineWidth = 6.4;
  ctx.beginPath();
  ctx.moveTo(0, 12.4);
  ctx.lineTo(62, 12.4);
  ctx.moveTo(0, 26.6);
  ctx.lineTo(62, 26.6);
  ctx.stroke();
  ctx.restore();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
