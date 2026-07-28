import { useEffect, useState } from "react";
import type { FerryRoute } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/**
 * Ferry routes with live service status (CalMac + NorthLink), polled from the
 * backend. Status changes on a ~5-min server poll, so 2 min client-side is
 * plenty; only runs while the ferry layer is on. Server pre-sorts disrupted
 * routes first.
 */
export function useFerries(enabled: boolean): FerryRoute[] {
  const [routes, setRoutes] = useState<FerryRoute[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/api/ferries`);
        if (!r.ok) return;
        const data = (await r.json()) as { routes: FerryRoute[] };
        if (alive) setRoutes(data.routes ?? []);
      } catch {
        /* transient — keep the last good list */
      }
    };
    load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return routes;
}
