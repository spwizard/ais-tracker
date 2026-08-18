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
  | "tubeboard"
  | "railpulse"
  | "londonpulse"
  | "incidents"
  | "wildfires"
  | "ferries"
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
  "tubeboard",
  "railpulse",
  "londonpulse",
  "incidents",
  "wildfires",
  "ferries",
  "zones",
  "analyst",
];

/** Render widths (must match each panel's FloatingPanel `width`). */
export const PANEL_W: Record<PanelId, number> = {
  filters: 288,
  stats: 256,
  layers: 280,
  detail: 320,
  aircraft: 380,
  camera: 360,
  bus: 340,
  train: 340,
  station: 340,
  tubeboard: 340,
  railpulse: 340,
  londonpulse: 320,
  incidents: 320,
  wildfires: 320,
  ferries: 320,
  zones: 288,
  analyst: 380,
};

/** Approximate heights — used only for non-overlap placement math. */
export const PANEL_EST_H: Record<PanelId, number> = {
  filters: 430,
  stats: 340,
  layers: 420,
  detail: 380,
  aircraft: 440,
  camera: 330,
  bus: 320,
  train: 400,
  station: 420,
  tubeboard: 420,
  railpulse: 420,
  londonpulse: 340,
  incidents: 440,
  wildfires: 440,
  ferries: 440,
  zones: 360,
  analyst: 540,
};

const MARGIN = 16;

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

const STORAGE_KEY = "ais.panels.v3";

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
/** Sheet layout (phones + portrait tablets) — used to keep the mobile chrome
 *  clean: nothing auto-opens, and only one sheet shows at a time. */
function isSheet(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 1024;
}

// The centred top bar is ~1000px wide on desktop, so on anything narrower than
// a big monitor it would run into panels pinned to the top corners. Dock the
// first row of panels below the bar's band instead.
const TOP = MARGIN + 56;

function defaults(): PanelMap {
  const { vw } = viewport();
  const wide = !isSheet(); // start map-first on small screens (no auto-open panels)
  return {
    // Controls left, content right: the Eyes rail owns the top-left; the
    // region rail (incidents/wildfires/ferries) and detail panels dock in the
    // right column. Stats is a click away in the toolbar rather than open by
    // default — the map should be the first thing you see.
    filters: { open: true, x: MARGIN, y: TOP },
    stats: { open: false, x: vw - MARGIN - PANEL_W.stats, y: TOP },
    layers: { open: wide, x: MARGIN, y: TOP },
    detail: {
      open: false,
      x: vw - MARGIN - PANEL_W.detail,
      y: TOP,
    },
    aircraft: {
      open: false,
      x: vw - MARGIN - PANEL_W.aircraft,
      y: TOP,
    },
    camera: {
      open: false,
      x: vw - MARGIN - PANEL_W.camera,
      y: TOP,
    },
    bus: {
      open: false,
      x: vw - MARGIN - PANEL_W.bus,
      y: TOP,
    },
    train: {
      open: false,
      x: vw - MARGIN - PANEL_W.train,
      y: TOP,
    },
    station: {
      open: false,
      x: vw - MARGIN - PANEL_W.station,
      y: TOP,
    },
    tubeboard: {
      open: false,
      x: vw - MARGIN - PANEL_W.tubeboard,
      y: TOP,
    },
    railpulse: {
      open: false,
      x: vw - MARGIN - PANEL_W.railpulse,
      y: TOP,
    },
    londonpulse: {
      open: false,
      x: vw - MARGIN - PANEL_W.londonpulse,
      y: TOP,
    },
    incidents: { open: false, x: vw - MARGIN - PANEL_W.incidents, y: TOP },
    wildfires: { open: false, x: vw - MARGIN - PANEL_W.wildfires, y: TOP },
    ferries: { open: false, x: vw - MARGIN - PANEL_W.ferries, y: TOP },
    zones: {
      open: false,
      x: vw - MARGIN - PANEL_W.zones,
      y: TOP,
    },
    analyst: {
      open: false,
      x: vw - MARGIN - PANEL_W.analyst,
      y: TOP,
    },
  };
}

function load(): PanelMap {
  const base = defaults();
  // On small screens the sheet layout ignores x/y anyway, and restoring saved
  // desktop coordinates would drop panels off-screen — so only rehydrate saved
  // positions in the floating (wide) layout.
  if (typeof window !== "undefined" && window.innerWidth <= 1024) return base;
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
    // Centered top toolbar (~1000px wide on desktop)
    { x: vw / 2 - 520, y: 8, w: 1040, h: 56 },
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
    for (let y = TOP; y + h <= vh - MARGIN; y += step) {
      const r = { x, y, w, h };
      if (!obstacles.some((o) => overlaps(r, o))) return r;
    }
  }
  return { x: vw - MARGIN - w, y: TOP, w, h };
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

  // On the sheet layout only one panel shows at a time (sheets can't tile), so
  // opening one closes the rest. Desktop keeps its free-floating multi-panel feel.
  const openExclusive = (prev: PanelMap, id: PanelId): PanelMap => {
    const next = { ...prev };
    for (const k of PANEL_IDS) if (next[k].open) next[k] = { ...next[k], open: false };
    next[id] = { ...next[id], open: true };
    return next;
  };

  const setOpen = useCallback((id: PanelId, open: boolean) => {
    setPanels((prev) =>
      open && isSheet()
        ? openExclusive(prev, id)
        : { ...prev, [id]: { ...prev[id], open } },
    );
  }, []);

  const toggle = useCallback((id: PanelId) => {
    setPanels((prev) =>
      !prev[id].open && isSheet()
        ? openExclusive(prev, id)
        : { ...prev, [id]: { ...prev[id], open: !prev[id].open } },
    );
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
