import { useCallback, useEffect, useRef, useState } from "react";
import type { DensityPoint } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Historical traffic-density timeline: the list of available time buckets,
 *  plus a cached per-bucket point fetcher. */
export function useDensity() {
  const [buckets, setBuckets] = useState<number[]>([]);
  const cache = useRef<Map<number, DensityPoint[]>>(new Map());

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API_URL}/api/density`)
        .then((r) => r.json())
        .then((d: { buckets: number[] }) => alive && setBuckets(d.buckets ?? []))
        .catch(() => void 0);
    load();
    const id = setInterval(load, 60_000); // new buckets appear as it runs
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const fetchBucket = useCallback(async (b: number): Promise<DensityPoint[]> => {
    const hit = cache.current.get(b);
    if (hit) {
      // Refresh recency (Map iterates in insertion order).
      cache.current.delete(b);
      cache.current.set(b, hit);
      return hit;
    }
    const d = await fetch(`${API_URL}/api/density/${b}`)
      .then((r) => r.json())
      .catch(() => ({ points: [] }));
    const pts: DensityPoint[] = d.points ?? [];
    cache.current.set(b, pts);
    // LRU: scrubbing a 24h timeline shouldn't retain every bucket forever.
    while (cache.current.size > 20) {
      const oldest = cache.current.keys().next().value;
      if (oldest == null) break;
      cache.current.delete(oldest);
    }
    return pts;
  }, []);

  return { buckets, fetchBucket };
}
