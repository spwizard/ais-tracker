import { useEffect, useRef, useState } from "react";
import type { Alert } from "@/types";
import type { ReplayWindow } from "./useReplay";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Fetch the risk + geofence alerts that fall inside a replay window (and its
 *  bbox), so they can be revealed on the map at their moment in time. Newer than
 *  the window is filtered out client-side; `/api/alerts` returns newest-first. */
export function useReplayAlerts(window: ReplayWindow | null): Alert[] {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    if (!window) {
      setAlerts([]);
      return;
    }
    const id = ++reqId.current;
    const params = new URLSearchParams({
      since: String(Math.floor(window.start)),
      limit: "500",
    });

    fetch(`${API_URL}/api/alerts?${params}`)
      .then((r) => r.json())
      .then((d: { alerts: Alert[] }) => {
        if (id !== reqId.current) return;
        const box = window.bbox;
        const within = (d.alerts ?? []).filter(
          (a) =>
            a.lat != null &&
            a.lon != null &&
            a.ts <= window.end &&
            (!box ||
              (a.lon >= box[0] && a.lon <= box[2] && a.lat >= box[1] && a.lat <= box[3])),
        );
        setAlerts(within);
      })
      .catch(() => {
        if (id === reqId.current) setAlerts([]);
      });
  }, [window]);

  return alerts;
}
