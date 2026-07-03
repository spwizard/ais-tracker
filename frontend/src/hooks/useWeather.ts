import { useEffect, useRef, useState } from "react";
import { loadTextureData } from "weatherlayers-gl/client";
import type { ForecastStep, WeatherMeta, WeatherResponse } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// loadTextureData returns weatherlayers' TextureData; kept loose to avoid
// importing its internal type.
type TextureData = Awaited<ReturnType<typeof loadTextureData>>;

// Each decoded raster is a multi-MB typed array; scrubbing across the ~7
// forecast steps (× wind and waves) used to retain them all until the next GFS
// cycle. Keep only the most recent few — going back a step re-fetches, which is
// fast, while the tab no longer accumulates hundreds of MB of textures.
const CACHE_MAX = 3;

export interface WeatherField {
  image: TextureData | null;
  meta: WeatherMeta | null; // bounds + imageUnscale for the displayed step
  steps: ForecastStep[]; // forecast hours available (for the scrubber)
  available: boolean;
}

/** Nearest available step at or below the requested forecast hour. */
function pickStep(steps: ForecastStep[], hour: number): ForecastStep | null {
  if (steps.length === 0) return null;
  const exact = steps.find((s) => s.step === hour);
  if (exact) return exact;
  return steps.reduce((a, b) =>
    Math.abs(b.step - hour) < Math.abs(a.step - hour) ? b : a,
  );
}

/**
 * Loads a GFS raster field for a deck.gl layer. `metaEnabled` (the feature flag)
 * polls the forecast metadata so the layer's toggle/scrubber can appear; the
 * texture for `hour` is only fetched when `active` (the layer is toggled on).
 * Decoded textures are cached per cycle+step so scrubbing back is instant.
 */
function useWeatherField(
  metaEnabled: boolean,
  kind: "wind" | "waves",
  hour: number,
  active: boolean,
): WeatherField {
  const [resp, setResp] = useState<WeatherResponse | null>(null);
  const [frame, setFrame] = useState<{ image: TextureData; meta: WeatherMeta } | null>(null);
  const cache = useRef<Map<string, TextureData>>(new Map());

  // Poll the metadata (cheap JSON) while the feature is enabled.
  useEffect(() => {
    if (!metaEnabled) return;
    let alive = true;
    const load = async () => {
      try {
        const r: WeatherResponse = await fetch(`${API_URL}/api/weather/${kind}`).then((x) =>
          x.json(),
        );
        if (alive && r.available) setResp(r);
      } catch {
        /* offline / no field yet — ignore */
      }
    };
    load();
    const id = setInterval(load, 3_600_000); // re-check hourly for a new cycle
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [metaEnabled, kind]);

  // A new cycle invalidates every cached frame.
  useEffect(() => {
    cache.current.clear();
  }, [resp?.cycle]);

  // Load (or reuse) the texture for the requested forecast hour.
  useEffect(() => {
    if (!metaEnabled || !active || !resp?.available) {
      setFrame(null);
      return;
    }
    const step = pickStep(resp.steps, hour);
    if (!step) return;
    let alive = true;
    const key = `${kind}-${resp.cycle}-${step.step}`;
    const meta: WeatherMeta = { bounds: resp.bounds, imageUnscale: step.imageUnscale };
    const cached = cache.current.get(key);
    if (cached) {
      // Re-insert to refresh recency (Map iterates in insertion order).
      cache.current.delete(key);
      cache.current.set(key, cached);
      setFrame({ image: cached, meta });
      return;
    }
    loadTextureData(
      `${API_URL}/api/weather/${kind}.png?step=${step.step}&v=${encodeURIComponent(resp.updated)}`,
    )
      .then((image) => {
        if (!alive) return;
        cache.current.set(key, image);
        // LRU: evict the oldest entries beyond the cap.
        while (cache.current.size > CACHE_MAX) {
          const oldest = cache.current.keys().next().value;
          if (oldest == null) break;
          cache.current.delete(oldest);
        }
        setFrame({ image, meta });
      })
      .catch(() => void 0);
    return () => {
      alive = false;
    };
  }, [metaEnabled, active, kind, hour, resp]);

  return {
    image: frame?.image ?? null,
    meta: frame?.meta ?? null,
    steps: resp?.steps ?? [],
    available: !!resp?.available,
  };
}

/** GFS 10 m wind field (particle overlay + speed raster). */
export function useWeather(metaEnabled: boolean, hour: number, active: boolean): WeatherField {
  return useWeatherField(metaEnabled, "wind", hour, active);
}

/** GFS-Wave significant-wave-height field (sea-state raster). */
export function useWaves(metaEnabled: boolean, hour: number, active: boolean): WeatherField {
  return useWeatherField(metaEnabled, "waves", hour, active);
}
