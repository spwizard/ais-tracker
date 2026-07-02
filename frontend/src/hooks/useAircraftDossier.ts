import { useEffect, useState } from "react";
import type { AircraftDossier } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Fetch the aircraft dossier (live record + adsbdb enrichment) for the selected
 * hex. Mirrors the per-vessel enrichment hooks: refetch on hex change, clear
 * while loading, guard against a stale response after the selection moves on.
 */
export function useAircraftDossier(hex: string | null) {
  const [data, setData] = useState<AircraftDossier | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hex) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`${API_URL}/api/aircraft/${hex}`)
      .then((r) => r.json())
      .then((d: AircraftDossier) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hex]);

  return { data, loading };
}
