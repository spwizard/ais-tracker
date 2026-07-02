import { Tile3DLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// Served by our backend proxy, which injects the Google API key server-side — the
// key never reaches the browser. Child tile URIs are host-relative
// (/v1/3dtiles/...) so they resolve back through the same proxy. Availability is
// reported by the `google_3d` feature flag (true when the backend has a key).
const GOOGLE_3D_TILESET = `${API_URL}/v1/3dtiles/root.json`;

/** Minimal dark MapLibre style for when Google's photoreal mesh is the world —
 *  the basemap just provides a backdrop colour behind the 3D tiles. */
export const EMPTY_DARK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#070b14" } }],
} as unknown as string;

/** Google Photorealistic 3D Tiles as a deck.gl Tile3DLayer, via our key-proxy.
 *  `onAttribution` receives Google's required, dynamic copyright string. */
export function buildGoogle3DLayer(onAttribution?: (text: string) => void) {
  return new Tile3DLayer({
    id: "google-3d-tiles",
    data: GOOGLE_3D_TILESET,
    loader: Tiles3DLoader,
    // Google's tiles are pre-lit photogrammetry; keep deck's lighting neutral.
    _lighting: "flat",
    // Coarser LOD + a bounded tile cache. Photoreal tiles are very memory-heavy;
    // the default fine LOD + unbounded cache can balloon a tab past 1 GB.
    maximumScreenSpaceError: 24,
    onTilesetLoad: (tileset: {
      credits?: { copyright?: string };
      options?: Record<string, unknown>;
    }) => {
      if (tileset?.options) {
        tileset.options.maximumScreenSpaceError = 24; // higher = less detail/memory
        // 256 MB cache: keeps the tab's footprint in check. Revisiting an area
        // re-streams a little more than a larger cache would, but photoreal tiles
        // are heavy, so this is the better default for overall memory.
        tileset.options.maximumMemoryUsage = 256;
      }
      const text = tileset?.credits?.copyright;
      if (text && onAttribution) onAttribution(text);
    },
  });
}
