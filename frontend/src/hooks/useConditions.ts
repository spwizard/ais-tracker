import { useEffect, useState } from "react";
import type { VesselConditions } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Windy point forecast (sea state) at a vessel's position, when enabled. */
export function useConditions(
  mmsi: number | null,
  enabled: boolean,
): VesselConditions | null {
  const [c, setC] = useState<VesselConditions | null>(null);

  useEffect(() => {
    if (!enabled || mmsi == null) {
      setC(null);
      return;
    }
    let cancelled = false;
    setC(null);
    fetch(`${API_URL}/api/vessel/${mmsi}/conditions`)
      .then((r) => r.json())
      .then((d: { conditions: VesselConditions | null }) => {
        if (!cancelled) setC(d.conditions);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [mmsi, enabled]);

  return c;
}
