import { useEffect, useState } from "react";
import type { RiskAssessment } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Fetch the composite risk assessment for a vessel (when enabled). */
export function useRisk(
  mmsi: number | null,
  enabled: boolean,
): RiskAssessment | null {
  const [risk, setRisk] = useState<RiskAssessment | null>(null);

  useEffect(() => {
    if (!enabled || mmsi == null) {
      setRisk(null);
      return;
    }
    let cancelled = false;
    setRisk(null);
    fetch(`${API_URL}/api/vessel/${mmsi}/risk`)
      .then((r) => r.json())
      .then((d: { risk: RiskAssessment | null }) => {
        if (!cancelled) setRisk(d.risk);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [mmsi, enabled]);

  return risk;
}
