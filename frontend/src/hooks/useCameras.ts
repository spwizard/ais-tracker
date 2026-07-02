import { useEffect, useState } from "react";
import type { Camera } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// The camera catalogue is static-ish (~880 fixed cameras), so fetch it once and
// share it across mounts — only when the layer is actually switched on.
let cache: Camera[] | null = null;
let inflight: Promise<Camera[]> | null = null;

export function useCameras(enabled: boolean): Camera[] {
  const [cameras, setCameras] = useState<Camera[]>(cache ?? []);

  useEffect(() => {
    if (!enabled) return;
    if (cache) {
      setCameras(cache);
      return;
    }
    let cancelled = false;
    if (!inflight) {
      inflight = fetch(`${API_URL}/api/cameras`)
        .then((r) => r.json())
        .then((d: { cameras: Camera[] }) => {
          cache = d.cameras ?? [];
          return cache;
        });
    }
    inflight
      .then((c) => {
        if (!cancelled) setCameras(c);
      })
      .catch(() => {
        if (!cancelled) setCameras([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return cameras;
}
