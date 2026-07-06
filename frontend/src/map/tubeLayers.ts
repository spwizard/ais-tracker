/**
 * London Underground layer — the network drawn as light.
 *
 * Three visual registers, tuned for the dark basemap:
 *   1. The lines: each drawn twice — a wide soft underglow plus a crisp core
 *      in the official line colour (dark colours get a lifted display variant
 *      so Northern/Piccadilly still read as light, not absence). Disrupted
 *      lines dim to a murmur, so network health is visible at a glance.
 *   2. Stations as roundel-ish markers: white centre, dark ring — larger for
 *      interchanges — with names appearing up close.
 *   3. The trains: hundreds of line-coloured dots with their own halo,
 *      gliding along the strands via dead reckoning between polls.
 */
import { IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { TubeLine, TubeStation, TubeTrain } from "@/types";
import { deadReckon, DR_SCRATCH } from "./layers";
import { getTrainIconAtlas, TRAIN_ICON_MAPPING } from "./trainIcons";

export const TUBE_MIN_ZOOM = 8.3; // the tube is a London artefact — appear with London
const LABEL_ZOOM = 12;
const TRAIN_ICON_ZOOM = 12.5; // dots become tiny train glyphs up close

type RGB = [number, number, number];

/** Official TfL line colours; `display` lifts the dark ones for a dark map. */
const LINE_COLORS: Record<string, { core: RGB; glow: RGB }> = {
  bakerloo: { core: [179, 99, 5], glow: [220, 140, 40] },
  central: { core: [227, 32, 23], glow: [255, 80, 70] },
  circle: { core: [255, 211, 0], glow: [255, 225, 80] },
  district: { core: [0, 150, 57], glow: [40, 200, 100] },
  "hammersmith-city": { core: [243, 169, 187], glow: [255, 195, 210] },
  jubilee: { core: [160, 165, 169], glow: [200, 205, 210] },
  metropolitan: { core: [155, 0, 86], glow: [210, 40, 130] },
  northern: { core: [125, 125, 135], glow: [170, 170, 180] }, // official black — lifted to read on dark
  piccadilly: { core: [40, 90, 220], glow: [90, 140, 255] }, // official #003688 lifted
  victoria: { core: [0, 152, 212], glow: [60, 190, 240] },
  "waterloo-city": { core: [149, 205, 186], glow: [180, 230, 210] },
};
const FALLBACK = { core: [148, 163, 184] as RGB, glow: [190, 200, 210] as RGB };

export function tubeColor(lineId: string): RGB {
  return (LINE_COLORS[lineId] ?? FALLBACK).core;
}

interface LinePath {
  lineId: string;
  name: string;
  status: string;
  ok: boolean;
  path: [number, number][];
}

export interface TubeLayerOptions {
  network: { lines: TubeLine[]; stations: TubeStation[] };
  trains: TubeTrain[];
  currentTime: number;
  zoom: number;
  onClickTrain: (t: TubeTrain | null) => void;
}

export function buildTubeLayers(opts: TubeLayerOptions) {
  const { network, trains, currentTime, zoom, onClickTrain } = opts;
  if (zoom < TUBE_MIN_ZOOM || network.lines.length === 0) return [];

  const layers: unknown[] = [];

  const paths: LinePath[] = [];
  for (const line of network.lines) {
    for (const p of line.paths) {
      paths.push({
        lineId: line.id,
        name: line.name,
        status: line.status,
        ok: line.severity >= 10,
        path: p,
      });
    }
  }

  // 1a. Underglow — wide, soft, additive-feeling on the dark map.
  layers.push(
    new PathLayer<LinePath>({
      id: "tube-glow",
      data: paths,
      getPath: (d) => d.path,
      getColor: (d) => {
        const c = (LINE_COLORS[d.lineId] ?? FALLBACK).glow;
        return [c[0], c[1], c[2], d.ok ? 70 : 28];
      },
      getWidth: 9,
      widthUnits: "pixels",
      widthMinPixels: 6,
      capRounded: true,
      jointRounded: true,
    }),
    // 1b. Core — crisp official colour; disrupted lines fade.
    new PathLayer<LinePath>({
      id: "tube-core",
      data: paths,
      pickable: true, // hover a line → its name + live status
      getPath: (d) => d.path,
      getColor: (d) => {
        const c = (LINE_COLORS[d.lineId] ?? FALLBACK).core;
        return [c[0], c[1], c[2], d.ok ? 235 : 110];
      },
      getWidth: 2.6,
      widthUnits: "pixels",
      widthMinPixels: 1.6,
      capRounded: true,
      jointRounded: true,
    }),
  );

  // 2. Stations — roundel-ish: dark ring, white centre; interchanges bigger.
  layers.push(
    new ScatterplotLayer<TubeStation>({
      id: "tube-stations",
      data: network.stations,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.lines.length > 1 ? 4.4 : 3),
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      radiusMaxPixels: 7,
      getFillColor: [245, 248, 252, 235],
      stroked: true,
      getLineColor: [12, 18, 32, 230],
      lineWidthMinPixels: 1.6,
    }),
  );
  if (zoom >= LABEL_ZOOM) {
    layers.push(
      new TextLayer<TubeStation>({
        id: "tube-station-labels",
        data: network.stations,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name,
        getSize: 11.5,
        getColor: [226, 232, 240, 240],
        getPixelOffset: [0, -12],
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 600,
        outlineColor: [10, 16, 26],
        outlineWidth: 2,
        fontSettings: { sdf: true },
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
      }),
    );
  }

  // 3. The trains — halo + dot in the line colour, gliding between polls.
  if (trains.length > 0) {
    const pos = (d: TubeTrain) =>
      deadReckon(
        d.lat as number, d.lon as number, d.bearing, d.speed_kn,
        currentTime - d.ts, DR_SCRATCH,
      );
    layers.push(
      new ScatterplotLayer<TubeTrain>({
        id: "tube-train-halo",
        data: trains,
        getPosition: pos,
        getRadius: 8,
        radiusUnits: "pixels",
        getFillColor: (d) => {
          const c = tubeColor(d.line);
          return [c[0], c[1], c[2], 55];
        },
        updateTriggers: { getPosition: currentTime },
      }),
      zoom >= TRAIN_ICON_ZOOM
        ? new IconLayer<TubeTrain>({
            id: "tube-trains",
            data: trains,
            pickable: true,
            iconAtlas: getTrainIconAtlas(),
            iconMapping: TRAIN_ICON_MAPPING,
            getIcon: () => "train",
            getPosition: pos,
            getAngle: (d) => -(d.bearing ?? 0),
            getColor: (d) => tubeColor(d.line),
            getSize: 18,
            sizeUnits: "pixels",
            onClick: (info) => onClickTrain((info.object as TubeTrain) ?? null),
            updateTriggers: { getPosition: currentTime },
          })
        : new ScatterplotLayer<TubeTrain>({
            id: "tube-trains",
            data: trains,
            pickable: true,
            getPosition: pos,
            getRadius: 4,
            radiusUnits: "pixels",
            radiusMinPixels: 3,
            getFillColor: (d) => {
              const c = tubeColor(d.line);
              return [c[0], c[1], c[2], 255];
            },
            stroked: true,
            getLineColor: [255, 255, 255, 220],
            lineWidthMinPixels: 1.2,
            onClick: (info) => onClickTrain((info.object as TubeTrain) ?? null),
            updateTriggers: { getPosition: currentTime },
          }),
    );
  }

  return layers;
}
