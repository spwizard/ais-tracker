// A MapLibre style for "cinematic" coastal mode: photoreal satellite imagery
// draped over real terrain, with hillshade relief and an atmospheric sky. All
// free, token-free sources (Esri World Imagery + AWS open terrain tiles), so it
// drops in without credentials. Terrain + sky are declared in the style so
// MapLibre applies them on load — no imperative setTerrain needed.
//
// Typed loosely (the react-map-gl mapStyle prop accepts a StyleSpecification or a
// URL; the full spec types are heavy and not worth importing for one object).
export const CINEMATIC_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri",
    },
    terrain: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 15,
      attribution: "Elevation: Mapzen / AWS Terrain Tiles",
    },
  },
  layers: [
    { id: "satellite", type: "raster", source: "satellite" },
    {
      id: "hillshade",
      type: "hillshade",
      source: "terrain",
      paint: {
        "hillshade-exaggeration": 0.45,
        "hillshade-shadow-color": "#0a1020",
        "hillshade-highlight-color": "#cfe0ff",
      },
    },
  ],
  terrain: { source: "terrain", exaggeration: 1.4 },
  sky: {
    "sky-color": "#0b1a3a",
    "sky-horizon-blend": 0.6,
    "horizon-color": "#3a5a8a",
    "horizon-fog-blend": 0.6,
    "fog-color": "#16233f",
    "fog-ground-blend": 0.4,
  },
} as unknown as string; // satisfies react-map-gl's mapStyle prop type
