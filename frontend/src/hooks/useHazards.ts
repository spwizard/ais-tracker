import { useEffect, useState } from "react";
import type { Hazard } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Environmental hazards in force (SEPA floods, Met Office warnings, BGS
 * quakes), polled from the backend. Server polls every 15 min; 5 min client-
 * side keeps us fresh enough. Only runs while the hazards layer is on.
 */
export function useHazards(enabled: boolean): Hazard[] {
  const [hazards, setHazards] = useState<Hazard[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/api/hazards`);
        if (!r.ok) return;
        const data = (await r.json()) as { hazards: Hazard[] };
        if (alive) setHazards(data.hazards ?? []);
      } catch {
        /* transient — keep the last good list */
      }
    };
    load();
    const id = setInterval(load, 300_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return hazards;
}
