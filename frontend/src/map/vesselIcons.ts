/**
 * Vessel icon atlas for deck.gl's IconLayer.
 *
 * We draw two white shapes on a canvas once at startup:
 *   - "arrow": a directional chevron for vessels that are moving / have a heading
 *   - "dot":   a round marker for stationary vessels with no heading
 * Being white, both can be tinted per-vessel via IconLayer's `getColor`, so a
 * single texture serves every ship-type color — fast and memory-cheap.
 */
export const ICON_SIZE = 64;

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

export const ICON_MAPPING: IconMapping = {
  arrow: {
    x: 0,
    y: 0,
    width: ICON_SIZE,
    height: ICON_SIZE,
    anchorX: ICON_SIZE / 2,
    anchorY: ICON_SIZE / 2,
    mask: true, // allow getColor tinting
  },
  dot: {
    x: ICON_SIZE,
    y: 0,
    width: ICON_SIZE,
    height: ICON_SIZE,
    anchorX: ICON_SIZE / 2,
    anchorY: ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

/** Build (once) and return the icon atlas as a data-URL string. */
export function getIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE * 2;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 2;

  // --- arrow (pointing "up" = 0deg; IconLayer rotates by heading) ---
  const c = ICON_SIZE / 2;
  ctx.save();
  ctx.translate(0, 0);
  ctx.beginPath();
  ctx.moveTo(c, 8); // nose
  ctx.lineTo(c + 16, ICON_SIZE - 12); // stern-right
  ctx.lineTo(c, ICON_SIZE - 22); // notch
  ctx.lineTo(c - 16, ICON_SIZE - 12); // stern-left
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- dot ---
  ctx.beginPath();
  ctx.arc(ICON_SIZE + c, c, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
