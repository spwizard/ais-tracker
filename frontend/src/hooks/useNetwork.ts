import { useEffect, useState } from "react";
import type { OwnershipNetwork } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Fetch the ownership network for a vessel (when mmsi is set). */
export function useNetwork(mmsi: number | null) {
  const [state, setState] = useState<{
    loading: boolean;
    data: OwnershipNetwork | null;
  }>({ loading: false, data: null });

  useEffect(() => {
    if (mmsi == null) {
      setState({ loading: false, data: null });
      return;
    }
    let cancelled = false;
    setState({ loading: true, data: null });
    fetch(`${API_URL}/api/vessel/${mmsi}/network`)
      .then((r) => r.json())
      .then((d: { network: OwnershipNetwork | null }) => {
        if (!cancelled) setState({ loading: false, data: d.network });
      })
      .catch(() => !cancelled && setState({ loading: false, data: null }));
    return () => {
      cancelled = true;
    };
  }, [mmsi]);

  return state;
}
