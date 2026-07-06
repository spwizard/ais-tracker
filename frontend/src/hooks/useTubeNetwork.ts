import { useEffect, useState } from "react";
import type { TubeLine, TubeStation } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface TubeNetwork {
  lines: TubeLine[];
  stations: TubeStation[];
}

const EMPTY: TubeNetwork = { lines: [], stations: [] };

// Geometry is static-ish; status refreshes server-side, so re-fetch every few
// minutes while the layer is on (cheap: the payload is cached server-side).
const REFRESH_MS = 180_000;

export function useTubeNetwork(enabled: boolean): TubeNetwork {
  const [network, setNetwork] = useState<TubeNetwork>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(`${API_URL}/api/tube/network`).then((r) => r.json());
        if (!cancelled && d?.lines) setNetwork({ lines: d.lines, stations: d.stations ?? [] });
        if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
      } catch {
        if (!cancelled) timer = window.setTimeout(load, 15_000); // retry, never cache failure
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return network;
}
