import { useEffect, useState } from "react";
import type { RailStation } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ~2,600 fixed stations — fetch once per session, shared across mounts.
// Failures are never cached (see useCameras for the sleep/wake lesson).
let cache: RailStation[] | null = null;
let inflight: Promise<RailStation[]> | null = null;

export function useStations(enabled: boolean): RailStation[] {
  const [stations, setStations] = useState<RailStation[]>(cache ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (cache) {
      setStations(cache);
      return;
    }
    let cancelled = false;
    let retry: number | undefined;
    const load = () => {
      if (!inflight) {
        inflight = fetch(`${API_URL}/api/stations`)
          .then((r) => r.json())
          .then((d: { stations: RailStation[] }) => {
            cache = d.stations ?? [];
            return cache;
          })
          .catch((e) => {
            inflight = null;
            throw e;
          });
      }
      inflight
        .then((s) => {
          if (!cancelled) setStations(s);
        })
        .catch(() => {
          if (!cancelled) retry = window.setTimeout(load, 15_000);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [enabled]);

  return stations;
}
