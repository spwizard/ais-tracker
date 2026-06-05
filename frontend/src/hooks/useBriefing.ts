import { useCallback, useEffect, useState } from "react";
import type { BriefingResponse } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface BriefingState {
  loading: boolean;
  data: BriefingResponse | null;
  error: string | null;
}

/** On-demand Claude risk briefing for a vessel. Call `generate()` to fetch;
 *  state resets when the selected vessel changes. */
export function useBriefing(mmsi: number | null) {
  const [state, setState] = useState<BriefingState>({
    loading: false,
    data: null,
    error: null,
  });

  useEffect(() => {
    setState({ loading: false, data: null, error: null });
  }, [mmsi]);

  const generate = useCallback(async (web = false) => {
    if (mmsi == null) return;
    setState({ loading: true, data: null, error: null });
    try {
      const r = await fetch(
        `${API_URL}/api/vessel/${mmsi}/briefing?web=${web}`,
        { method: "POST" },
      );
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `Request failed (${r.status})`);
      }
      const data: BriefingResponse = await r.json();
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : "Briefing failed",
      });
    }
  }, [mmsi]);

  return { ...state, generate };
}
