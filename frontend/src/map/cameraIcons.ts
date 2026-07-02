/**
 * Camera icon atlas for deck.gl's IconLayer — a single white CCTV-camera glyph
 * (body + lens on a short mount), drawn once and tinted per-marker via getColor.
 */
export const CAM_ICON_SIZE = 64;

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

export const CAMERA_ICON_MAPPING: IconMapping = {
  cam: {
    x: 0,
    y: 0,
    width: CAM_ICON_SIZE,
    height: CAM_ICON_SIZE,
    anchorX: CAM_ICON_SIZE / 2,
    anchorY: CAM_ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

export function getCameraIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = CAM_ICON_SIZE;
  canvas.height = CAM_ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;

  // A rounded camera body, tilted slightly, with a lens hood and a wall mount.
  ctx.save();
  ctx.translate(CAM_ICON_SIZE / 2, CAM_ICON_SIZE / 2);
  // mount post
  ctx.fillRect(-3, 8, 6, 14);
  // body
  ctx.beginPath();
  ctx.roundRect(-18, -12, 30, 18, 5);
  ctx.fill();
  ctx.stroke();
  // lens hood (front)
  ctx.beginPath();
  ctx.roundRect(10, -9, 10, 12, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
