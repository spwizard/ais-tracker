/**
 * Aircraft icon atlas for deck.gl's IconLayer.
 *
 * Two white, top-down glyphs drawn once on a canvas:
 *   - "plane": a swept-wing airliner silhouette (nose "up" = 0°; the layer
 *              rotates it by the ground track)
 *   - "dot":   a small marker for aircraft on the ground / without a track
 * Both are white masks so IconLayer's `getColor` can tint them by altitude.
 */
export const AC_ICON_SIZE = 64;

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

export const AIRCRAFT_ICON_MAPPING: IconMapping = {
  plane: {
    x: 0,
    y: 0,
    width: AC_ICON_SIZE,
    height: AC_ICON_SIZE,
    anchorX: AC_ICON_SIZE / 2,
    anchorY: AC_ICON_SIZE / 2,
    mask: true,
  },
  dot: {
    x: AC_ICON_SIZE,
    y: 0,
    width: AC_ICON_SIZE,
    height: AC_ICON_SIZE,
    anchorX: AC_ICON_SIZE / 2,
    anchorY: AC_ICON_SIZE / 2,
    mask: true,
  },
};

let cachedAtlas: string | null = null;

/** Build (once) and return the aircraft icon atlas as a data-URL string. */
export function getAircraftIconAtlas(): string {
  if (cachedAtlas) return cachedAtlas;

  const canvas = document.createElement("canvas");
  canvas.width = AC_ICON_SIZE * 2;
  canvas.height = AC_ICON_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;

  // --- plane (top-down, nose up at y≈6) ---
  const c = AC_ICON_SIZE / 2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c, 6); // nose
  ctx.lineTo(c + 4, 26); // fuselage right shoulder
  ctx.lineTo(c + 28, 40); // right wingtip
  ctx.lineTo(c + 28, 46);
  ctx.lineTo(c + 4, 40); // wing root
  ctx.lineTo(c + 4, 52); // rear fuselage
  ctx.lineTo(c + 12, 58); // right tailplane
  ctx.lineTo(c + 12, 61);
  ctx.lineTo(c, 56); // tail
  ctx.lineTo(c - 12, 61); // left tailplane
  ctx.lineTo(c - 12, 58);
  ctx.lineTo(c - 4, 52);
  ctx.lineTo(c - 4, 40); // left wing root
  ctx.lineTo(c - 28, 46); // left wingtip
  ctx.lineTo(c - 28, 40);
  ctx.lineTo(c - 4, 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // --- dot ---
  ctx.beginPath();
  ctx.arc(AC_ICON_SIZE + c, c, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  cachedAtlas = canvas.toDataURL("image/png");
  return cachedAtlas;
}
