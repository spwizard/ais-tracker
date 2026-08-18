/**
 * The eyes — every data layer the map can show, in the order the Eyes rail
 * lists them. Keys are the `?layers=` slugs (stable API — don't rename).
 *
 * `coverage` is where a layer *can* have data at all (the feed's footprint);
 * outside it the rail folds the layer under "Elsewhere" with a link to `home`,
 * instead of offering a switch that would show nothing. Layers with no
 * `coverage` are global for our purposes.
 */
import type { RegionView } from "./regions";

export type LayerKey =
  | "vessels"
  | "ferry"
  | "air"
  | "incidents"
  | "cameras"
  | "bus"
  | "train"
  | "tube"
  | "fire"
  | "hazards";

export interface LayerMeta {
  key: LayerKey;
  label: string;
  hint: string;
  coverage?: [number, number, number, number]; // [w, s, e, n]
  /** Where to fly when the user asks "take me to where this has data". */
  home?: RegionView;
  homeLabel?: string;
}

export const LAYERS: LayerMeta[] = [
  {
    key: "vessels",
    label: "Vessels",
    hint: "The live sea picture (AIS): ships, ferries, fishing, yachts.",
  },
  {
    key: "ferry",
    label: "Ferry status",
    hint: "CalMac + NorthLink routes coloured by live service status.",
    coverage: [-8.5, 54.5, 0.0, 61.2],
    home: { longitude: -5.6, latitude: 56.4, zoom: 7 },
    homeLabel: "West coast",
  },
  {
    key: "air",
    label: "Air traffic",
    hint: "Live ADS-B aircraft, coloured by altitude.",
  },
  {
    key: "incidents",
    label: "Incidents",
    hint: "Live located road incidents — collisions, hazards, closures. Click one to turn nearby cameras on it.",
    coverage: [-11.5, 49.0, 3.5, 61.5],
    home: { longitude: -0.11, latitude: 51.5, zoom: 11 },
    homeLabel: "London",
  },
  {
    key: "cameras",
    label: "Traffic cameras",
    hint: "TfL JamCams in London and Traffic Scotland trunk-road cameras — zoom in, then click one.",
    coverage: [-11.5, 49.0, 3.5, 61.5],
    home: { longitude: -0.11, latitude: 51.5, zoom: 11 },
    homeLabel: "London",
  },
  {
    key: "bus",
    label: "Buses & coaches",
    hint: "London buses (BODS) and Ember coaches across Scotland.",
    coverage: [-11.5, 49.0, 3.5, 61.5],
    home: { longitude: -0.11, latitude: 51.5, zoom: 11 },
    homeLabel: "London",
  },
  {
    key: "train",
    label: "Trains (GB)",
    hint: "Every GB passenger train, interpolated live from Darwin.",
    coverage: [-11.5, 49.0, 3.5, 61.5],
    home: { longitude: -1.5, latitude: 52.5, zoom: 6.5 },
    homeLabel: "Great Britain",
  },
  {
    key: "tube",
    label: "Underground",
    hint: "Tube lines in official colours, dimmed by live status, trains inferred from arrivals.",
    coverage: [-0.65, 51.2, 0.4, 51.8],
    home: { longitude: -0.11, latitude: 51.5, zoom: 11 },
    homeLabel: "London",
  },
  {
    key: "fire",
    label: "Wildfires",
    hint: "NASA FIRMS satellite detections clustered into live fire complexes, with wind and downwind towns.",
    coverage: [-11.0, 35.5, 9.5, 61.5],
    home: { longitude: -1.5, latitude: 41.5, zoom: 5.3 },
    homeLabel: "Iberia",
  },
  {
    key: "hazards",
    label: "Floods · weather · quakes",
    hint: "SEPA flood warnings, Met Office warnings and BGS earthquakes.",
    coverage: [-8.5, 54.5, 0.0, 61.2],
    home: { longitude: -4.3, latitude: 56.8, zoom: 6.3 },
    homeLabel: "Scotland",
  },
];

export const LAYER_BY_KEY: Record<LayerKey, LayerMeta> = Object.fromEntries(
  LAYERS.map((l) => [l.key, l]),
) as Record<LayerKey, LayerMeta>;
