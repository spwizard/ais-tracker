/**
 * Bus layer — the land-domain *moving* vehicles. Bus glyphs rotated by
 * bearing, TfL red for London TfL buses, Ember green for Scottish intercity
 * coaches; the selected bus highlights and shows its recent trail.
 *
 * Two zoom tiers: city buses (BODS's ~8k London fleet) appear only when zoomed
 * into a city, but the handful of intercity coaches read from country scale —
 * they'd be invisible at city-only zoom over a map the size of Scotland.
 */
import { IconLayer, PathLayer } from "@deck.gl/layers";
import type { TrackedBus } from "@/types";
import { getBusIconAtlas, BUS_ICON_MAPPING } from "./busIcons";

// Below this the ~8k London buses are just a red blob — hide them.
export const BUS_MIN_ZOOM = 9;
// Intercity coaches (Ember) show from country scale.
export const COACH_MIN_ZOOM = 5;

const TFL_RED: [number, number, number] = [226, 45, 38];
const EMBER_GREEN: [number, number, number] = [52, 211, 153];
const OTHER: [number, number, number] = [251, 191, 36];
const SELECTED: [number, number, number] = [125, 211, 252];

// Zoom-tier subset cached by (buses, tier) identity — built every 10Hz tick.
let _tier: { buses: TrackedBus[]; coachesOnly: boolean; out: TrackedBus[] } | null = null;

function visibleBuses(buses: TrackedBus[], coachesOnly: boolean): TrackedBus[] {
  if (_tier?.buses !== buses || _tier.coachesOnly !== coachesOnly) {
    _tier = {
      buses,
      coachesOnly,
      out: coachesOnly ? buses.filter((b) => b.operator === "Ember") : buses,
    };
  }
  return _tier.out;
}

export interface BusLayerOptions {
  buses: TrackedBus[];
  zoom: number;
  selectedId: string | null;
  onClick: (b: TrackedBus | null) => void;
}

export function buildBusLayers(opts: BusLayerOptions) {
  const { buses: allBuses, zoom, selectedId, onClick } = opts;
  if (zoom < COACH_MIN_ZOOM || allBuses.length === 0) return [];
  const buses = visibleBuses(allBuses, zoom < BUS_MIN_ZOOM);
  if (buses.length === 0) return [];

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
        d.id === selectedId
          ? SELECTED
          : d.operator === "TFLO"
            ? TFL_RED
            : d.operator === "Ember"
              ? EMBER_GREEN
              : OTHER,
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
