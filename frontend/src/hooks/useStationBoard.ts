import { useEffect, useState } from "react";
import type { RailBoard } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const REFRESH_MS = 30_000;

/** Live departure board for a station — refreshes while the panel is open. */
export function useStationBoard(station: string | null): RailBoard | null {
  const [board, setBoard] = useState<RailBoard | null>(null);

  useEffect(() => {
    if (!station) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(
          `${API_URL}/api/rail/board?station=${encodeURIComponent(station)}&limit=14`,
        ).then((r) => r.json());
        if (!cancelled) setBoard(d);
      } catch {
        /* transient — next tick retries */
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [station]);

  return board;
}
