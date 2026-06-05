import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Geofence } from "@/geofence/types";
import { compileFence, type CompiledFence } from "@/geofence/geometry";

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
 * Owns geofence CRUD and keeps the backend in sync (it's the authoritative
 * evaluator). Local state is the working copy + localStorage cache; on mount we
 * reconcile with the backend (adopt its fences if we have none locally), then
 * debounce-push the full set to the backend whenever it changes.
 */
export function useGeofences() {
  const [fences, setFences] = useState<Geofence[]>(loadLocal);
  const ready = useRef(false); // gate syncing until the initial reconcile is done

  // Reconcile with the backend once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/geofences`)
      .then((r) => r.json())
      .then((d: { geofences: Geofence[] }) => {
        if (cancelled) return;
        const backend = d.geofences ?? [];
        // If we have nothing locally, adopt the backend's set; otherwise our
        // local set wins and will be pushed up by the sync effect below.
        setFences((local) => (local.length === 0 && backend.length > 0 ? backend : local));
      })
      .catch(() => void 0)
      .finally(() => {
        ready.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced push of the full fence list to the backend (+ localStorage cache).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fences));
    } catch {
      /* ignore */
    }
    if (!ready.current) return;
    const t = setTimeout(() => {
      fetch(`${API_URL}/api/geofences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fences),
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
