import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Aircraft,
  Bus,
  ConnectionStatus,
  GeofenceEvent,
  RiskEvent,
  ServerFrame,
  TrackedAircraft,
  TrackedBus,
  TrackedVessel,
  Vessel,
} from "@/types";
import type { Geofence } from "@/geofence/types";

/** A live geofence-set update broadcast by the backend (sender tagged). */
export interface GeofenceSync {
  geofences: Geofence[];
  origin?: string;
}

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
  // Live aircraft (ADS-B), same ref-not-state strategy, keyed by hex.
  const aircraftRef = useRef<Map<string, TrackedAircraft>>(new Map());
  // Live London buses (BODS), keyed by vehicle id.
  const busesRef = useRef<Map<string, TrackedBus>>(new Map());
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [riskEvents, setRiskEvents] = useState<RiskEvent[]>([]);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [geofenceSync, setGeofenceSync] = useState<GeofenceSync | null>(null);

  // Coalesce many incoming frames into a single render per frame.
  const dirtyRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Aircraft/bus trails are only worth storing while their layer is visible —
  // otherwise thousands of hidden entities each hold a 60-point trail (~50MB
  // for the London bus fleet alone). App keeps this in sync with the toggles.
  const trailGate = useRef({ air: true, bus: true });
  const setTrailGate = useCallback((g: { air: boolean; bus: boolean }) => {
    trailGate.current = g;
  }, []);

  const scheduleRender = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    rafRef.current = requestAnimationFrame(() => {
      dirtyRef.current = false;
      setVersion((v) => v + 1);
    });
  }, []);

  // The apply* functions mutate records in place rather than spread-copying:
  // the backend sends the full merged record each time, and all rendering is
  // driven by the `version` counter (no component or memo relies on entity
  // object identity) — so re-allocating thousands of objects per second bought
  // nothing but GC pressure. Incoming frames are fresh JSON objects, so on
  // first sight the frame object itself becomes the stored record.

  const applyVessel = useCallback((v: Vessel) => {
    const map = vesselsRef.current;
    const prev = map.get(v.mmsi);
    if (!prev) {
      const rec = v as TrackedVessel;
      rec.trail = v.lat != null && v.lon != null ? [[v.lon, v.lat, v.ts]] : [];
      map.set(v.mmsi, rec);
      return;
    }
    // Append to the trail only on a genuinely new position fix.
    if (v.lat != null && v.lon != null && (prev.lat !== v.lat || prev.lon !== v.lon)) {
      prev.trail.push([v.lon, v.lat, v.ts]);
      if (prev.trail.length > TRAIL_MAX) prev.trail.shift();
    }
    Object.assign(prev, v); // `v` carries no `trail` key, so the trail survives
  }, []);

  const applyAircraft = useCallback((a: Aircraft) => {
    const map = aircraftRef.current;
    const prev = map.get(a.hex);
    const gated = trailGate.current.air;
    if (!prev) {
      const rec = a as TrackedAircraft;
      rec.trail = gated && a.lat != null && a.lon != null ? [[a.lon, a.lat, a.ts]] : [];
      map.set(a.hex, rec);
      return;
    }
    if (!gated) {
      if (prev.trail.length) prev.trail.length = 0; // reclaim when layer is off
    } else if (a.lat != null && a.lon != null && (prev.lat !== a.lat || prev.lon !== a.lon)) {
      prev.trail.push([a.lon, a.lat, a.ts]);
      if (prev.trail.length > TRAIL_MAX) prev.trail.shift();
    }
    Object.assign(prev, a);
  }, []);

  const applyBus = useCallback((b: Bus) => {
    const map = busesRef.current;
    const prev = map.get(b.id);
    const gated = trailGate.current.bus;
    if (!prev) {
      const rec = b as TrackedBus;
      rec.trail = gated && b.lat != null && b.lon != null ? [[b.lon, b.lat, b.ts]] : [];
      map.set(b.id, rec);
      return;
    }
    if (!gated) {
      if (prev.trail.length) prev.trail.length = 0;
    } else if (b.lat != null && b.lon != null && (prev.lat !== b.lat || prev.lon !== b.lon)) {
      prev.trail.push([b.lon, b.lat, b.ts]);
      if (prev.trail.length > TRAIL_MAX) prev.trail.shift();
    }
    Object.assign(prev, b);
  }, []);

  // Client-side backstop eviction. Entities normally leave via the backend's
  // `removed` lists; if one is ever missed it would otherwise live (trail and
  // all) for the whole session. TTLs sit well above the backend's own.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now() / 1000;
      let dropped = 0;
      for (const [k, v] of vesselsRef.current) {
        if (now - v.ts > 900) { vesselsRef.current.delete(k); dropped++; }
      }
      for (const [k, a] of aircraftRef.current) {
        if (now - a.ts > 300) { aircraftRef.current.delete(k); dropped++; }
      }
      for (const [k, b] of busesRef.current) {
        if (now - b.ts > 300) { busesRef.current.delete(k); dropped++; }
      }
      if (dropped) scheduleRender();
    }, 60_000);
    return () => clearInterval(id);
  }, [scheduleRender]);

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
        } else if (frame.type === "air_snapshot") {
          aircraftRef.current.clear();
          for (const a of frame.aircraft) applyAircraft(a);
        } else if (frame.type === "air_update") {
          for (const a of frame.aircraft) applyAircraft(a);
          for (const hex of frame.removed) aircraftRef.current.delete(hex);
        } else if (frame.type === "bus_snapshot") {
          busesRef.current.clear();
          for (const b of frame.buses) applyBus(b);
        } else if (frame.type === "bus_update") {
          for (const b of frame.buses) applyBus(b);
          for (const id of frame.removed) busesRef.current.delete(id);
        } else if (frame.type === "geofence_event") {
          setEvents((prev) => [frame, ...prev].slice(0, MAX_EVENTS));
          return; // not a vessel update — no render bump needed
        } else if (frame.type === "risk_event") {
          setRiskEvents((prev) => [frame, ...prev].slice(0, MAX_EVENTS));
          return;
        } else if (frame.type === "flagged") {
          setFlagged(new Set(frame.mmsis));
          return;
        } else if (frame.type === "geofences") {
          setGeofenceSync({
            geofences: frame.geofences as Geofence[],
            origin: frame.origin,
          });
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
  }, [applyVessel, applyAircraft, applyBus, scheduleRender]);

  return {
    vesselsRef,
    aircraftRef,
    busesRef,
    version,
    status,
    events,
    riskEvents,
    flagged,
    geofenceSync,
    setTrailGate,
  };
}
