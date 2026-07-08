import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const REFRESH_MS = 30_000;

export interface HeatPoint { lat: number; lon: number; delay: number }
export interface Hotspot { lat: number; lon: number; count: number; delay_sum: number; where: string | null }
export interface DelayHotspots { points: HeatPoint[]; hotspots: Hotspot[] }

const EMPTY: DelayHotspots = { points: [], hotspots: [] };

/** Live delay hotspots — heat points + named clusters, refreshed while on. */
export function useDelayHotspots(enabled: boolean): DelayHotspots {
  const [data, setData] = useState<DelayHotspots>(EMPTY);
  useEffect(() => {
    if (!enabled) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(`${API_URL}/api/rail/hotspots`).then((r) => r.json());
        if (!cancelled) setData(d);
      } catch {
        /* transient */
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
  return data;
}
