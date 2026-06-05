import { useEffect, useState } from "react";

export type TrailPoint = [number, number, number]; // [lon, lat, epochSeconds]

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Fetch the backend-stored track for one vessel (instant history). Refetches
 * when the MMSI changes; returns [] while loading or when none is selected.
 */
export function useVesselTrail(mmsi: number | null): TrailPoint[] {
  const [history, setHistory] = useState<TrailPoint[]>([]);

  useEffect(() => {
    if (mmsi == null) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistory([]);
    fetch(`${API_URL}/api/vessel/${mmsi}/trail`)
      .then((r) => r.json())
      .then((d: { trail: TrailPoint[] }) => {
        if (!cancelled) setHistory(d.trail ?? []);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [mmsi]);

  return history;
}
