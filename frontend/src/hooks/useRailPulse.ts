import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const REFRESH_MS = 30_000;

export interface OperatorStat {
  name: string;
  count: number;
  on_time_pct: number;
  avg_delay: number;
}
export interface TrainExtreme {
  id: string;
  label: string;
  next: string | null;
  lat: number;
  lon: number;
  delay_min?: number; // on `worst`
  mph?: number; // on `fastest`
}
export interface RailPulse {
  total: number;
  on_time_pct: number | null;
  late: number;
  bad: number;
  avg_delay: number;
  trend?: number;
  narrative?: string | null;
  operators: OperatorStat[];
  history?: number[];
  worst?: TrainExtreme | null;
  fastest?: TrainExtreme | null;
}

/** Live "State of the Railway" aggregate — refreshes while the panel is open. */
export function useRailPulse(enabled: boolean): RailPulse | null {
  const [pulse, setPulse] = useState<RailPulse | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(`${API_URL}/api/rail/pulse`).then((r) => r.json());
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
