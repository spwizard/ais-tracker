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

// 3D vessel models, bucketed Unity-chart-style (see geovs-chart's
// target_categories.cfg / size_scale.cfg): a vessel is classified by ship-type
// PLUS its real AIS length into a size class, each class has its own hull
// model, and every vessel is then scaled to its own length. Buckets are ordered
// most-specific-first; the FIRST match wins. Vessels with no AIS dimensions
// fall into the small bucket at a modest default — the same visual outcome as
// the chart app's DEFAULT_LENGTH.
interface VesselModel {
  key: string; // layer id suffix
  url: string;
  yawOffset: number; // degrees, to correct the model's forward (bow) axis
  meshLen: number; // native mesh length in glTF units (measured)
  defaultLen: number; // rendered metres when the vessel's AIS length is unknown
  match: (d: TrackedVessel) => boolean;
}
const MODEL_BUCKETS: VesselModel[] = [
  { key: "fishing", url: "/models/fishing.glb", yawOffset: -90, meshLen: 2, defaultLen: 28,
    match: (d) => groupKeyFor(d.ship_type) === "fishing" },
  { key: "passenger", url: "/models/passenger.glb", yawOffset: 0, meshLen: 2, defaultLen: 100,
    match: (d) => groupKeyFor(d.ship_type) === "passenger" },
  // AIS type 36 (sailing) only — motor pleasure craft (37) keep their icon.
  { key: "sailing-xl", url: "/models/sailing-xl.glb", yawOffset: 0, meshLen: 5.61, defaultLen: 14,
    match: (d) => d.ship_type === 36 },
  { key: "cargo-s", url: "/models/cargo-s.glb", yawOffset: 0, meshLen: 9.93, defaultLen: 70,
    match: (d) => groupKeyFor(d.ship_type) === "cargo" && (d.length == null || d.length <= 100) },
  { key: "cargo-l", url: "/models/cargo-l.glb", yawOffset: 0, meshLen: 29.9, defaultLen: 200,
    match: (d) => groupKeyFor(d.ship_type) === "cargo" },
  { key: "tanker-s", url: "/models/tanker-s.glb", yawOffset: 0, meshLen: 14.86, defaultLen: 90,
    match: (d) => groupKeyFor(d.ship_type) === "tanker" && (d.length == null || d.length <= 150) },
  { key: "tanker-xl", url: "/models/tanker-xl.glb", yawOffset: 0, meshLen: 32.02, defaultLen: 250,
    match: (d) => groupKeyFor(d.ship_type) === "tanker" },
];
/** First matching bucket, or null → the vessel keeps its flat icon. */
function bucketFor(d: TrackedVessel): VesselModel | null {
  for (const b of MODEL_BUCKETS) if (b.match(d)) return b;
  return null;
}

const MODEL_MIN_ZOOM = 11.5; // below this, the flat icon is used
// World-scaled: a small pixel floor keeps ships visible when zoomed out, and a
// huge ceiling lets them reach true metre-size as you zoom in (Google-Earth
// style) rather than staying a fixed marker.
//
// NB deck's sizeMinPixels clamps ONE SCENEGRAPH UNIT, not the whole model — so
// the floor must be divided by each mesh's native length, or a 32-unit tanker
// gets a 16× larger minimum than a 2-unit fishing boat and looks giant the
// moment models switch on.
const MODEL_MIN_SHIP_PX = 12; // minimum rendered *ship length* in pixels
const MODEL_MAX_PX = 10000;
// Hard ceiling on simultaneously-rendered 3D models (across all groups). Each is
// a full GLTF mesh; beyond a few hundred the frame rate tanks. Vessels past this
// fall back to their flat icon, so nothing disappears — it just isn't 3D.
const MODEL_MAX_INSTANCES = 300;

/**
 * The compass angle a vessel should face. While making way, face the direction
 * of travel (course over ground) so the hull glides forward — matching the
 * dead-reckoned motion — instead of crabbing along a heading that differs from
 * the course. When stopped, fall back to the reported heading, then course.
 */
function facingAngle(d: TrackedVessel): number {
  if ((d.sog ?? 0) > 0.5 && d.cog != null) return d.cog;
  return d.heading ?? d.cog ?? 0;
}

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
  // Metres to lift 3D models above the WGS84 ellipsoid so they sit on the local
  // sea surface (mean sea level). 0 normally; ~geoid height in cinematic mode,
  // where Google's photoreal water is at MSL, not the ellipsoid.
  modelElevation: number;
  // Current viewport bounds [west, south, east, north]. The 3D model layer is
  // culled to this (a detailed GLTF mesh per vessel is far too heavy to render
  // for the whole fleet), so only on-screen ships get models.
  cullBounds: [number, number, number, number] | null;
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
 * Pick the vessels to draw as 3D models this frame: those in a model group,
 * within the (padded) viewport, capped to the MODEL_MAX_INSTANCES nearest the
 * centre. A full GLTF mesh per vessel is far too heavy to render for the whole
 * fleet, so without this the frame rate collapses the moment models switch on.
 */
