/**
 * GB train layer (rail domain, Tier-1 inferred positions). Train glyphs
 * rotated by bearing, coloured by lateness, dead-reckoned between server
 * ticks so 125mph services glide instead of stepping. Visible at national
 * zoom — that's the whole point of a rail picture.
 */
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { RailStation, TrackedTrain } from "@/types";
import { deadReckon, DR_SCRATCH } from "./layers";
import { getTrainIconAtlas, TRAIN_ICON_MAPPING } from "./trainIcons";

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
  currentTime: number; // epoch seconds — drives the between-tick glide
  zoom: number;
  selectedId: string | null;
  onClick: (t: TrackedTrain | null) => void;
}

export function buildTrainLayers(opts: TrainLayerOptions) {
  const { trains, stations, currentTime, zoom, selectedId, onClick } = opts;
  if (zoom < TRAIN_MIN_ZOOM) return [];

  const layers: unknown[] = [];

  // Stations: subtle dots from regional zoom, names once close in.
  if (stations.length > 0 && zoom >= STATION_DOT_ZOOM) {
    layers.push(
      new ScatterplotLayer<RailStation>({
        id: "rail-stations",
        data: stations,
        pickable: true,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 3,
        radiusUnits: "pixels",
        radiusMinPixels: 2,
        radiusMaxPixels: 5,
        getFillColor: [148, 163, 184, zoom >= STATION_LABEL_ZOOM ? 230 : 150],
        stroked: true,
        getLineColor: [15, 23, 42, 200],
        lineWidthMinPixels: 1,
        updateTriggers: { getFillColor: zoom >= STATION_LABEL_ZOOM },
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
