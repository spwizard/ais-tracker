import { useEffect, useState } from "react";

/**
 * The single source of truth for responsive layout decisions.
 *
 * The app has two chrome modes that share all content + logic:
 *   - "floating"  — the desktop draggable-glass panels (also iPad *landscape*).
 *   - "sheet"     — phones and iPad *portrait*: one bottom sheet at a time.
 *
 * The split is by width (not just touch), so an iPad in landscape keeps the
 * roomy floating layout while the same iPad in portrait switches to sheets.
 * `isTouch` is tracked separately, because touch-target sizing applies to the
 * floating layout too (an iPad landscape is floating *and* touch).
 */
export const SHEET_MAX_WIDTH = 1024; // ≤ this ⇒ sheet layout (phones, portrait tablets)
const PHONE_MAX_WIDTH = 768;

export interface Viewport {
  width: number;
  height: number;
  isTouch: boolean;
  isPhone: boolean; // small screen — most aggressive adaptations
  isTablet: boolean; // touch + roomy (iPad-class)
  sheetLayout: boolean; // use bottom sheets instead of floating panels
  orientation: "portrait" | "landscape";
}

function read(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isTouch =
    window.matchMedia?.("(pointer: coarse)").matches ||
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0;
  return {
    width,
    height,
    isTouch,
    isPhone: width < PHONE_MAX_WIDTH,
    isTablet: isTouch && width >= PHONE_MAX_WIDTH,
    sheetLayout: width <= SHEET_MAX_WIDTH,
    orientation: width >= height ? "landscape" : "portrait",
  };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read);
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  return vp;
}

/** Convenience for components that only need the layout-mode boolean. */
export function useSheetLayout(): boolean {
  return useViewport().sheetLayout;
}
