import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** GB rail route geometry (GeoJSON FeatureCollection) — fetched once when the
 *  trains layer first turns on; ~1MB gzipped, browser-cached for a day. */
let cache: unknown | null = null;
let inflight: Promise<unknown> | null = null;

export function useRailNetwork(enabled: boolean): unknown | null {
  const [network, setNetwork] = useState<unknown | null>(cache);

  useEffect(() => {
    if (!enabled) return;
    if (cache) {
      setNetwork(cache);
      return;
    }
    let cancelled = false;
    let retry: number | undefined;
    const load = () => {
      if (!inflight) {
        inflight = fetch(`${API_URL}/api/rail/network`)
          .then((r) => (r.status === 204 ? null : r.json()))
          .then((d) => {
            cache = d;
            return cache;
          })
          .catch((e) => {
            inflight = null; // never cache a failure
            throw e;
          });
      }
      inflight
        .then((n) => {
          if (!cancelled) setNetwork(n);
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

  return network;
}
