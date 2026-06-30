import { Tile3DLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? "";
export const hasGoogle3D = !!GOOGLE_MAPS_KEY;

const GOOGLE_TILESET = "https://tile.googleapis.com/v1/3dtiles/root.json";

/** Minimal dark MapLibre style for when Google's photoreal mesh is the world —
 *  the basemap just provides a backdrop colour behind the 3D tiles. */
export const EMPTY_DARK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#070b14" } }],
} as unknown as string;

/** Google Photorealistic 3D Tiles as a deck.gl Tile3DLayer. The API key goes in
 *  the X-GOOG-API-KEY header (not the URL), so child-tile requests inherit it.
 *  `onAttribution` receives Google's required, dynamic copyright string. */
export function buildGoogle3DLayer(onAttribution?: (text: string) => void) {
  return new Tile3DLayer({
    id: "google-3d-tiles",
    data: GOOGLE_TILESET,
    loader: Tiles3DLoader,
    loadOptions: {
      fetch: { headers: { "X-GOOG-API-KEY": GOOGLE_MAPS_KEY } },
    },
    // Google's tiles are pre-lit photogrammetry; keep deck's lighting neutral.
    _lighting: "flat",
    // Coarser LOD + a bounded tile cache. Photoreal tiles are very memory-heavy;
    // the default fine LOD + unbounded cache can balloon a tab past 1 GB. These
    // trade a little crispness for a much smaller footprint and faster streaming.
    maximumScreenSpaceError: 24,
    onTilesetLoad: (tileset: {
      credits?: { copyright?: string };
      options?: Record<string, unknown>;
    }) => {
      if (tileset?.options) {
        tileset.options.maximumScreenSpaceError = 24; // higher = less detail/memory
        // 512 MB cache: fewer evictions, so revisiting an area (e.g. the Solent)
        // reuses tiles from memory instead of re-streaming — at a higher footprint
        // than 256, but still well under the ~1.4 GB an uncapped cache reached.
        tileset.options.maximumMemoryUsage = 512;
      }
      const text = tileset?.credits?.copyright;
      if (text && onAttribution) onAttribution(text);
    },
  });
}
