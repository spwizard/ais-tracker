import { useEffect, useState } from "react";
import type { Camera } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// The camera catalogue is static-ish (~1,400 fixed cameras), so fetch it once
// and share it across mounts — only when the layer is actually switched on.
// Availability + still timestamps do drift (Traffic Scotland sweeps every
// 10 min), so while the layer is on we re-pull the list on a slow cadence.
let cache: Camera[] | null = null;
let inflight: Promise<Camera[]> | null = null;
const REFRESH_MS = 5 * 60_000;

export function useCameras(enabled: boolean): Camera[] {
  const [cameras, setCameras] = useState<Camera[]>(cache ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (cache) setCameras(cache);
    let cancelled = false;
    let retry: number | undefined;
    const load = () => {
      if (!inflight) {
        inflight = fetch(`${API_URL}/api/cameras`)
          .then((r) => r.json())
          .then((d: { cameras: Camera[] }) => {
            // Providers we proxy (Traffic Scotland) hand back API-relative
            // image paths; make them absolute so dev (split origins) works.
            cache = (d.cameras ?? []).map((c) =>
              c.image.startsWith("/") ? { ...c, image: `${API_URL}${c.image}` } : c,
            );
            inflight = null; // allow the periodic refresh to fetch again
            return cache;
          })
          .catch((e) => {
            // Never cache a failure: a fetch fired while offline (e.g. right
            // after the laptop wakes) used to park a rejected promise here
            // forever, leaving cameras empty until a full page reload.
            inflight = null;
            throw e;
          });
      }
      inflight
        .then((c) => {
          if (!cancelled) setCameras(c);
        })
        .catch(() => {
          if (!cancelled) retry = window.setTimeout(load, 15_000);
        });
    };
    load();
    const tick = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      clearInterval(tick);
    };
  }, [enabled]);

  return cameras;
}
