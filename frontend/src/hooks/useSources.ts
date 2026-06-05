import { useEffect, useState } from "react";
import type { SourceStatus } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Polls the backend for upstream-source health every few seconds. */
export function useSources(): SourceStatus[] {
  const [sources, setSources] = useState<SourceStatus[]>([]);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      fetch(`${API_URL}/api/sources`)
        .then((r) => r.json())
        .then((d: { sources: SourceStatus[] }) => {
          if (!cancelled) setSources(d.sources ?? []);
        })
        .catch(() => void 0);
    poll();
    const id = window.setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return sources;
}
