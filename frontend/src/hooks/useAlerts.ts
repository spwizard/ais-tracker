import { useCallback, useEffect, useRef, useState } from "react";
import type { Alert, AlertsResponse } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const PAGE = 100;

export interface AlertFilter {
  search?: string;
  category?: "risk" | "geofence";
  kind?: string;
}

/** Paged alert history from /api/alerts. Refetches when the filter changes,
 *  exposes loadMore (offset paging) and a manual refresh, and polls for new
 *  alerts while active so the table stays live. */
export function useAlerts(active: boolean, filter: AlertFilter) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const query = useCallback(async (offset: number): Promise<AlertsResponse | null> => {
    const f = filterRef.current;
    const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (f.search?.trim()) qs.set("search", f.search.trim());
    if (f.category) qs.set("category", f.category);
    if (f.kind) qs.set("kind", f.kind);
    try {
      return await fetch(`${API_URL}/api/alerts?${qs}`).then((r) => r.json());
    } catch {
      return null;
    }
  }, []);

  // Reload from the top whenever the filter (or active) changes.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    query(0).then((r) => {
      if (!alive || !r) return;
      setAlerts(r.alerts);
      setTotal(r.total);
      setLoading(false);
    });
    // Poll for fresh alerts at the top of the list.
    const id = setInterval(() => {
      query(0).then((r) => {
        if (alive && r) {
          setAlerts(r.alerts);
          setTotal(r.total);
        }
      });
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active, filter.search, filter.category, filter.kind, query]);

  const loadMore = useCallback(async () => {
    const r = await query(alerts.length);
    if (r) setAlerts((prev) => [...prev, ...r.alerts]);
  }, [alerts.length, query]);

  return { alerts, total, loading, loadMore, hasMore: alerts.length < total };
}
