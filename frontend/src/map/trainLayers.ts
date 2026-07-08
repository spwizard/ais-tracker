/**
 * GB train layer (rail domain, Tier-1 inferred positions). Train glyphs
 * rotated by bearing, coloured by lateness, dead-reckoned between server
 * ticks so 125mph services glide instead of stepping. Visible at national
 * zoom — that's the whole point of a rail picture.
 */
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { CollisionFilterExtension } from "@deck.gl/extensions";
import type { RailStation, TrackedTrain } from "@/types";
import { deadReckon, DR_SCRATCH } from "./layers";
import { getTrainIconAtlas, TRAIN_ICON_MAPPING } from "./trainIcons";
import { getStationIconAtlas, STATION_ICON_MAPPING } from "./stationIcons";

export const TRAIN_MIN_ZOOM = 5;
// Stations fade in as you zoom: 2,600 badges are texture at national zoom,
// context at regional zoom, and labelled landmarks up close. Both the badges
// and the labels are collision-filtered so central London reads cleanly
// instead of becoming a wall of overlapping arrows and text.
const STATION_DOT_ZOOM = 6.5;
const STATION_LABEL_ZOOM = 11; // labels only once a borough fills the view

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
  // Delay-hotspot mode: draw only the network as faint context and let the
  // heat/clusters read cleanly — trains, badges and labels are suppressed.
  hotspotsMode?: boolean;
}

export function buildTrainLayers(opts: TrainLayerOptions) {
  const { trains, stations, railNetwork, currentTime, zoom, selectedId, onClick, onStationClick, hotspotsMode } = opts;
  if (zoom < TRAIN_MIN_ZOOM) return [];

  const layers: unknown[] = [];

  // The actual lines: Network Rail's route geometry as a muted steel web —
  // context for the trains without competing with the tube's neon. In hotspot
  // mode it's dimmed further so the heat is unmistakably the foreground.
  if (railNetwork) {
    layers.push(
      new GeoJsonLayer({
        id: "rail-network",
        data: railNetwork as never,
        stroked: true,
        filled: false,
        getLineColor: hotspotsMode ? [90, 104, 126, 60] : [120, 136, 160, zoom >= 9 ? 110 : 70],
        getLineWidth: 1.4,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 0.75,
        updateTriggers: { getLineColor: hotspotsMode || zoom >= 9 },
      }),
    );
  }

  // In hotspot mode, stop here — the heatmap layers (added by MapView on top)
  // are the whole point, and trains/badges/labels would just be noise.
  if (hotspotsMode) return layers;

  // Stations: platform-sign badges from regional zoom, names once close in.
  // Clicking one opens its live departure board. Collision filtering drops
  // badges that would overlap so dense areas stay legible rather than a
  // solid mat of red arrows; the badges also stay muted so the live trains
  // (the data) read as the foreground.
  const stationClose = zoom >= STATION_LABEL_ZOOM;
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
        getSize: stationClose ? 15 : 11,
        sizeUnits: "pixels",
        sizeMinPixels: 8,
        sizeMaxPixels: 17,
        // National Rail red — the map convention for the double arrow. Kept
        // a touch translucent so the coloured trains stand out against it.
        getColor: [214, 60, 64, stationClose ? 220 : 150],
        extensions: [new CollisionFilterExtension()],
        // CollisionFilterExtension injects these props at runtime — TS can't see them.
        ...({
          collisionEnabled: true,
          collisionGroup: "rail-station-badges",
          collisionTestProps: { sizeScale: 2.2 }, // breathing room per badge
        } as object),
        onClick: (info) => {
          const st = info.object as RailStation | undefined;
          if (st) onStationClick(st);
        },
        updateTriggers: { getSize: stationClose, getColor: stationClose },
      }),
    );
  }
  if (stations.length > 0 && stationClose) {
    layers.push(
      new TextLayer<RailStation>({
        id: "rail-station-labels",
        data: stations,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name,
        getSize: 11,
        getColor: [206, 216, 228, 240],
        getPixelOffset: [0, -11],
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 500,
        outlineColor: [10, 16, 26],
        outlineWidth: 2,
        fontSettings: { sdf: true },
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        // Hide any label that would overlap another — deck keeps a clean,
        // non-colliding subset instead of stacking every name.
        extensions: [new CollisionFilterExtension()],
        ...({
          collisionEnabled: true,
          collisionGroup: "rail-station-labels",
          getCollisionPriority: (d: RailStation) => -d.name.length, // shorter names win ties
        } as object),
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
