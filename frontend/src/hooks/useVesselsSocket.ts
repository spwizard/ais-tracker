import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectionStatus,
  GeofenceEvent,
  RiskEvent,
  ServerFrame,
  TrackedVessel,
  Vessel,
} from "@/types";

const MAX_EVENTS = 60; // most recent events kept client-side

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
// Falls back to same-origin (the single-app Fly deploy) when VITE_WS_URL is
// empty/unset — so it works regardless of the app's domain.
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

const TRAIL_MAX = 60; // positions kept client-side per vessel for trails

/**
 * Owns the realtime vessel state. Key performance decision: vessels live in a
 * **ref** (a Map), not React state — thousands of vessels updating ~1/sec must
 * not trigger a React render per update. Instead we bump a `version` counter at
 * most once per animation frame; consumers use it to rebuild deck.gl layers.
 */
export function useVesselsSocket() {
  // The live store. Never triggers renders directly.
  const vesselsRef = useRef<Map<number, TrackedVessel>>(new Map());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());

  // Coalesce many incoming frames into a single render per frame.
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const scheduleRender = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      setVersion((v) => v + 1);
    });
  }, []);

  const applyVessel = useCallback((v: Vessel) => {
    const map = vesselsRef.current;
    const prev = map.get(v.mmsi);
    const trail = prev?.trail ?? [];
    // Append to the trail only on a genuinely new position fix.
    if (
      v.lat != null &&
      v.lon != null &&
      (prev?.lat !== v.lat || prev?.lon !== v.lon)
    ) {
      trail.push([v.lon, v.lat, v.ts]);
      if (trail.length > TRAIL_MAX) trail.shift();
    }
    map.set(v.mmsi, { ...prev, ...v, trail });
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let reconnectTimer: number | undefined;
    let backoff = 1000;

    const connect = () => {
      // The effect may already have been torn down (StrictMode double-mount, or
      // the snapshot fetch resolving after cleanup) — don't open a stray socket.
      if (closedByUs) return;
      setStatus((s) => (s === "open" ? s : "connecting"));
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        backoff = 1000;
        setStatus("open");
      };

      ws.onmessage = (ev) => {
        let frame: ServerFrame;
        try {
          frame = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (frame.type === "snapshot") {
          vesselsRef.current.clear();
          for (const v of frame.vessels) applyVessel(v);
        } else if (frame.type === "update") {
          for (const v of frame.vessels) applyVessel(v);
          for (const mmsi of frame.removed) vesselsRef.current.delete(mmsi);
        } else if (frame.type === "geofence_event") {
          setEvents((prev) => [frame, ...prev].slice(0, MAX_EVENTS));
          return; // not a vessel update — no render bump needed
        } else if (frame.type === "risk_event") {
          setRiskEvents((prev) => [frame, ...prev].slice(0, MAX_EVENTS));
          return;
        } else if (frame.type === "flagged") {
          setFlagged(new Set(frame.mmsis));
          return;
        }
        scheduleRender();
      };

      ws.onclose = () => {
        setStatus("closed");
        if (closedByUs) return;
        reconnectTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000); // exponential backoff, cap 15s
      };

      ws.onerror = () => ws?.close();
    };

    // Warm-start from REST so the map is populated before the first WS frame.
    fetch(`${API_URL}/api/snapshot`)
      .then((r) => r.json())
      .then((data: { vessels: Vessel[] }) => {
        if (closedByUs) return;
        for (const v of data.vessels) applyVessel(v);
        scheduleRender();
      })
      .catch(() => void 0)
      .finally(connect);

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ws?.close();
    };
  }, [applyVessel, scheduleRender]);

  return { vesselsRef, version, status, events, riskEvents, flagged };
}
