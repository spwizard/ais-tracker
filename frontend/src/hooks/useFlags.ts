import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type Flags = Record<string, boolean>;

// Match backend defaults — used until /api/flags loads (or if the fetch fails).
const FLAG_DEFAULTS: Flags = {
  ownership: true,
  risk_engine: true,
  llm_briefing: true,
};

// Fetched once and shared across the app.
let cache: Flags | null = null;
let inflight: Promise<Flags> | null = null;

function load(): Promise<Flags> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch(`${API_URL}/api/flags`)
    .then((r) => r.json())
    .then((d: { flags: Flags }) => {
      cache = { ...FLAG_DEFAULTS, ...(d.flags ?? {}) };
      return cache;
    })
    .catch(() => {
      cache = { ...FLAG_DEFAULTS };
      return cache;
    });
  return inflight;
}

/** Returns the feature-flag map (empty until loaded). */
export function useFlags(): Flags {
  const [flags, setFlags] = useState<Flags>(cache ?? {});
  useEffect(() => {
    let cancelled = false;
    load().then((f) => !cancelled && setFlags(f));
    return () => {
      cancelled = true;
    };
  }, []);
  return flags;
}

/** Convenience: is a single flag on? */
export function useFlag(name: string): boolean {
  const flags = useFlags();
  if (name in flags) return flags[name];
  return FLAG_DEFAULTS[name] ?? false;
}
