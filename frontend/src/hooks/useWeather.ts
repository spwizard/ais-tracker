import { useEffect, useRef, useState } from "react";
import { loadTextureData } from "weatherlayers-gl/client";
import type { WeatherMeta } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// loadTextureData returns weatherlayers' TextureData; kept loose to avoid
// importing its internal type.
type TextureData = Awaited<ReturnType<typeof loadTextureData>>;

/** Loads the GFS wind field (metadata + decoded velocity texture) for the
 *  particle layer. Reloads only when a new forecast cycle is published. */
export function useWeather(enabled: boolean) {
  const [data, setData] = useState<{ image: TextureData | null; meta: WeatherMeta | null }>({
    image: null,
    meta: null,
  });
  const cycleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const meta: WeatherMeta = await fetch(`${API_URL}/api/weather/wind`).then((r) =>
          r.json(),
        );
        if (!alive || !meta.available || meta.cycle === cycleRef.current) return;
        const image = await loadTextureData(
          `${API_URL}/api/weather/wind.png?c=${encodeURIComponent(meta.cycle)}`,
        );
        if (!alive) return;
        cycleRef.current = meta.cycle;
        setData({ image, meta });
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
  }, [enabled]);

  return data;
}
