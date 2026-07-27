import { useEffect, useState } from "react";
import type { FireComplex } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Clustered wildfire complexes (named fires + growth + wind-driven spread),
 * polled from the backend. They change on the ~5-min complex-build cadence, so
 * a 60s poll is plenty; only runs while the fire layer is on.
 */
export function useFireComplexes(enabled: boolean): FireComplex[] {
  const [complexes, setComplexes] = useState<FireComplex[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/api/fire/complexes`);
        if (!r.ok) return;
        const data = (await r.json()) as { complexes: FireComplex[] };
        if (alive) setComplexes(data.complexes ?? []);
      } catch {
        /* transient — keep the last good list */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return complexes;
}
