import { useEffect, useRef, useState } from "react";
import type { ReplayTrack } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface ReplayWindow {
  start: number; // epoch seconds
  end: number; // epoch seconds
  bbox?: [number, number, number, number]; // west, south, east, north
}

/** Stable string key for a window's *values*, so effects refetch when the
 *  range/bbox actually change — not merely when a new object identity is passed
 *  (which would otherwise loop if a caller builds the window inline each render). */
export function windowKey(w: ReplayWindow | null): string | null {
  return w ? `${w.start}|${w.end}|${w.bbox ? w.bbox.join(",") : ""}` : null;
}

export interface ReplayData {
  tracks: ReplayTrack[];
  /** Earliest/latest stored timestamps server-side, for clamping the scrubber. */
  span: [number, number] | null;
  loading: boolean;
}

/** Fetch the historical vessel tracks for a replay window. Refetches whenever
 *  the window (range or bbox) changes; returns empty until loaded. A stale
 *  in-flight request is ignored if the window changes before it resolves. */
export function useReplay(window: ReplayWindow | null): ReplayData {
  const [data, setData] = useState<ReplayData>({
    tracks: [],
    span: null,
    loading: false,
  });
  const reqId = useRef(0);

  useEffect(() => {
    if (!window) {
      setData({ tracks: [], span: null, loading: false });
      return;
    }
    const id = ++reqId.current;
    setData((d) => ({ ...d, loading: true }));

    const params = new URLSearchParams({
      start: String(Math.floor(window.start)),
      end: String(Math.ceil(window.end)),
    });
    if (window.bbox) params.set("bbox", window.bbox.join(","));

    fetch(`${API_URL}/api/replay?${params}`)
      .then((r) => r.json())
      .then((d: { tracks: ReplayTrack[]; span: [number, number] | null }) => {
        if (id !== reqId.current) return; // a newer request superseded this one
        setData({ tracks: d.tracks ?? [], span: d.span ?? null, loading: false });
      })
      .catch(() => {
        if (id === reqId.current) setData((d) => ({ ...d, loading: false }));
      });
    // Keyed on the window's values, not its identity — see windowKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey(window)]);

  return data;
}
