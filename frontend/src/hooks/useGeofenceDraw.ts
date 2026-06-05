import { useCallback, useEffect, useRef, useState } from "react";
import { haversineM, rectRing } from "@/geofence/geometry";
import type { FenceShape } from "@/geofence/types";

export type DrawResult =
  | { shape: "circle"; center: [number, number]; radiusM: number }
  | { shape: "rectangle"; ring: [number, number][] }
  | { shape: "polygon"; ring: [number, number][] };

interface Options {
  drawMode: FenceShape | null;
  onComplete: (r: DrawResult) => void;
  onCancel: () => void;
}

/**
 * Click/drag-to-build drawing for circle / rectangle / polygon.
 *  - circle:    drag from centre to radius (or click twice)
 *  - rectangle: drag corner to corner (or click twice)
 *  - polygon:   click to add vertices, Enter to finish
 *  Esc cancels; the tool stays active after a shape so you can draw several.
 *
 * `onComplete` is always called *outside* React state updaters — calling a side
 * effect inside an updater double-fires under StrictMode (and is impure).
 * Current points live in a ref so handlers read fresh values without being
 * recreated on every vertex.
 */
export function useGeofenceDraw({ drawMode, onComplete, onCancel }: Options) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const pointsRef = useRef<[number, number][]>([]);
  const draggingRef = useRef(false);

  const setPts = useCallback((next: [number, number][]) => {
    pointsRef.current = next;
    setPoints(next);
  }, []);

  // Circle & rectangle are drag-to-draw (press → drag → release).
  const dragToDraw = drawMode === "circle" || drawMode === "rectangle";

  // Reset the in-progress geometry whenever the tool changes/clears.
  useEffect(() => {
    setPts([]);
    setHover(null);
    draggingRef.current = false;
  }, [drawMode, setPts]);

  const onMapDragStart = useCallback(
    (coord: [number, number]) => {
      if (!dragToDraw) return;
      setPts([coord]);
      setHover(coord);
      draggingRef.current = true;
    },
    [dragToDraw, setPts],
  );

  const onMapDrag = useCallback((coord: [number, number]) => {
    if (draggingRef.current) setHover(coord);
  }, []);

  const onMapDragEnd = useCallback(
    (coord: [number, number]) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setHover(null);
      const pts = pointsRef.current;
      if (pts.length === 1 && haversineM(pts[0], coord) > 1) {
        if (drawMode === "circle")
          onComplete({ shape: "circle", center: pts[0], radiusM: haversineM(pts[0], coord) });
        else onComplete({ shape: "rectangle", ring: rectRing(pts[0], coord) });
        setPts([]);
      }
    },
    [drawMode, onComplete, setPts],
  );

  const finishPolygon = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length >= 3) onComplete({ shape: "polygon", ring: pts });
    setPts([]);
    setHover(null);
  }, [onComplete, setPts]);

  const onMapClick = useCallback(
    (coord: [number, number]) => {
      if (!drawMode) return;
      const pts = pointsRef.current;
      if (drawMode === "circle") {
        if (pts.length === 0) setPts([coord]);
        else {
          onComplete({ shape: "circle", center: pts[0], radiusM: haversineM(pts[0], coord) });
          setPts([]);
        }
      } else if (drawMode === "rectangle") {
        if (pts.length === 0) setPts([coord]);
        else {
          onComplete({ shape: "rectangle", ring: rectRing(pts[0], coord) });
          setPts([]);
        }
      } else if (drawMode === "polygon") {
        setPts([...pts, coord]);
      }
    },
    [drawMode, onComplete, setPts],
  );

  const onMapHover = useCallback(
    (coord: [number, number] | null) => {
      if (drawMode) setHover(coord);
    },
    [drawMode],
  );

  // Keyboard: Enter finishes a polygon, Esc cancels the whole tool.
  useEffect(() => {
    if (!drawMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPts([]);
        setHover(null);
        onCancel();
      } else if (e.key === "Enter" && drawMode === "polygon") {
        finishPolygon();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawMode, finishPolygon, onCancel, setPts]);

  return {
    points,
    hover,
    dragToDraw,
    onMapClick,
    onMapHover,
    onMapDragStart,
    onMapDrag,
    onMapDragEnd,
    finishPolygon,
  };
}
