/**
 * London bus layer (BODS SIRI-VM) — the land-domain *moving* vehicles. Bus
 * glyphs rotated by bearing, TfL red for TfL-operated buses; the selected bus
 * highlights and shows its recent trail. Only shown once zoomed into London.
 */
import { IconLayer, PathLayer } from "@deck.gl/layers";
import type { TrackedBus } from "@/types";
import { getBusIconAtlas, BUS_ICON_MAPPING } from "./busIcons";

// Below this the ~8k London buses are just a red blob — hide them.
export const BUS_MIN_ZOOM = 9;

const TFL_RED: [number, number, number] = [226, 45, 38];
const OTHER: [number, number, number] = [251, 191, 36];
const SELECTED: [number, number, number] = [125, 211, 252];

export interface BusLayerOptions {
  buses: TrackedBus[];
  zoom: number;
  selectedId: string | null;
  onClick: (b: TrackedBus | null) => void;
}

export function buildBusLayers(opts: BusLayerOptions) {
  const { buses, zoom, selectedId, onClick } = opts;
  if (zoom < BUS_MIN_ZOOM || buses.length === 0) return [];

  const layers: unknown[] = [];

  // Selected bus's recent trail.
  const sel = selectedId ? buses.find((b) => b.id === selectedId) : null;
  if (sel && sel.trail.length >= 2) {
    layers.push(
      new PathLayer<[number, number, number][]>({
        id: "bus-trail",
        data: [sel.trail],
        getPath: (d) => d.map((p) => [p[0], p[1]]) as [number, number][],
        getColor: [125, 211, 252, 180],
        getWidth: 3,
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
      }),
    );
  }

  layers.push(
    new IconLayer<TrackedBus>({
      id: "buses",
      data: buses,
      pickable: true,
      iconAtlas: getBusIconAtlas(),
      iconMapping: BUS_ICON_MAPPING,
      getIcon: () => "bus",
      getPosition: (d) => [d.lon as number, d.lat as number],
      getAngle: (d) => -(d.bearing ?? 0),
      getColor: (d) =>
        d.id === selectedId ? SELECTED : d.operator === "TFLO" ? TFL_RED : OTHER,
      getSize: (d) => (d.id === selectedId ? 28 : 17),
      sizeUnits: "pixels",
      sizeMinPixels: 10,
      sizeMaxPixels: 34,
      onClick: (info) => onClick((info.object as TrackedBus) ?? null),
      updateTriggers: {
        getColor: selectedId,
        getSize: selectedId,
      },
    }),
  );

  return layers;
}
