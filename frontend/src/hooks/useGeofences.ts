import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Geofence } from "@/geofence/types";
import { compileFence, type CompiledFence } from "@/geofence/geometry";
import type { GeofenceSync } from "@/hooks/useVesselsSocket";

const STORAGE_KEY = "ais.geofences.v1";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function loadLocal(): Geofence[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Geofence[];
  } catch {
    /* ignore */
  }
  return [];
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `gf_${Math.floor(performance.now() * 1000).toString(36)}`;
  }
}

/**
 * Owns geofence CRUD. The **backend is the single source of truth** (it runs the
 * evaluator that fires the alerts), shared by every client. On mount we adopt
 * the backend's set; our own edits are debounce-pushed up and broadcast to all
 * other browsers, whose live updates we adopt here — so fences (and their alerts)
 * stay consistent across browsers. localStorage is only a pre-fetch/offline
 * cache. `remote` is the live broadcast frame from the vessel socket.
 */
export function useGeofences(remote: GeofenceSync | null) {
  const [fences, setFences] = useState<Geofence[]>(loadLocal);
  const ready = useRef(false); // gate syncing until the initial load is done
  const clientId = useRef(newId()); // identifies our own pushes (ignore the echo)
  const lastSynced = useRef(""); // JSON of the set we last pushed/adopted — don't re-push it

  // Mount: adopt the backend's shared set (or migrate ours up if it's empty).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/geofences`)
      .then((r) => r.json())
      .then((d: { geofences: Geofence[] }) => {
        if (cancelled) return;
        const backend = d.geofences ?? [];
        if (backend.length > 0) {
          lastSynced.current = JSON.stringify(backend); // adopted — don't echo back
          setFences(backend);
        }
        // backend empty → keep local; the push effect migrates it up.
      })
      .catch(() => void 0)
      .finally(() => {
        ready.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Adopt a live set broadcast by *another* browser.
  useEffect(() => {
    if (!remote || remote.origin === clientId.current) return;
    const json = JSON.stringify(remote.geofences);
    lastSynced.current = json; // adopted — don't push it straight back
    setFences((prev) => (json === JSON.stringify(prev) ? prev : remote.geofences));
  }, [remote]);

  // Persist to localStorage + debounce-push our own changes to the backend.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fences));
    } catch {
      /* ignore */
    }
    if (!ready.current) return;
    const json = JSON.stringify(fences);
    if (json === lastSynced.current) return; // unchanged, or we just adopted it
    const t = setTimeout(() => {
      lastSynced.current = json;
      fetch(`${API_URL}/api/geofences?origin=${clientId.current}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: json,
      }).catch(() => void 0);
    }, 500);
    return () => clearTimeout(t);
  }, [fences]);

  const add = useCallback((f: Omit<Geofence, "id">): string => {
    const id = newId();
    setFences((prev) => [...prev, { ...f, id }]);
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<Geofence>) => {
    setFences((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const remove = useCallback((id: string) => {
    setFences((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clear = useCallback(() => setFences([]), []);

  const compiled = useMemo<CompiledFence[]>(
    () => fences.map(compileFence).filter((c): c is CompiledFence => c !== null),
    [fences],
  );

  return { fences, compiled, add, update, remove, clear };
}
