import { useEffect, useState } from "react";
import type { Ownership } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Fetch Lloyd's ownership for a vessel (when enabled). null while loading/none. */
export function useOwnership(
  mmsi: number | null,
  enabled: boolean,
): Ownership | null {
  const [own, setOwn] = useState<Ownership | null>(null);

  useEffect(() => {
    if (!enabled || mmsi == null) {
      setOwn(null);
      return;
    }
    let cancelled = false;
    setOwn(null);
    fetch(`${API_URL}/api/vessel/${mmsi}/ownership`)
      .then((r) => r.json())
      .then((d: { ownership: Ownership | null }) => {
        if (!cancelled) setOwn(d.ownership);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [mmsi, enabled]);

  return own;
}
