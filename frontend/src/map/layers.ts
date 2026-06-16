import { IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { GLTFLoader } from "@loaders.gl/gltf";
import { ParticleLayer, RasterLayer, ImageType } from "weatherlayers-gl";
import type { TrackedVessel, DensityPoint, WeatherMeta } from "@/types";
import type { TrailPoint } from "@/hooks/useVesselTrail";
import { colorRgbFor, groupKeyFor } from "@/lib/shipTypes";
import { getIconAtlas, ICON_MAPPING } from "./vesselIcons";

// 3D vessel models, keyed by ship-type group. A group without an entry keeps
// its flat icon. Drop a `<group>.glb` into public/models and add it here.
interface VesselModel {
  url: string;
  yawOffset: number; // degrees, to correct the model's forward (bow) axis
}
const MODEL_REGISTRY: Partial<Record<string, VesselModel>> = {
  fishing: { url: "/models/fishing.glb", yawOffset: -90 },
  passenger: { url: "/models/passenger.glb", yawOffset: 0 },
};
const MODEL_GROUPS = new Set(Object.keys(MODEL_REGISTRY));

const MODEL_MIN_ZOOM = 11.5; // below this, the flat icon is used
// Sized by pixel bounds so the model is visible regardless of its native units.
// Capped fairly small so the models stay in scale with the map's buildings when
// zoomed right in (3D), rather than dwarfing them.
const MODEL_SIZE_SCALE = 110;
const MODEL_MIN_PX = 24;
const MODEL_MAX_PX = 72;

// Cross-fade between the density heatmap (zoomed out) and vessel icons (zoomed
// in). Icons are full above ICON_FULL; heatmap is full below HEAT_FULL.
const ICON_FULL = 6.5;
const HEAT_FULL = 4.5;

// Cool→hot glow tuned for the dark basemap (deep blue → cyan → hot white).
export const HEAT_COLOR_RANGE: [number, number, number][] = [
  [8, 48, 107],
  [33, 113, 181],
  [33, 160, 220],
  [34, 211, 238],
  [165, 243, 215],
  [255, 255, 240],
];

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// Wind-speed colormap (m/s → RGBA), a translucent raster beneath the particles
// that gives the all-white strands their missing magnitude context. Calm seas
// are fully transparent so the basemap shows through; warmth and alpha climb
// with speed (blue → cyan → green → amber → red), roughly tracking Beaufort.
export const WIND_SPEED_PALETTE: [number, [number, number, number, number]][] = [
  [0, [10, 40, 90, 0]],
  [3, [33, 113, 181, 55]],
  [6, [34, 211, 238, 85]],
  [9, [74, 222, 128, 115]],
  [12, [250, 204, 21, 150]],
  [16, [249, 115, 22, 180]],
  [21, [239, 68, 68, 205]],
  [28, [217, 70, 239, 225]],
];

// Significant-wave-height colormap (metres → RGBA), the sea-state raster. Land
// is already masked out in the texture's alpha; calm water is transparent so
// the basemap reads through. Tracks the WMO sea-state scale: calm → slight →
// moderate → rough → very rough → high. A teal-anchored ramp, distinct from the
// blue-anchored wind ramp so the two layers stay legible if both are on.
export const WAVE_HEIGHT_PALETTE: [number, [number, number, number, number]][] = [
  [0, [12, 74, 110, 0]],
  [0.5, [13, 148, 136, 70]],
  [1.25, [45, 212, 191, 110]],
  [2.5, [132, 204, 22, 150]],
  [4, [250, 204, 21, 180]],
  [6, [249, 115, 22, 205]],
  [9, [225, 29, 72, 230]],
];

export interface LayerOptions {
  data: TrackedVessel[];
  version: number; // bump => updateTriggers refresh
  zoom: number; // current map zoom (drives the heatmap/icon cross-fade)
  densityMode: boolean; // force the heatmap on regardless of zoom
  drawing: boolean; // a geofence draw tool is active → disable vessel picking
  showTrails: boolean;
  trailWindowSec: number; // how far back trails fade
  currentTime: number; // epoch seconds, animated for TripsLayer + motion
  selectedMmsi: number | null;
  onClick: (v: TrackedVessel | null) => void;
  // Bold highlighted track for the selected vessel ("show on map").
  highlightTrack: TrailPoint[] | null;
  highlightColor: [number, number, number];
  // Sanctioned / behaviorally-flagged vessels to ring in red.
  flaggedMmsis: Set<number>;
  // Vessels the AI analyst is currently pointing at (cyan rings).
  analystMmsis: Set<number>;
  // Vessel currently hovered in the data table (transient white ring).
  hoverMmsi: number | null;
  // When set, the heatmap renders these historical density cells instead of the
  // live fleet, and live icons/trails are hidden (timeline scrubbing).
  densityOverride: DensityPoint[] | null;
  // GFS wind particle overlay.
  showWind: boolean;
  windImage: unknown | null; // weatherlayers TextureData
  windMeta: WeatherMeta | null;
  // GFS-Wave sea-state raster.
  showWaves: boolean;
  waveImage: unknown | null; // weatherlayers TextureData
  waveMeta: WeatherMeta | null;
}

/**
 * Build the deck.gl layer stack. Returning fresh layer instances each render is
 * the idiomatic deck.gl pattern; `updateTriggers` keyed on `version` tells deck
 * to re-read the accessors only when the underlying data actually changed.
 */
export function buildLayers(opts: LayerOptions) {
  const {
    data,
    version,
    zoom,
    densityMode,
    drawing,
    showTrails,
    trailWindowSec,
    currentTime,
    selectedMmsi,
    onClick,
    highlightTrack,
    highlightColor,
    flaggedMmsis,
    analystMmsis,
    hoverMmsi,
    densityOverride,
    showWind,
    windImage,
    windMeta,
    showWaves,
    waveImage,
    waveMeta,
  } = opts;

  const layers: unknown[] = [];

  // GFS-Wave sea state — drawn at the very bottom so wind (if also on) and all
  // traffic sit above it. Land is pre-masked in the texture's alpha channel.
  if (showWaves && waveImage && waveMeta) {
    layers.push(
      new RasterLayer({
        id: "waves",
        image: waveImage as never,
        imageType: ImageType.SCALAR, // significant wave height, metres
        imageUnscale: waveMeta.imageUnscale,
        bounds: waveMeta.bounds,
        palette: WAVE_HEIGHT_PALETTE as never,
        opacity: 0.7,
      }),
    );
  }

  // GFS wind — a coloured speed raster underlay with animated particles on top.
  // Both are drawn first so the weather sits beneath traffic + icons.
  if (showWind && windImage && windMeta) {
    layers.push(
      new RasterLayer({
        id: "wind-speed",
        image: windImage as never,
        imageType: ImageType.VECTOR, // renders the U/V magnitude (wind speed)
        imageUnscale: windMeta.imageUnscale,
        bounds: windMeta.bounds,
        palette: WIND_SPEED_PALETTE as never,
        opacity: 0.65, // subtle backdrop; the palette alpha does the shaping
      }),
    );
    layers.push(
      new ParticleLayer({
        id: "wind",
        image: windImage as never,
        imageType: ImageType.VECTOR,
        imageUnscale: windMeta.imageUnscale,
        bounds: windMeta.bounds,
        numParticles: 16000, // dense strands over the wide NW-Europe+Med field
        maxAge: 60, // long, slowly-fading trails → ghostly
        speedFactor: 1.6, // slower drift
        width: 1.0, // thin
        color: [255, 255, 255],
        opacity: 0.2, // very faint
      }),
    );
  }

  // Timeline scrubbing: a historical density bucket is being viewed.
  const history =
    densityOverride && densityOverride.length > 0 ? densityOverride : null;

  // Zoom-driven cross-fade: icons in close, density heatmap far out.
  // Density mode (or viewing history) forces the heatmap fully on.
  //
  // Exception: while the analyst is pointing at vessels, keep the icon view even
  // if it flew the camera way out — otherwise the zoom-driven heatmap would
  // swallow the very vessels (and cyan rings) it's highlighting. The explicit
  // density toggle and timeline scrubbing still take precedence.
  const analystActive = analystMmsis.size > 0;
  const iconOpacity =
    densityMode || history
      ? 0
      : analystActive
        ? 1
        : clamp01((zoom - HEAT_FULL) / (ICON_FULL - HEAT_FULL));
  const heatOpacity = densityMode || history ? 1 : 1 - iconOpacity;

  // 3D models replace flat icons for fishing vessels when zoomed in.
  const modelsActive = !densityMode && !history && zoom >= MODEL_MIN_ZOOM;
  const isModelVessel = (d: TrackedVessel) =>
    modelsActive && MODEL_GROUPS.has(groupKeyFor(d.ship_type));

  // Density heatmap — live fleet, or a historical bucket when scrubbing.
  if (heatOpacity > 0.01) {
    layers.push(
      history
        ? new HeatmapLayer<DensityPoint>({
            id: "density",
            data: history,
            getPosition: (d) => [d.lon, d.lat],
            getWeight: (d) => d.count,
            aggregation: "SUM",
            radiusPixels: 38,
            intensity: 1,
            threshold: 0.05,
            colorRange: HEAT_COLOR_RANGE,
            opacity: heatOpacity,
            updateTriggers: { getPosition: history, getWeight: history },
          })
        : new HeatmapLayer<TrackedVessel>({
            id: "density",
            data,
            getPosition: (d) => [d.lon as number, d.lat as number],
            getWeight: 1,
            aggregation: "SUM",
            radiusPixels: 38,
            intensity: 1,
            threshold: 0.05,
            colorRange: HEAT_COLOR_RANGE,
            opacity: heatOpacity,
            updateTriggers: { getPosition: version },
          }),
    );
  }

  // Highlighted single-vessel track (drawn under the icons, over the trails).
  if (!history && highlightTrack && highlightTrack.length >= 2) {
    const path = highlightTrack.map((p) => [p[0], p[1]] as [number, number]);
    // Extend the head to the vessel's live dead-reckoned position so the track
    // connects to the (also dead-reckoned) icon instead of lagging behind it.
    const sel =
      selectedMmsi != null ? data.find((d) => d.mmsi === selectedMmsi) : null;
    if (sel && sel.lat != null && sel.lon != null) {
      path.push(
        deadReckon(sel.lat as number, sel.lon as number, sel.cog, sel.sog, currentTime - sel.ts),
      );
    }
    layers.push(
      new PathLayer<{ path: [number, number][] }>({
        id: "highlight-track",
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: [...highlightColor, 230],
        widthMinPixels: 3,
        capRounded: true,
        jointRounded: true,
        updateTriggers: {
          getPath: [highlightTrack, currentTime],
          getColor: highlightColor,
        },
      }),
      // Hollow ring at the start of the track.
      new ScatterplotLayer<[number, number]>({
        id: "highlight-start",
        data: [path[0]],
        getPosition: (d) => d,
        getLineColor: highlightColor,
        getFillColor: [0, 0, 0, 0],
        stroked: true,
        filled: true,
        lineWidthMinPixels: 2,
        radiusMinPixels: 5,
        getRadius: 5,
        radiusUnits: "pixels",
        updateTriggers: { data: highlightTrack },
      }),
    );
  }

  // Trails + icons fade out as the heatmap takes over.
  if (showTrails && iconOpacity > 0.01) {
    layers.push(
      new TripsLayer<TrackedVessel>({
        id: "trails",
        data,
        getPath: (d) => d.trail.map((p) => [p[0], p[1]] as [number, number]),
        getTimestamps: (d) => d.trail.map((p) => p[2]),
        getColor: (d) => colorRgbFor(d.ship_type),
        opacity: 0.6 * iconOpacity,
        widthMinPixels: 2,
        rounded: true,
        trailLength: trailWindowSec,
        currentTime,
        fadeTrail: true,
        jointRounded: true,
        capRounded: true,
        updateTriggers: {
          getPath: version,
          getTimestamps: version,
        },
      }),
    );
  }

  // Selection halo: a steady ring + an expanding "sonar" ping around the
  // selected vessel, tracking its live (dead-reckoned) position.
  if (iconOpacity > 0.01 && selectedMmsi != null) {
    const sel = data.find((d) => d.mmsi === selectedMmsi);
    if (sel && sel.lat != null && sel.lon != null) {
      const pos = deadReckon(
        sel.lat as number,
        sel.lon as number,
        sel.cog,
        sel.sog,
        currentTime - sel.ts,
      );
      const RING: [number, number, number] = [56, 150, 255];
      const phase = (currentTime % 1.6) / 1.6; // 0..1 ping cycle
      // Wrap the larger 3D model when the selected vessel is rendered as one.
      const ringR = isModelVessel(sel) ? 60 : 19;
      const pingR = isModelVessel(sel) ? 56 : 16;
      layers.push(
        new ScatterplotLayer<[number, number]>({
          id: "sel-ping",
          data: [pos],
          getPosition: (d) => d,
          stroked: true,
          filled: false,
          getLineColor: [...RING, Math.round((1 - phase) * 200)],
          lineWidthMinPixels: 2,
          getRadius: pingR + phase * 18,
          radiusUnits: "pixels",
          updateTriggers: {
            getPosition: currentTime,
            getRadius: [currentTime, ringR],
            getLineColor: currentTime,
          },
        }),
        new ScatterplotLayer<[number, number]>({
          id: "sel-ring",
          data: [pos],
          getPosition: (d) => d,
          stroked: true,
          filled: false,
          getLineColor: [...RING, 235],
          lineWidthMinPixels: 2.5,
          getRadius: ringR,
          radiusUnits: "pixels",
          updateTriggers: { getPosition: currentTime, getRadius: ringR },
        }),
      );
    }
  }

  // When 3D models are active, drop modelled vessels from the flat-icon layer
  // so the model isn't competing with an icon at the same spot.
  const iconData = modelsActive
    ? data.filter((d) => !MODEL_GROUPS.has(groupKeyFor(d.ship_type)))
    : data;

  // Cyan "the analyst is pointing here" rings — a steady ring that breathes
  // slowly, visually distinct from the red flagged pulse and the blue selection.
  if (iconOpacity > 0.01 && analystMmsis.size > 0) {
    const cited = data.filter((d) => analystMmsis.has(d.mmsi));
    if (cited.length > 0) {
      const breathe = 0.5 + 0.5 * Math.sin(currentTime * 1.6);
      layers.push(
        new ScatterplotLayer<TrackedVessel>({
          id: "analyst-rings",
          data: cited,
          getPosition: (d) =>
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts),
          stroked: true,
          filled: false,
          getLineColor: [34, 211, 238, Math.round(170 + breathe * 85)],
          lineWidthMinPixels: 2,
          getRadius: 22 + breathe * 3,
          radiusUnits: "pixels",
          updateTriggers: {
            getPosition: currentTime,
            getRadius: currentTime,
            getLineColor: currentTime,
          },
        }),
      );
    }
  }

  // Transient white ring around the vessel hovered in the data table.
  if (hoverMmsi != null) {
    const hv = data.find((d) => d.mmsi === hoverMmsi);
    if (hv && hv.lat != null && hv.lon != null) {
      layers.push(
        new ScatterplotLayer<TrackedVessel>({
          id: "hover-ring",
          data: [hv],
          getPosition: (d) =>
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts),
          stroked: true,
          filled: false,
          getLineColor: [255, 255, 255, 235],
          lineWidthMinPixels: 2.5,
          getRadius: 21,
          radiusUnits: "pixels",
          updateTriggers: { getPosition: currentTime },
        }),
      );
    }
  }

  // Red warning ring around sanctioned / flagged vessels. Drawn regardless of
  // zoom — high-risk vessels must stay visible even when the view zooms out far
  // enough (over the wide NW-Europe+Med area) for the density heatmap to take
  // over the icons. Suppressed only while scrubbing a historical bucket, where
  // live positions wouldn't match the past view.
  if (!history && flaggedMmsis.size > 0) {
    const flagged = data.filter((d) => flaggedMmsis.has(d.mmsi));
    if (flagged.length > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(currentTime * 3);
      layers.push(
        new ScatterplotLayer<TrackedVessel>({
          id: "flagged-rings",
          data: flagged,
          getPosition: (d) =>
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts),
          stroked: true,
          filled: false,
          getLineColor: [244, 63, 94, Math.round(150 + pulse * 105)],
          lineWidthMinPixels: 2,
          getRadius: 17,
          radiusUnits: "pixels",
          updateTriggers: { getPosition: currentTime, getLineColor: currentTime },
        }),
      );
    }
  }

  if (iconOpacity > 0.01)
  layers.push(
    new IconLayer<TrackedVessel>({
      id: "vessels",
      data: iconData,
      pickable: !drawing,
      opacity: iconOpacity,
      iconAtlas: getIconAtlas(),
      iconMapping: ICON_MAPPING,
      // Moving vessels (have a heading or speed) get the arrow; others a dot.
      getIcon: (d) =>
        d.heading != null || (d.sog ?? 0) > 0.5 ? "arrow" : "dot",
      // Dead-reckon the position forward from the last fix so vessels glide
      // continuously between (infrequent) AIS updates instead of jumping.
      getPosition: (d) =>
        deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts),
      // IconLayer angle is counter-clockwise; AIS heading is clockwise-from-north.
      getAngle: (d) => -(d.heading ?? d.cog ?? 0),
      getColor: (d) => colorRgbFor(d.ship_type),
      getSize: (d) => (d.mmsi === selectedMmsi ? 34 : 22),
      sizeUnits: "pixels",
      sizeMinPixels: 10,
      sizeMaxPixels: 40,
      onClick: (info) => onClick((info.object as TrackedVessel) ?? null),
      updateTriggers: {
        // Re-evaluated every animation frame to advance the glide.
        getPosition: currentTime,
        getColor: version,
        getIcon: version,
        getAngle: version,
        getSize: [version, selectedMmsi],
      },
    }),
  );

  // 3D models when zoomed in — one shared, GPU-instanced layer per ship group.
  if (modelsActive) {
    for (const [group, model] of Object.entries(MODEL_REGISTRY)) {
      if (!model) continue;
      const ships = data.filter(
        (d) =>
          d.lat != null && d.lon != null && groupKeyFor(d.ship_type) === group,
      );
      if (ships.length === 0) continue;
      layers.push(
        new ScenegraphLayer<TrackedVessel>({
          id: `vessel-models-${group}`,
          data: ships,
          scenegraph: model.url,
          loaders: [GLTFLoader],
          _lighting: "pbr",
          pickable: !drawing,
          sizeScale: MODEL_SIZE_SCALE,
          sizeMinPixels: MODEL_MIN_PX,
          sizeMaxPixels: MODEL_MAX_PX,
          getPosition: (d) =>
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts),
          getOrientation: (d) => [0, -((d.heading ?? d.cog ?? 0)) + model.yawOffset, 90],
          onClick: (info) => onClick((info.object as TrackedVessel) ?? null),
          updateTriggers: {
            getPosition: currentTime,
            getOrientation: [version, currentTime],
          },
        }),
      );
    }
  }

  return layers;
}

// --- dead reckoning ----------------------------------------------------------

const KNOTS_TO_MS = 0.514444;
const EARTH_R = 6_371_000; // metres
// Cap how far ahead we speculate from a stale fix, so a vessel that has gone
// quiet doesn't drift unrealistically across the map.
const MAX_DR_SEC = 150;

/**
 * Project a position forward along the vessel's course at its speed.
 * Returns [lon, lat]. Stationary/unknown-course vessels stay put.
 */
function deadReckon(
  lat: number,
  lon: number,
  cog: number | null,
  sog: number | null,
  dtSec: number,
): [number, number] {
  if (cog == null || sog == null || sog < 0.2) return [lon, lat];
  const t = Math.min(Math.max(dtSec, 0), MAX_DR_SEC);
  const dist = sog * KNOTS_TO_MS * t; // metres travelled
  if (dist < 0.5) return [lon, lat];

  const ang = dist / EARTH_R; // angular distance
  const brng = (cog * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(ang);
  const cosAng = Math.cos(ang);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brng));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * sinAng * cosLat1,
      cosAng - sinLat1 * Math.sin(lat2),
    );

  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}
