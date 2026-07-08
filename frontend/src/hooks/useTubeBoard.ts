import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const REFRESH_MS = 20_000;

export interface TubeService {
  line: string | null;
  line_name: string | null;
  to: string;
  tts: number | null; // seconds to station
  platform: string | null;
}
export interface TubeBoard {
  station: string | null;
  services: TubeService[];
}

/** Live tube departure board for a station (by naptan id). */
export function useTubeBoard(stationId: string | null): TubeBoard | null {
  const [board, setBoard] = useState<TubeBoard | null>(null);
  useEffect(() => {
    if (!stationId) {
      setBoard(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const d = await fetch(`${API_URL}/api/tube/board?id=${encodeURIComponent(stationId)}`).then((r) => r.json());
        if (!cancelled) setBoard(d);
      } catch {
        /* transient */
      }
      if (!cancelled) timer = window.setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [stationId]);
  return board;
}
