/**
 * GB train layer (rail domain, Tier-1 inferred positions). Train glyphs
 * rotated by bearing, coloured by lateness, dead-reckoned between server
 * ticks so 125mph services glide instead of stepping. Visible at national
 * zoom — that's the whole point of a rail picture.
 */
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { RailStation, TrackedTrain } from "@/types";
import { deadReckon, DR_SCRATCH } from "./layers";
import { getTrainIconAtlas, TRAIN_ICON_MAPPING } from "./trainIcons";
import { getStationIconAtlas, STATION_ICON_MAPPING } from "./stationIcons";

export const TRAIN_MIN_ZOOM = 5;
// Stations fade in as you zoom: 2,600 dots are texture at national zoom,
// context at regional zoom, and labelled landmarks up close.
const STATION_DOT_ZOOM = 6.5;
const STATION_LABEL_ZOOM = 9.5;

const ON_TIME: [number, number, number] = [52, 211, 153]; // emerald
const LATE: [number, number, number] = [251, 191, 36]; // amber (<5 min)
const VERY_LATE: [number, number, number] = [244, 63, 94]; // rose (5+ min)
const SELECTED: [number, number, number] = [125, 211, 252];

function lateColor(d: TrackedTrain): [number, number, number] {
  const late = d.delay_min ?? 0;
  if (late >= 5) return VERY_LATE;
  if (late >= 1) return LATE;
  return ON_TIME;
}

export interface TrainLayerOptions {
  trains: TrackedTrain[];
  stations: RailStation[];
  railNetwork: unknown | null; // GB route geometry (Network Rail, GeoJSON)
  currentTime: number; // epoch seconds — drives the between-tick glide
  zoom: number;
  selectedId: string | null;
  onClick: (t: TrackedTrain | null) => void;
  onStationClick: (s: RailStation) => void;
}

export function buildTrainLayers(opts: TrainLayerOptions) {
  const { trains, stations, railNetwork, currentTime, zoom, selectedId, onClick, onStationClick } = opts;
  if (zoom < TRAIN_MIN_ZOOM) return [];

  const layers: unknown[] = [];

  // The actual lines: Network Rail's route geometry as a muted steel web —
  // context for the trains without competing with the tube's neon.
  if (railNetwork) {
    layers.push(
      new GeoJsonLayer({
        id: "rail-network",
        data: railNetwork as never,
        stroked: true,
        filled: false,
        getLineColor: [120, 136, 160, zoom >= 9 ? 110 : 70],
        getLineWidth: 1.4,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.75,
        updateTriggers: { getLineColor: zoom >= 9 },
      }),
    );
  }

  // Stations: platform-sign badges from regional zoom, names once close in.
  // Clicking one opens its live departure board.
  if (stations.length > 0 && zoom >= STATION_DOT_ZOOM) {
    layers.push(
      new IconLayer<RailStation>({
        id: "rail-stations",
        data: stations,
        pickable: true,
        iconAtlas: getStationIconAtlas(),
        iconMapping: STATION_ICON_MAPPING,
        getIcon: () => "station",
        getPosition: (d) => [d.lon, d.lat],
        getSize: zoom >= STATION_LABEL_ZOOM ? 16 : 12,
        sizeUnits: "pixels",
        sizeMinPixels: 9,
        sizeMaxPixels: 18,
        // National Rail red — the map convention for the double arrow.
        getColor: [225, 50, 55, zoom >= STATION_LABEL_ZOOM ? 245 : 175],
        onClick: (info) => {
          const st = info.object as RailStation | undefined;
          if (st) onStationClick(st);
        },
        updateTriggers: {
          getSize: zoom >= STATION_LABEL_ZOOM,
          getColor: zoom >= STATION_LABEL_ZOOM,
        },
      }),
    );
  }
  if (stations.length > 0 && zoom >= STATION_LABEL_ZOOM) {
    layers.push(
      new TextLayer<RailStation>({
        id: "rail-station-labels",
        data: stations,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name,
        getSize: 11,
        getColor: [203, 213, 225, 235],
        getPixelOffset: [0, -10],
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 500,
        outlineColor: [10, 16, 26],
        outlineWidth: 2,
        fontSettings: { sdf: true },
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
      }),
    );
  }

  if (trains.length === 0) return layers;

  // Selected train's route line (origin → destination through calling points),
  // with a ring on each calling point so the stops read at any zoom.
  const sel = selectedId ? trains.find((t) => t.id === selectedId) : null;
  if (sel && sel.stops.length >= 2) {
    layers.push(
      new PathLayer<{ path: [number, number][] }>({
        id: "train-route",
        data: [{ path: sel.stops.map((s) => [s.lon, s.lat] as [number, number]) }],
        getPath: (d) => d.path,
        getColor: [125, 211, 252, 140],
        getWidth: 2.5,
        widthMinPixels: 1.5,
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer<(typeof sel.stops)[number]>({
        id: "train-route-stops",
        data: sel.stops,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 4.5,
        radiusUnits: "pixels",
        filled: false,
        stroked: true,
        getLineColor: [125, 211, 252, 220],
        lineWidthMinPixels: 2,
      }),
    );
  }

  layers.push(
    new IconLayer<TrackedTrain>({
      id: "trains",
      data: trains,
      pickable: true,
      iconAtlas: getTrainIconAtlas(),
      iconMapping: TRAIN_ICON_MAPPING,
      getIcon: () => "train",
      // Glide along the last bearing at the reported segment speed between
      // server updates — the same dead reckoning ships use.
      getPosition: (d) =>
        deadReckon(
          d.lat as number, d.lon as number, d.bearing, d.speed_kn,
          currentTime - d.ts, DR_SCRATCH,
        ),
      getAngle: (d) => -(d.bearing ?? 0),
      getColor: (d) => (d.id === selectedId ? SELECTED : lateColor(d)),
      getSize: (d) => (d.id === selectedId ? 30 : 20),
      sizeUnits: "pixels",
      sizeMinPixels: 12,
      sizeMaxPixels: 36,
      onClick: (info) => onClick((info.object as TrackedTrain) ?? null),
      updateTriggers: {
        getPosition: currentTime,
        getColor: selectedId,
        getSize: selectedId,
      },
    }),
  );

  return layers;
}
