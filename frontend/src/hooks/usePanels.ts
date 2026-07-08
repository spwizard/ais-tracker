import { useCallback, useEffect, useState } from "react";

export type PanelId =
  | "filters"
  | "stats"
  | "layers"
  | "detail"
  | "aircraft"
  | "camera"
  | "bus"
  | "train"
  | "station"
  | "railpulse"
  | "londonpulse"
  | "zones"
  | "analyst";

export const PANEL_IDS: PanelId[] = [
  "filters",
  "stats",
  "layers",
  "detail",
  "aircraft",
  "camera",
  "bus",
  "train",
  "station",
  "railpulse",
  "londonpulse",
  "zones",
  "analyst",
];

/** Render widths (must match each panel's FloatingPanel `width`). */
export const PANEL_W: Record<PanelId, number> = {
  filters: 288,
  stats: 256,
  layers: 240,
  detail: 320,
  aircraft: 380,
  camera: 360,
  bus: 340,
  train: 340,
  station: 340,
  railpulse: 340,
  londonpulse: 320,
  zones: 288,
  analyst: 380,
};

/** Approximate heights — used only for non-overlap placement math. */
export const PANEL_EST_H: Record<PanelId, number> = {
  filters: 430,
  stats: 340,
  layers: 175,
  detail: 380,
  aircraft: 440,
  camera: 330,
  bus: 320,
  train: 400,
  station: 420,
  railpulse: 420,
  londonpulse: 340,
  zones: 360,
  analyst: 540,
};

const MARGIN = 16;
const GAP = 16;

export interface PanelState {
  open: boolean;
  x: number;
  y: number;
  pinned?: boolean; // locked in place: not draggable, never auto-repositioned
}
export type PanelMap = Record<PanelId, PanelState>;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "ais.panels.v2";

function viewport() {
  return {
    vw: typeof window !== "undefined" ? window.innerWidth : 1440,
    vh: typeof window !== "undefined" ? window.innerHeight : 900,
  };
}

/**
 * Balanced starting layout: Filters top-left, Stats top-right, Layers
 * bottom-left, map controls live bottom-right — so the corners are evenly
 * weighted. The detail panel starts closed and is auto-placed on first open.
 */
function defaults(): PanelMap {
  const { vw, vh } = viewport();
  return {
    filters: { open: true, x: MARGIN, y: MARGIN },
    stats: { open: true, x: vw - MARGIN - PANEL_W.stats, y: MARGIN },
    layers: { open: true, x: MARGIN, y: vh - MARGIN - PANEL_EST_H.layers },
    detail: {
      open: false,
      x: vw - MARGIN - PANEL_W.detail,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    aircraft: {
      open: false,
      x: vw - MARGIN - PANEL_W.aircraft,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    camera: {
      open: false,
      x: vw - MARGIN - PANEL_W.camera,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    bus: {
      open: false,
      x: vw - MARGIN - PANEL_W.bus,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    train: {
      open: false,
      x: vw - MARGIN - PANEL_W.train,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    station: {
      open: false,
      x: vw - MARGIN - PANEL_W.station,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    railpulse: {
      open: false,
      x: vw - MARGIN - PANEL_W.railpulse,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    londonpulse: {
      open: false,
      x: vw - MARGIN - PANEL_W.londonpulse,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    zones: {
      open: false,
      x: vw - MARGIN - PANEL_W.zones,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
    analyst: {
      open: false,
      x: vw - MARGIN - PANEL_W.analyst,
      y: MARGIN + PANEL_EST_H.stats + GAP,
    },
  };
}

function load(): PanelMap {
  const base = defaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<PanelMap>;
    for (const k of PANEL_IDS) if (saved[k]) base[k] = { ...base[k], ...saved[k] };
  } catch {
    /* ignore corrupt storage */
  }
  return base;
}

// --- geometry helpers --------------------------------------------------------

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function fitsViewport(r: Rect, vw: number, vh: number): boolean {
  return (
    r.x >= MARGIN &&
    r.y >= MARGIN &&
    r.x + r.w <= vw - MARGIN &&
    r.y + r.h <= vh - MARGIN
  );
}

/** Zones the map owns that panels should never cover. */
function reservedRects(vw: number, vh: number): Rect[] {
  return [
    // Centered top toolbar
    { x: vw / 2 - 240, y: 8, w: 480, h: 56 },
    // Map controls cluster (bottom-right)
    { x: vw - MARGIN - 44, y: vh - MARGIN - 104, w: 44, h: 104 },
  ];
}

/** Scan right column, then left, then center for the first non-colliding slot. */
function findFreeSlot(w: number, h: number, obstacles: Rect[]): Rect {
  const { vw, vh } = viewport();
  const step = 24;
  const columns = [vw - MARGIN - w, MARGIN, Math.round((vw - w) / 2)];
  for (const x of columns) {
    for (let y = MARGIN; y + h <= vh - MARGIN; y += step) {
      const r = { x, y, w, h };
      if (!obstacles.some((o) => overlaps(r, o))) return r;
    }
  }
  return { x: vw - MARGIN - w, y: MARGIN, w, h };
}

// --- hook --------------------------------------------------------------------

const Z_BASE = 20;

export function usePanels() {
  const [panels, setPanels] = useState<PanelMap>(load);
  const [order, setOrder] = useState<PanelId[]>([...PANEL_IDS]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
    } catch {
      /* storage may be unavailable */
    }
  }, [panels]);

  const setOpen = useCallback((id: PanelId, open: boolean) => {
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], open } }));
  }, []);

  const toggle = useCallback((id: PanelId) => {
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], open: !prev[id].open } }));
  }, []);

  const togglePin = useCallback((id: PanelId) => {
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], pinned: !prev[id].pinned } }));
  }, []);

  const move = useCallback((id: PanelId, x: number, y: number) => {
    setPanels((prev) => ({ ...prev, [id]: { ...prev[id], x, y } }));
  }, []);

  const focus = useCallback(
    (id: PanelId) => setOrder((prev) => [...prev.filter((p) => p !== id), id]),
    [],
  );

  const zIndexOf = useCallback(
    (id: PanelId) => Z_BASE + order.indexOf(id),
    [order],
  );

  /**
   * Ensure `id` doesn't overlap any *other* open panel or a reserved map zone.
   * If its current position is already clean it's left untouched (so the user's
   * own drags are respected); otherwise it's moved to the nearest free slot.
   */
  const autoPlace = useCallback((id: PanelId) => {
    setPanels((prev) => {
      if (prev[id].pinned) return prev; // pinned panels stay exactly where they are
      const { vw, vh } = viewport();
      const w = PANEL_W[id];
      const h = Math.min(PANEL_EST_H[id], vh - 2 * MARGIN);

      const obstacles = reservedRects(vw, vh);
      for (const pid of PANEL_IDS) {
        if (pid === id || !prev[pid].open) continue;
        obstacles.push({ x: prev[pid].x, y: prev[pid].y, w: PANEL_W[pid], h: PANEL_EST_H[pid] });
      }

      const cur: Rect = { x: prev[id].x, y: prev[id].y, w, h };
      if (fitsViewport(cur, vw, vh) && !obstacles.some((o) => overlaps(cur, o))) {
        return prev; // already clean — don't move it
      }
      const slot = findFreeSlot(w, h, obstacles);
      return { ...prev, [id]: { ...prev[id], x: slot.x, y: slot.y } };
    });
  }, []);

  return { panels, setOpen, toggle, togglePin, move, focus, zIndexOf, autoPlace };
}
