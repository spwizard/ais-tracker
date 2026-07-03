/**
 * Bus icon atlas for deck.gl's IconLayer — a small top-down bus (rounded body
 * with a pointed front to show heading), drawn once and tinted via getColor.
 */
export const BUS_ICON_SIZE = 64;

export interface IconMapping {
  [name: string]: {
    x: number;
    y: number;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    mask: boolean;
  };
}

export const BUS_ICON_MAPPING: IconMapping = {
  bus: {
    x: 0,
    y: 0,
    width: BUS_ICON_SIZE,
    height: BUS_ICON_SIZE,
    anchorX: BUS_ICON_SIZE / 2,
    anchorY: BUS_ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

export function getBusIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = BUS_ICON_SIZE;
  canvas.height = BUS_ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 2;

  const cx = BUS_ICON_SIZE / 2;
  // Body: a tall rounded rectangle (nose "up"), with a slightly pointed front.
  ctx.beginPath();
  ctx.moveTo(cx - 11, 20);
  ctx.quadraticCurveTo(cx, 8, cx + 11, 20); // rounded/pointed front
  ctx.lineTo(cx + 11, 48);
  ctx.quadraticCurveTo(cx + 11, 54, cx + 5, 54);
  ctx.lineTo(cx - 5, 54);
  ctx.quadraticCurveTo(cx - 11, 54, cx - 11, 48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Windscreen hint near the front (a thin dark band).
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 8, 22);
  ctx.lineTo(cx + 8, 22);
  ctx.stroke();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
