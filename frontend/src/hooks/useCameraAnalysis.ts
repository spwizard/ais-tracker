import { useCallback, useEffect, useState } from "react";
import type { CameraAnalysis } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface State {
  loading: boolean;
  data: CameraAnalysis | null;
  error: string | null;
}

/**
 * On-demand Claude-vision analysis of a camera's current snapshot. Mirrors the
 * vessel briefing hook: a `run()` callback fires the request; state resets when
 * the selected camera changes so a stale analysis never lingers.
 */
export function useCameraAnalysis(cameraId: string | null) {
  const [state, setState] = useState<State>({ loading: false, data: null, error: null });

  useEffect(() => {
    setState({ loading: false, data: null, error: null });
  }, [cameraId]);

  const run = useCallback(async () => {
    if (!cameraId) return;
    setState({ loading: true, data: null, error: null });
    try {
      const r = await fetch(
        `${API_URL}/api/cameras/${encodeURIComponent(cameraId)}/analyze`,
        { method: "POST" },
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail ?? `Request failed (${r.status})`);
      }
      const d: { analysis: CameraAnalysis } = await r.json();
      setState({ loading: false, data: d.analysis, error: null });
    } catch (e) {
      setState({
        loading: false,
        data: null,
        error: e instanceof Error ? e.message : "Analysis failed",
      });
    }
  }, [cameraId]);

  return { ...state, run };
}
