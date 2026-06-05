import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export type Flags = Record<string, boolean>;

// Fetched once and shared across the app.
let cache: Flags | null = null;
let inflight: Promise<Flags> | null = null;

function load(): Promise<Flags> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch(`${API_URL}/api/flags`)
    .then((r) => r.json())
    .then((d: { flags: Flags }) => {
      cache = d.flags ?? {};
      return cache;
    })
    .catch(() => {
      cache = {};
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
  return useFlags()[name] ?? false;
}
