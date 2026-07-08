import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const REFRESH_MS = 30_000;

export interface LondonPulse {
  tube: { trains: number; moving: number; lines_good: number; lines_total: number; disrupted: string[] } | null;
  rail: { count: number; on_time_pct: number | null; late: number } | null;
  bus: { count: number } | null;
  health: number | null;
}

export function useLondonPulse(enabled: boolean): LondonPulse | null {
  const [pulse, setPulse] = useState<LondonPulse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(`${API_URL}/api/london/pulse`).then((r) => r.json());
        if (!cancelled) setPulse(d);
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
  return pulse;
}