function selectModelShips(
  data: TrackedVessel[],
  cullBounds: [number, number, number, number] | null,
): TrackedVessel[] {
  let inView = data.filter(
    (d) =>
      d.lat != null && d.lon != null && bucketFor(d) != null,
  );
  if (cullBounds) {
    const [w, s, e, n] = cullBounds;
    const padX = (e - w) * 0.25;
    const padY = (n - s) * 0.25;
    inView = inView.filter(
      (d) =>
        (d.lon as number) >= w - padX &&
        (d.lon as number) <= e + padX &&
        (d.lat as number) >= s - padY &&
        (d.lat as number) <= n + padY,
    );
  }
  if (inView.length > MODEL_MAX_INSTANCES) {
    const cx = cullBounds ? (cullBounds[0] + cullBounds[2]) / 2 : 0;
    const cy = cullBounds ? (cullBounds[1] + cullBounds[3]) / 2 : 0;
    const dist2 = (d: TrackedVessel) =>
      ((d.lon as number) - cx) ** 2 + ((d.lat as number) - cy) ** 2;
    inView = [...inView].sort((a, b) => dist2(a) - dist2(b)).slice(0, MODEL_MAX_INSTANCES);
  }
  return inView;
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
    modelElevation,
    cullBounds,
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
    modelsActive && bucketFor(d) != null;

  // Vessels actually drawn as 3D models this frame — culled to the (padded)
  // viewport and capped to the nearest MODEL_MAX_INSTANCES. Computed once so the
  // flat-icon layer below can fall back to icons for any model-group vessel that
  // didn't make the cut (off-screen or over the cap), instead of it vanishing.
  const modelShips = modelsActive ? selectModelShips(data, cullBounds) : [];
  const modelMmsis = new Set<number>(modelShips.map((d) => d.mmsi));

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

  // When 3D models are active, drop only the vessels that actually got a model
  // from the flat-icon layer (so the model isn't competing with an icon). Ships
  // in a model group that were culled/capped still render as icons.
  const iconData = modelsActive
    ? data.filter((d) => !modelMmsis.has(d.mmsi))
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
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts, DR_SCRATCH),
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
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts, DR_SCRATCH),
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
            deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts, DR_SCRATCH),
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
        deadReckon(d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts, DR_SCRATCH),
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

  // 3D models when zoomed in — one shared, GPU-instanced layer per size bucket.
  // `modelShips` is already culled to the viewport and capped (computed up front
  // so the flat-icon layer can show whatever didn't get a model).
  if (modelsActive) {
    // First-match bucket assignment (a ≤100m cargo must land in cargo-s, not
    // the cargo-l catch-all).
    const byBucket = new Map<string, TrackedVessel[]>();
    for (const d of modelShips) {
      const b = bucketFor(d);
      if (!b) continue;
      const arr = byBucket.get(b.key);
      if (arr) arr.push(d);
      else byBucket.set(b.key, [d]);
    }
    for (const model of MODEL_BUCKETS) {
      const ships = byBucket.get(model.key);
      if (!ships || ships.length === 0) continue;
      // Each vessel renders at ITS OWN AIS length (like the chart app's
      // antenna-derived dimensions): sizeScale maps the mesh to the bucket's
      // base length, and getScale fine-tunes per vessel. The ±2× clamp bounds
      // both junk AIS dimensions and the pixel-floor distortion.
      const base = model.defaultLen;
      layers.push(
        new ScenegraphLayer<TrackedVessel>({
          id: `vessel-models-${model.key}`,
          data: ships,
          scenegraph: model.url,
          loaders: [GLTFLoader],
          // Most models are Draco-compressed; decoding is a no-op for the rest.
          loadOptions: { gltf: { decompressMeshes: true } },
          _lighting: "pbr",
          pickable: !drawing,
          sizeScale: base / model.meshLen,
          sizeMinPixels: MODEL_MIN_SHIP_PX / model.meshLen,
          sizeMaxPixels: MODEL_MAX_PX,
          getPosition: (d) => {
            const [lon, lat] = deadReckon(
              d.lat as number, d.lon as number, d.cog, d.sog, currentTime - d.ts, DR_SCRATCH,
            );
            return [lon, lat, modelElevation];
          },
          getScale: (d) => {
            const k = Math.min(2, Math.max(0.5, (d.length ?? base) / base));
            return [k, k, k];
          },
          getOrientation: (d) => [0, -facingAngle(d) + model.yawOffset, 90],
          onClick: (info) => onClick((info.object as TrackedVessel) ?? null),
          updateTriggers: {
            getPosition: [currentTime, modelElevation],
            getScale: version, // AIS dimensions can arrive late via static data
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
// quiet doesn't drift unrealistically across the map. 60s: straight-line
// projection is only trustworthy for about a minute on winding waters — at
// 150s a Thames clipper that went dark at 10kn rendered ~780m inland, sailing
// up Byward Street. Past the cap the vessel holds that projected position.
const MAX_DR_SEC = 60;

/**
 * Project a position forward along the vessel's course at its speed.
 * Returns [lon, lat]. Stationary/unknown-course vessels stay put.
 * Also used by the aircraft layer (track/ground-speed share these units).
 *
 * Pass `out` to reuse an array instead of allocating. deck.gl accessors copy the
 * returned values into typed attribute buffers synchronously, so hot per-item
 * accessors share one scratch array (DR_SCRATCH) — this path runs tens of
 * thousands of times per clock tick, and allocating there dominated GC churn.
 * Do NOT pass the scratch anywhere the result is retained (paths, layer data).
 */
export const DR_SCRATCH: [number, number] = [0, 0];

export function deadReckon(
  lat: number,
  lon: number,
  cog: number | null,
  sog: number | null,
  dtSec: number,
  out?: [number, number],
): [number, number] {
  if (cog == null || sog == null || sog < 0.2) return write(out, lon, lat);
  const t = Math.min(Math.max(dtSec, 0), MAX_DR_SEC);
  const dist = sog * KNOTS_TO_MS * t; // metres travelled
  if (dist < 0.5) return write(out, lon, lat);

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

  return write(out, (lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI);
}

function write(out: [number, number] | undefined, lon: number, lat: number): [number, number] {
  if (!out) return [lon, lat];
  out[0] = lon;
  out[1] = lat;
  return out;
}
