import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import DeckGL from "@deck.gl/react";
import {
  FlyToInterpolator,
  LinearInterpolator,
  WebMercatorViewport,
} from "@deck.gl/core";
import { Map } from "react-map-gl/maplibre";
import type {
  TrackedVessel,
  TrackedAircraft,
  RailStation,
  TrackedBus,
  TrackedTrain,
  TubeLine,
  TubeStation,
  TubeTrain,
  Incident,
  FireDetection,
  FireComplex,
  FerryRoute,
  Camera,
  DensityPoint,
  WeatherMeta,
  ReplayTrack,
  Alert,
} from "@/types";
import { NAV_STATUS, colorHexFor } from "@/lib/shipTypes";
import { buildLayers } from "./layers";
import { buildAircraftLayers, buildRouteLayers, type AirRoute } from "./aircraftLayers";
import { buildCameraLayers } from "./cameraLayers";
import { buildBusLayers } from "./busLayers";
import { buildTrainLayers } from "./trainLayers";
import { buildTubeLayers, tubeColor } from "./tubeLayers";
import { buildHotspotLayers } from "./hotspotLayers";
import { buildIncidentLayers } from "./incidentLayers";
import { buildFireLayers } from "./fireLayers";
import { buildFerryLayers } from "./ferryLayers";
import type { HeatPoint, Hotspot } from "@/hooks/useDelayHotspots";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { buildReplayLayers, type TrailMode, type ColorMode } from "./replayLayers";
import { advanceClock } from "./replayMath";
import { buildFenceLayers, buildDraftLayers } from "./geofenceLayers";
import { useGeofenceDraw, type DrawResult } from "@/hooks/useGeofenceDraw";
import type { CompiledFence } from "@/geofence/geometry";
import type { FenceShape } from "@/geofence/types";

import { CINEMATIC_STYLE } from "./cinematicStyle";
import { EMPTY_DARK_STYLE, buildGoogle3DLayer } from "./google3d";

const DARK_STYLE =
  import.meta.env.VITE_MAP_STYLE ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const LIGHT_STYLE =
  import.meta.env.VITE_MAP_STYLE_LIGHT ??
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export interface ViewTarget {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface MapHandle {
  flyTo: (target: ViewTarget) => void;
  /** Gently recenter on a point without changing zoom (for follow-mode). */
  panTo: (longitude: number, latitude: number) => void;
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  fit: () => void;
  fitBounds: (points: [number, number][]) => void;
  set3D: (on: boolean) => void;
  /** Enter/leave cinematic coastal view (fly to a dramatic coast + high tilt). */
  setCinematic: (on: boolean) => void;
  pitchBy: (delta: number) => void;
  /** Jump the replay clock to an absolute time (epoch seconds). */
  seek: (t: number) => void;
  /** Current map viewport bounds as [west, south, east, north]. */
  getBounds: () => [number, number, number, number] | null;
}

interface MapViewProps {
  vessels: TrackedVessel[];
  version: number;
  showTrails: boolean;
  trailWindowSec: number;
  densityMode: boolean;
  selectedMmsi: number | null;
  onSelect: (v: TrackedVessel | null) => void;
  // --- Replay mode (historical movement scrubbing) ---
  replayMode: boolean;
  replayTracks: ReplayTrack[];
  replayAlerts: Alert[];
  replayRange: { start: number; end: number } | null;
  replayPlaying: boolean;
  replaySpeed: number;
  replayTrailMode: TrailMode;
  replayColorMode: ColorMode;
  replayMovingOnly: boolean;
  onReplayTime: (t: number) => void;
  onReplaySelect: (mmsi: number | null) => void;
  onReplayAlertClick: (a: Alert) => void;
  /** Debounced viewport bounds while replaying, so tracks follow pan/zoom. */
  onReplayViewportChange: (bbox: [number, number, number, number]) => void;
  theme: "light" | "dark";
  highlightTrack: [number, number, number][] | null;
  highlightColor: [number, number, number];
  flaggedMmsis: Set<number>;
  analystMmsis: Set<number>;
  hoverMmsi: number | null;
  densityOverride: DensityPoint[] | null;
  showWind: boolean;
  windImage: unknown | null;
  windMeta: WeatherMeta | null;
  showWaves: boolean;
  waveImage: unknown | null;
  waveMeta: WeatherMeta | null;
  // Geofences
  compiledFences: CompiledFence[];
  fenceCounts: Record<string, number>;
  fenceFlash: Record<string, number>;
  selectedFenceId: string | null;
  onSelectFence: (id: string) => void;
  drawMode: FenceShape | null;
  drawColor: string;
  onDrawComplete: (r: DrawResult) => void;
  onDrawCancel: () => void;
  // Cinematic coastal mode: satellite imagery + 3D terrain + high tilt.
  cinematic: boolean;
  // True when the backend proxy can serve Google Photorealistic 3D Tiles.
  google3d: boolean;
  // Air-traffic (ADS-B) layer.
  aircraft: TrackedAircraft[];
  showAir: boolean;
  onSelectAircraft: (a: TrackedAircraft | null) => void;
  selectedHex: string | null;
  airRoute: AirRoute | null;
  // London traffic cameras (land) layer.
  cameras: Camera[];
  showCameras: boolean;
  onSelectCamera: (c: Camera | null) => void;
  selectedCameraId: string | null;
  // London buses (land, moving) layer.
  buses: TrackedBus[];
  showBus: boolean;
  onSelectBus: (b: TrackedBus | null) => void;
  selectedBusId: string | null;
  // GB trains (rail, Tier-1 inferred positions).
  trains: TrackedTrain[];
  stations: RailStation[];
  railNetwork: unknown | null;
  showTrain: boolean;
  delayHotspots: { points: HeatPoint[]; hotspots: Hotspot[] };
  showHotspots: boolean;
  onHotspotClick: (h: Hotspot) => void;
  onSelectTrain: (t: TrackedTrain | null) => void;
  selectedTrainId: string | null;
  onSelectStation: (s: RailStation) => void;
  // London Underground layer.
  tubeNetwork: { lines: TubeLine[]; stations: TubeStation[] };
  tubeTrains: TubeTrain[];
  showTube: boolean;
  incidents: Incident[];
  showIncidents: boolean;
  onSelectIncident: (i: Incident | null) => void;
  onSelectTubeStation: (s: TubeStation) => void;
  // Wildfires (NASA FIRMS) layer.
  fires: FireDetection[];
  showFire: boolean;
  onSelectFire: (f: FireDetection | null) => void;
  // Clustered fire complexes: gate the ember field to believed wildfires and
  // mark industrial heat sources slate. Clicking a marker opens its detail.
  fireComplexes: FireComplex[];
  onSelectFireComplex: (c: FireComplex | null) => void;
  // Ferry service-status layer (CalMac + NorthLink route lines).
  ferryRoutes: FerryRoute[];
  showFerry: boolean;
  selectedFerryId: string | null;
  onSelectFerry: (r: FerryRoute | null) => void;
  // The camera the selected bus is heading toward next — pulse a ring on it.
  nextCameraPos: [number, number] | null;
}

const INITIAL_VIEW = {
  longitude: -2.5,
  latitude: 50.2,
  zoom: 7,
  pitch: 0,
  bearing: 0,
  maxPitch: 79, // raised ceiling so the 3D view can tilt toward the horizon
};

function MapViewInner(props: MapViewProps, ref: Ref<MapHandle>) {
  const {
    vessels,
    version,
    showTrails,
    trailWindowSec,
    densityMode,
    selectedMmsi,
    onSelect,
    replayMode,
    replayTracks,
    replayAlerts,
    replayRange,
    replayPlaying,
    replaySpeed,
    replayTrailMode,
    replayColorMode,
    replayMovingOnly,
    onReplayTime,
    onReplaySelect,
    onReplayAlertClick,
    onReplayViewportChange,
    theme,
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
    compiledFences,
    fenceCounts,
    fenceFlash,
    selectedFenceId,
    onSelectFence,
    drawMode,
    drawColor,
    onDrawComplete,
    onDrawCancel,
    cinematic,
    google3d,
    aircraft,
    showAir,
    onSelectAircraft,
    selectedHex,
    airRoute,
    cameras,
    showCameras,
    onSelectCamera,
    selectedCameraId,
    buses,
    showBus,
    onSelectBus,
    selectedBusId,
    trains,
    stations,
    railNetwork,
    showTrain,
    delayHotspots,
    showHotspots,
    onHotspotClick,
    onSelectTrain,
    selectedTrainId,
    onSelectStation,
    tubeNetwork,
    tubeTrains,
    showTube,
    incidents,
    showIncidents,
    onSelectIncident,
    onSelectTubeStation,
    fires,
    showFire,
    onSelectFire,
    fireComplexes,
    onSelectFireComplex,
    ferryRoutes,
    showFerry,
    selectedFerryId,
    onSelectFerry,
    nextCameraPos,
  } = props;

  const drawing = drawMode != null;
  const draw = useGeofenceDraw({
    drawMode,
    onComplete: onDrawComplete,
    onCancel: onDrawCancel,
  });

  const [viewState, setViewState] = useState<Record<string, unknown>>(
    INITIAL_VIEW,
  );

  // Animation clock: drives vessel dead-reckoning + trail fade in live mode, and
  // the scrub position in replay mode. Kept local to the map so 60fps ticks
  // re-render only the map, not the app — the only thing that escapes upward is
  // a throttled `onReplayTime` for the timeline readout.
  const [currentTime, setCurrentTime] = useState(() => Date.now() / 1000);
  const timeRef = useRef(currentTime);
  const setTime = useCallback((t: number) => {
    timeRef.current = t;
    setCurrentTime(t);
  }, []);

  // Live clock — wall-clock, paused while replaying. Throttled to ~10Hz: each
  // tick re-renders the whole layer stack and re-runs the dead-reckoning
  // accessors over every vessel, so 60fps here meant ~1M allocations/sec for
  // motion that is sub-pixel per frame at map zooms. 10Hz is visually identical
  // and cuts that churn 6×.
  useEffect(() => {
    if (replayMode) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!document.hidden && now - last >= 100) {
        last = now;
        setTime(Date.now() / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replayMode, setTime]);

  // Replay clock — advances within [start, end] at replaySpeed, looping at the
  // end. Play/pause/speed are read from refs so toggling them doesn't restart
  // the rAF (which would jolt the elapsed-time delta).
  const playingRef = useRef(replayPlaying);
  playingRef.current = replayPlaying;
  const speedRef = useRef(replaySpeed);
  speedRef.current = replaySpeed;
  const onReplayTimeRef = useRef(onReplayTime);
  onReplayTimeRef.current = onReplayTime;

  // Note: the clock is positioned by the app (one-time seek to the data start on
  // entering replay) rather than auto-reset here — auto-resetting on range
  // changes jolted the scrubber every time the bbox refetched on pan/zoom.
  useEffect(() => {
    if (!replayMode || !replayRange) return;
    const { start, end } = replayRange;
    let raf = 0;
    let last = performance.now();
    let lastReport = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (playingRef.current && !document.hidden) {
        setTime(advanceClock(timeRef.current, dt, speedRef.current, start, end));
      }
      if (now - lastReport > 250) {
        lastReport = now;
        onReplayTimeRef.current(timeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayMode, replayRange?.start, replayRange?.end, setTime]);

  // While replaying, follow the viewport: 500ms after pan/zoom settles, report
  // the new bounds so the tracks refetch for the area you're looking at.
  useEffect(() => {
    if (!replayMode) return;
    const id = setTimeout(
      () => onReplayViewportChange(boundsFromViewState(viewState)),
      500,
    );
    return () => clearTimeout(id);
  }, [replayMode, viewState, onReplayViewportChange]);

  useImperativeHandle(ref, () => ({
    flyTo: (t) =>
      setViewState((prev) => ({
        ...prev,
        ...t,
        transitionDuration: 1400,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
      })),
    panTo: (longitude, latitude) =>
      setViewState((prev) => ({
        ...prev,
        longitude,
        latitude,
        transitionDuration: 600,
        transitionInterpolator: new LinearInterpolator(["longitude", "latitude"]),
      })),
    zoomBy: (delta) =>
      setViewState((prev) => ({
        ...prev,
        zoom: Math.min(18, Math.max(2, ((prev.zoom as number) ?? 7) + delta)),
        transitionDuration: 250,
      })),
    resetNorth: () =>
      setViewState((prev) => ({
        ...prev,
        bearing: 0,
        pitch: 0,
        transitionDuration: 400,
        transitionInterpolator: new LinearInterpolator(["bearing", "pitch"]),
      })),
    set3D: (on) =>
      setViewState((prev) => ({
        ...prev,
        pitch: on ? 65 : 0,
        transitionDuration: 600,
        transitionInterpolator: new LinearInterpolator(["pitch"]),
      })),
    setCinematic: (on) =>
      // Tilt in place — stay where the user is looking; just lean toward the
      // horizon for the cinematic view (or level back out when leaving it).
      setViewState((prev) => ({
        ...prev,
        pitch: on ? 60 : 0,
        transitionDuration: 700,
        transitionInterpolator: new LinearInterpolator(["pitch"]),
      })),
    pitchBy: (delta) =>
      setViewState((prev) => ({
        ...prev,
        pitch: Math.min(79, Math.max(0, ((prev.pitch as number) ?? 0) + delta)),
        transitionDuration: 250,
        transitionInterpolator: new LinearInterpolator(["pitch"]),
      })),
    seek: (t) => {
      const clamped = replayRange
        ? Math.min(replayRange.end, Math.max(replayRange.start, t))
        : t;
      setTime(clamped);
      onReplayTime(clamped);
    },
    getBounds: () => boundsFromViewState(viewState),
    fit: () =>
      setViewState((prev) => ({
        ...prev,
        ...INITIAL_VIEW,
        transitionDuration: 800,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
      })),
    fitBounds: (points) => {
      if (points.length === 0) return;
      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ];
      setViewState((prev) => {
        // Single point (or degenerate bounds): just centre on it.
        if (points.length < 2 || bounds[0][0] === bounds[1][0]) {
          return {
            ...prev,
            longitude: bounds[0][0],
            latitude: bounds[0][1],
            zoom: 12,
            transitionDuration: 900,
            transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
          };
        }
        const vp = new WebMercatorViewport({
          width: window.innerWidth,
          height: window.innerHeight,
        });
        const { longitude, latitude, zoom } = vp.fitBounds(bounds, {
          padding: 80,
        });
        return {
          ...prev,
          longitude,
          latitude,
          zoom: Math.min(zoom, 14),
          transitionDuration: 900,
          transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
        };
      });
    },
  }));

  // Only zoom affects the layer stack — depending on the whole viewState would
  // rebuild every layer (and re-interpolate all vessel heads) on each pan frame.
  const zoom = (viewState.zoom as number) ?? 7;

  const layers = useMemo(
    () =>
      replayMode
        ? buildReplayLayers({
            tracks: replayTracks,
            alerts: replayAlerts,
            currentTime,
            zoom,
            trailMode: replayTrailMode,
            colorMode: replayColorMode,
            movingOnly: replayMovingOnly,
            windowSec: replayRange ? replayRange.end - replayRange.start : 3600,
            selectedMmsi,
            onClick: onReplaySelect,
            onAlertClick: onReplayAlertClick,
          })
        : [
      // Fences render beneath vessels; the draft preview sits on top.
      ...buildFenceLayers(
        compiledFences,
        fenceCounts,
        selectedFenceId,
        !drawing,
        onSelectFence,
        fenceFlash,
        currentTime,
      ),
      ...buildLayers({
        data: vessels,
        version,
        zoom,
        // Lift 3D models onto Google's photoreal water (at mean sea level, ~geoid
        // height above the ellipsoid) only when that mesh is the world; otherwise
        // sea level is the ellipsoid (z=0). ~48 m suits NW Europe / the Channel.
        modelElevation: cinematic && google3d ? 48 : 0,
        cullBounds: boundsFromViewState(viewState),
        densityMode,
        drawing,
        showTrails,
        trailWindowSec,
        currentTime,
        selectedMmsi,
        onClick: onSelect,
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
      }),
      ...buildDraftLayers(
        drawMode ? { shape: drawMode, points: draw.points, hover: draw.hover, color: drawColor } : null,
      ),
      // Air traffic draws on top of the sea picture when toggled on. The
      // selected aircraft's flight route (great-circle arc) sits beneath the
      // planes so the icons stay legible.
      ...(showAir ? buildRouteLayers(airRoute) : []),
      ...(showAir
        ? buildAircraftLayers({
            aircraft,
            currentTime,
            selectedHex,
            onClick: onSelectAircraft,
          })
        : []),
      // London traffic cameras (land) — fixed markers, shown when zoomed in.
      ...(showCameras
        ? buildCameraLayers({
            cameras,
            zoom,
            selectedId: selectedCameraId,
            onClick: onSelectCamera,
          })
        : []),
      // London buses (land, moving) — shown when zoomed into London.
      ...(showBus
        ? buildBusLayers({
            buses,
            zoom,
            selectedId: selectedBusId,
            onClick: onSelectBus,
          })
        : []),
      // GB trains (rail) — visible from national zoom.
      ...(showTrain
        ? buildTrainLayers({
            trains,
            stations,
            railNetwork,
            currentTime,
            zoom,
            selectedId: selectedTrainId,
            onClick: onSelectTrain,
            onStationClick: onSelectStation,
            hotspotsMode: showHotspots,
          })
        : []),
      // Delay hotspots — where lateness is concentrating right now.
      ...(showHotspots
        ? buildHotspotLayers({
            points: delayHotspots.points,
            hotspots: delayHotspots.hotspots,
            onClick: onHotspotClick,
          })
        : []),
      // London Underground — the network as light, once London fills the view.
      ...(showTube
        ? buildTubeLayers({
            network: tubeNetwork,
            trains: tubeTrains,
            currentTime,
            zoom,
            onClickTrain: () => void 0,
            onClickStation: onSelectTubeStation,
          })
        : []),
      // Incidents (Argus spine) — located things-happening, on top of the map.
      ...(showIncidents
        ? buildIncidentLayers({
            incidents,
            currentTime,
            zoom,
            onClick: onSelectIncident,
          })
        : []),
      // Wildfires (NASA FIRMS) — a glowing ember field, weighted by intensity.
      ...(showFire
        ? buildFireLayers({
            fires,
            complexes: fireComplexes,
            currentTime,
            zoom,
            onClick: onSelectFire,
            onSelectComplex: onSelectFireComplex,
          })
        : []),
      // Ferry routes coloured by live service status — under the vessels so
      // the ships sail over their own route lines.
      ...(showFerry
        ? buildFerryLayers({
            routes: ferryRoutes,
            zoom,
            selectedId: selectedFerryId,
            onSelect: onSelectFerry,
          })
        : []),
      // Pulsing ring on the camera the selected bus is heading toward next.
      ...(nextCameraPos ? buildNextCameraRing(nextCameraPos, currentTime) : []),
    ],
    // currentTime drives trail animation + motion; version drives data refresh.
    [
      replayMode,
      replayTracks,
      replayAlerts,
      replayTrailMode,
      replayColorMode,
      replayMovingOnly,
      replayRange,
      onReplaySelect,
      onReplayAlertClick,
      vessels,
      version,
      zoom,
      cinematic,
      google3d,
      aircraft,
      showAir,
      selectedHex,
      airRoute,
      onSelectAircraft,
      cameras,
      showCameras,
      selectedCameraId,
      onSelectCamera,
      buses,
      showBus,
      selectedBusId,
      onSelectBus,
      trains,
      stations,
      railNetwork,
      showTrain,
      selectedTrainId,
      onSelectTrain,
      onSelectStation,
      tubeNetwork,
      tubeTrains,
      showTube,
      incidents,
      showIncidents,
      onSelectIncident,
      onSelectTubeStation,
      fires,
      showFire,
      onSelectFire,
      fireComplexes,
      onSelectFireComplex,
      ferryRoutes,
      showFerry,
      selectedFerryId,
      onSelectFerry,
      nextCameraPos,
      densityMode,
      drawing,
      showTrails,
      trailWindowSec,
      currentTime,
      selectedMmsi,
      onSelect,
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
      compiledFences,
      fenceCounts,
      fenceFlash,
      selectedFenceId,
      onSelectFence,
      drawMode,
      drawColor,
      draw.points,
      draw.hover,
    ],
  );

  // Google Photorealistic 3D Tiles — the photoreal mesh that becomes the world in
  // cinematic mode (when a key is configured). Rendered beneath everything else.
  const [googleAttribution, setGoogleAttribution] = useState("");
  const googleLayer = useMemo(
    () => (cinematic && google3d ? buildGoogle3DLayer(setGoogleAttribution) : null),
    [cinematic, google3d],
  );
  // Over Google's photoreal mesh, draw the flat 2D overlays (icons, trails,
  // rings) with depth-testing off so they always float on top instead of being
  // buried in the 3D geometry as you zoom in. The mesh and the 3D vessel models
  // KEEP depth: the mesh self-occludes, and the ScenegraphLayer models need depth
  // for their own geometry (without it the hull renders inside-out / "tipped").
  const allLayers = useMemo(() => {
    if (!googleLayer) return layers;
    const over = layers.map((l) => {
      const L = l as { id?: string; clone?: (p: object) => unknown; props?: { parameters?: object } };
      if (!L?.clone || (typeof L.id === "string" && L.id.startsWith("vessel-models"))) return l;
      return L.clone({ parameters: { ...(L.props?.parameters ?? {}), depthCompare: "always" } });
    });
    return [googleLayer, ...over];
  }, [googleLayer, layers]);

  // Sky/atmosphere gradient fades in with pitch to hide the bare horizon line
  // of a 2D basemap when tilted toward the horizon.
  const pitch = (viewState.pitch as number) ?? 0;
  const skyOpacity = Math.min(1, Math.max(0, (pitch - 18) / 48));
  const skyGradient =
    theme === "dark"
      ? "linear-gradient(to bottom, #0b1426 0%, rgba(11,20,38,0.85) 24%, rgba(11,20,38,0) 48%)"
      : "linear-gradient(to bottom, #b9cde6 0%, rgba(185,205,230,0.8) 24%, rgba(185,205,230,0) 48%)";

  return (
    <>
      <DeckGL
      layers={allLayers as never}
      viewState={viewState as never}
      onViewStateChange={(e: { viewState: Record<string, unknown> }) =>
        setViewState(e.viewState)
      }
      // While drag-drawing (circle/rectangle) the drag must draw, not pan.
      controller={{ doubleClickZoom: false, dragPan: !draw.dragToDraw }}
      getCursor={({ isHovering, isDragging }) =>
        drawing ? "crosshair" : isHovering ? "pointer" : isDragging ? "grabbing" : "grab"
      }
      getTooltip={({ object }) =>
        drawing
          ? null
          : // Check aircraft first: they carry a `category` field (ADS-B emitter
            // class) that would otherwise be mistaken for an Alert's category.
            object && (object as TrackedAircraft).hex
            ? buildAircraftTooltip(object as TrackedAircraft)
            : object && (object as Camera).image
              ? buildCameraTooltip(object as Camera)
              : object && (object as Incident).severity !== undefined &&
                  (object as Incident).category !== undefined
                ? buildIncidentTooltip(object as Incident)
              : object && (object as TubeTrain).line_name !== undefined
                ? buildTubeTrainTooltip(object as TubeTrain)
              : object && (object as { lineId?: string; status?: string }).lineId !== undefined &&
                  (object as { status?: string }).status !== undefined
                ? buildTubeLineTooltip(object as { name: string; status: string; lineId: string })
              : object && (object as TubeStation).lines !== undefined
                ? buildTubeStationTooltip(object as TubeStation)
              : object && (object as RailStation).crs !== undefined &&
                  (object as TrackedTrain).headcode === undefined
                ? buildStationTooltip(object as RailStation)
              : object && (object as TrackedTrain).headcode !== undefined &&
                  (object as TrackedTrain).stops !== undefined
                ? buildTrainTooltip(object as TrackedTrain)
              : object && (object as TrackedBus).route !== undefined &&
                  (object as TrackedBus).operator !== undefined
                ? buildBusTooltip(object as TrackedBus)
                : object && Array.isArray((object as FerryRoute).ports)
                  ? buildFerryTooltip(object as FerryRoute)
                : object && (object as FireComplex).kind === "industrial"
                  ? buildIndustrialTooltip(object as FireComplex)
                : object && (object as FireDetection).frp !== undefined
                  ? buildFireTooltip(object as FireDetection)
                : object && (object as Alert).category
                  ? buildAlertTooltip(object as Alert)
                  : buildTooltip(object as TrackedVessel | null)
      }
      onClick={(info) => {
        if (drawing) {
          if (info.coordinate)
            draw.onMapClick([info.coordinate[0], info.coordinate[1]]);
          return;
        }
        // Click on empty space (no vessel, aircraft, camera, fence) clears all.
        if (!info.object) {
          onSelect(null);
          onSelectAircraft(null);
          onSelectCamera(null);
          onSelectBus(null);
          onSelectTrain(null);
        }
      }}
      // Attach drag/hover handlers ONLY while drawing a geofence. When they're
      // present, deck runs a picking pass on every drag-move to populate the
      // callback info — and picking the 3D ScenegraphLayer models (which appear
      // at zoom ≥ 11.5) is heavy enough to stall the controller's pan, so the map
      // gets "stuck" once you zoom in. Omitting them lets normal pan stay pick-free.
      onHover={
        drawing
          ? (info) =>
              draw.onMapHover(
                info.coordinate ? [info.coordinate[0], info.coordinate[1]] : null,
              )
          : undefined
      }
      onDragStart={
        drawing
          ? (info) => {
              if (info.coordinate)
                draw.onMapDragStart([info.coordinate[0], info.coordinate[1]]);
            }
          : undefined
      }
      onDrag={
        drawing
          ? (info) => {
              if (info.coordinate)
                draw.onMapDrag([info.coordinate[0], info.coordinate[1]]);
            }
          : undefined
      }
      onDragEnd={
        drawing
          ? (info) => {
              if (info.coordinate)
                draw.onMapDragEnd([info.coordinate[0], info.coordinate[1]]);
            }
          : undefined
      }
      style={{ position: "absolute", inset: "0" }}
    >
      <Map
        reuseMaps
        mapStyle={
          cinematic
            ? google3d
              ? EMPTY_DARK_STYLE // Google's photoreal mesh is the world
              : CINEMATIC_STYLE
            : theme === "dark"
              ? DARK_STYLE
              : LIGHT_STYLE
        }
        attributionControl={false}
        maxPitch={85}
      />
      </DeckGL>
      {/* Google requires its (dynamic) data attribution be shown over the tiles. */}
      {cinematic && google3d && googleAttribution && (
        <div className="pointer-events-none absolute bottom-1 left-2 z-10 text-[10px] text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
          {googleAttribution}
        </div>
      )}
      {/* Cinematic dimming in replay: knock the basemap + labels back and add a
          vignette so the neon routes read as the foreground. Only the MapLibre
          canvas is filtered — deck's data canvas stays at full brightness. */}
      {replayMode && (
        <>
          <style>{".maplibregl-map{filter:brightness(0.58) saturate(0.85) contrast(1.05)}"}</style>
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "radial-gradient(ellipse at center, rgba(2,6,16,0) 42%, rgba(2,6,16,0.5) 100%)",
            }}
          />
        </>
      )}
      {skyOpacity > 0 && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: skyOpacity,
            background: skyGradient,
            transition: "opacity 300ms ease",
          }}
        />
      )}
    </>
  );
}

/** Viewport bounds as [west, south, east, north] from a deck viewState. */
function boundsFromViewState(
  viewState: Record<string, unknown>,
): [number, number, number, number] {
  const vp = new WebMercatorViewport({
    ...(viewState as Record<string, number>),
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800,
  });
  const [x0, y0] = vp.unproject([0, 0]);
  const [x1, y1] = vp.unproject([vp.width, vp.height]);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function buildTooltip(v: TrackedVessel | null) {
  if (!v) return null;
  const color = colorHexFor(v.ship_type);
  const name = v.name ?? `MMSI ${v.mmsi}`;
  const speed = v.sog != null ? `${v.sog.toFixed(1)} kn` : "—";
  const status = v.nav_status != null ? NAV_STATUS[v.nav_status] ?? "—" : "—";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:160px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px">
          <span style="width:8px;height:8px;border-radius:9999px;background:${color}"></span>
          ${escapeHtml(name)}
        </div>
        <div style="opacity:.7;font-size:11px;line-height:1.5">
          Speed ${speed} · Course ${v.cog != null ? Math.round(v.cog) + "°" : "—"}<br/>
          ${escapeHtml(status)}
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildAircraftTooltip(a: TrackedAircraft) {
  const title = a.callsign ?? a.reg ?? a.hex.toUpperCase();
  const alt = a.on_ground
    ? "on ground"
    : a.alt_baro != null
      ? `${Math.round(a.alt_baro).toLocaleString()} ft`
      : "—";
  const speed = a.gs != null ? `${Math.round(a.gs)} kn` : "—";
  const climb =
    a.baro_rate != null && Math.abs(a.baro_rate) >= 100
      ? ` ${a.baro_rate > 0 ? "▲" : "▼"}${Math.abs(Math.round(a.baro_rate))} fpm`
      : "";
  const type = a.ac_type ? ` · ${escapeHtml(a.ac_type)}` : "";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px">
          <span style="width:8px;height:8px;border-radius:9999px;background:#7dd3fc"></span>
          ${escapeHtml(title)}${type}
        </div>
        <div style="opacity:.7;font-size:11px;line-height:1.5">
          Alt ${alt}${climb}<br/>
          Speed ${speed} · Track ${a.track != null ? Math.round(a.track) + "°" : "—"}
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

/** A pulsing cyan ring + "NEXT" label on the camera a followed bus is heading to. */
function buildNextCameraRing(pos: [number, number], t: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  return [
    new ScatterplotLayer<{ pos: [number, number] }>({
      id: "next-camera-ring",
      data: [{ pos }],
      getPosition: (d) => d.pos,
      stroked: true,
      filled: false,
      getLineColor: [125, 211, 252, Math.round(140 + pulse * 115)],
      lineWidthMinPixels: 2.5,
      getRadius: 26 + pulse * 10,
      radiusUnits: "pixels",
      updateTriggers: { getRadius: t, getLineColor: t },
    }),
    new TextLayer<{ pos: [number, number] }>({
      id: "next-camera-label",
      data: [{ pos }],
      getPosition: (d) => d.pos,
      getText: () => "NEXT",
      getSize: 11,
      getColor: [125, 211, 252],
      getPixelOffset: [0, -34],
      fontFamily: "Inter, system-ui, sans-serif",
      fontWeight: 700,
      outlineColor: [10, 16, 26],
      outlineWidth: 2,
      fontSettings: { sdf: true },
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
    }),
  ];
}

function buildIncidentTooltip(i: Incident) {
  const c = i.severity === "serious" ? "#f43f5e" : i.severity === "moderate" ? "#fb923c" : "#facc15";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:170px;max-width:240px">
        <div style="font-weight:600;margin-bottom:2px">${escapeHtml(i.title)}</div>
        <div style="opacity:.75;font-size:11px;text-transform:capitalize"><span style="color:${c}">${escapeHtml(i.severity)} ${escapeHtml(i.category)}</span> · click for detail</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildFireTooltip(f: FireDetection) {
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px;max-width:230px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="width:10px;height:10px;border-radius:9999px;background:#f97316"></span>
          Wildfire · ${Math.round(f.frp)} MW
        </div>
        <div style="opacity:.75;font-size:11px">${escapeHtml(f.satellite)} · ${escapeHtml(f.instrument)} · tap for detail</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildFerryTooltip(r: FerryRoute) {
  const color =
    r.status === "disruptions" ? "#f43f5e" : r.status === "be_aware" ? "#fbbf24" : "#34d399";
  const label =
    r.status === "disruptions" ? "Disrupted" : r.status === "be_aware" ? "Be aware" : "Sailing normally";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px;max-width:230px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="width:10px;height:10px;border-radius:9999px;background:${color}"></span>
          ${escapeHtml(r.name)}
        </div>
        <div style="opacity:.75;font-size:11px">${escapeHtml(r.operator)} · ${label} · tap for detail</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildIndustrialTooltip(c: FireComplex) {
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px;max-width:230px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="width:10px;height:10px;border-radius:9999px;background:#64748b"></span>
          Industrial heat · ${Math.round(c.total_frp)} MW
        </div>
        <div style="opacity:.75;font-size:11px">${escapeHtml(c.place ?? "Persistent thermal source")} · not a wildfire · tap for detail</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildTubeTrainTooltip(t: TubeTrain) {
  const c = tubeColor(t.line);
  const eta = t.tts != null ? (t.tts < 60 ? `${Math.round(t.tts)}s` : `${Math.round(t.tts / 60)} min`) : "";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:180px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="width:10px;height:10px;border-radius:9999px;background:rgb(${c[0]},${c[1]},${c[2]})"></span>
          ${escapeHtml(t.line_name)} line${t.towards ? ` → ${escapeHtml(t.towards)}` : ""}
        </div>
        <div style="opacity:.75;font-size:11px">${escapeHtml(t.current_location ?? "")}</div>
        ${t.next_station ? `<div style="opacity:.75;font-size:11px">Next: ${escapeHtml(t.next_station)}${eta ? ` · ${eta}` : ""}</div>` : ""}
      </div>`,
    style: tooltipStyle(),
  };
}

function buildTubeLineTooltip(l: { name: string; status: string; lineId: string }) {
  const c = tubeColor(l.lineId);
  const good = l.status === "Good Service";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600">
          <span style="width:10px;height:10px;border-radius:9999px;background:rgb(${c[0]},${c[1]},${c[2]})"></span>
          ${escapeHtml(l.name)} line
        </div>
        <div style="font-size:11px;color:${good ? "#34d399" : "#fbbf24"}">${escapeHtml(l.status)}</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildTubeStationTooltip(st: TubeStation) {
  const dots = st.lines
    .map((l) => {
      const c = tubeColor(l);
      return `<span style="width:8px;height:8px;border-radius:9999px;background:rgb(${c[0]},${c[1]},${c[2]});display:inline-block;margin-right:3px"></span>`;
    })
    .join("");
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif">
        <div style="font-weight:600">${escapeHtml(st.name)}</div>
        <div style="margin-top:3px">${dots}</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildStationTooltip(st: RailStation) {
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif">
        <div style="font-weight:600">${escapeHtml(st.name)}</div>
        <div style="opacity:.7;font-size:11px">Station · ${escapeHtml(st.crs)}</div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildTrainTooltip(t: TrackedTrain) {
  const late = t.delay_min ?? 0;
  const status = late >= 1
    ? `<span style="color:${late >= 5 ? "#f43f5e" : "#fbbf24"}">${Math.round(late)} min late</span>`
    : '<span style="color:#34d399">on time</span>';
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:170px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="min-width:18px;height:16px;padding:0 4px;border-radius:4px;background:#334155;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">${escapeHtml(t.headcode ?? "?")}</span>
          ${escapeHtml(t.origin ?? "")} → ${escapeHtml(t.destination ?? "")}
        </div>
        <div style="opacity:.7;font-size:11px">
          ${escapeHtml(t.operator ?? "")} · ${status}${t.sim ? " · simulated" : ""}
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildBusTooltip(b: TrackedBus) {
  const color = b.operator === "TFLO" ? "#e22d26" : "#f59e0b";
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="min-width:18px;height:16px;padding:0 3px;border-radius:4px;background:${color};color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center">${escapeHtml(b.route ?? "?")}</span>
          ${escapeHtml(b.destination ?? "")}
        </div>
        <div style="opacity:.7;font-size:11px">
          ${b.operator === "TFLO" ? "Transport for London" : escapeHtml(b.operator ?? "")} · click to follow
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

function buildCameraTooltip(c: Camera) {
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:150px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:2px">
          <span style="width:8px;height:8px;border-radius:9999px;background:${c.available ? "#fbbf24" : "#94a3b8"}"></span>
          ${escapeHtml(c.name ?? "Traffic camera")}
        </div>
        <div style="opacity:.7;font-size:11px">
          ${c.available ? "Click to view live" : "Offline"}
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

const ALERT_VERB: Record<string, string> = {
  rendezvous: "Rendezvous",
  spoof: "Position jump / spoof",
  enter: "Zone entry",
  exit: "Zone exit",
  dwell: "Loitering",
  speed: "Speeding",
  dark: "Went dark",
};

function buildAlertTooltip(a: Alert) {
  const title = a.title ?? ALERT_VERB[a.kind] ?? a.kind;
  const who = a.name ?? (a.mmsi != null ? `MMSI ${a.mmsi}` : "Unknown vessel");
  const when = new Date(a.ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;min-width:170px">
        <div style="display:flex;align-items:center;gap:6px;font-weight:600;margin-bottom:4px">
          <span style="width:8px;height:8px;border-radius:9999px;background:#facc15"></span>
          ${escapeHtml(title)}
        </div>
        <div style="opacity:.7;font-size:11px;line-height:1.5">
          ${escapeHtml(who)}<br/>${escapeHtml(when)}
        </div>
      </div>`,
    style: tooltipStyle(),
  };
}

/** Theme-aware tooltip chrome (dark chip on dark map, light chip on light). */
function tooltipStyle() {
  const dark = document.documentElement.classList.contains("dark");
  return {
    background: dark ? "rgba(13,18,30,0.92)" : "rgba(255,255,255,0.96)",
    color: dark ? "#e8eef7" : "#0f1c33",
    border: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(15,30,60,0.1)",
    borderRadius: "10px",
    padding: "8px 10px",
    fontSize: "12px",
    boxShadow: dark ? "0 8px 24px -8px rgba(0,0,0,.7)" : "0 8px 24px -10px rgba(15,30,60,.3)",
    backdropFilter: "blur(8px)",
  };
}

function escapeHtml(s: string) {
  // Coerce defensively: a tooltip must never throw (deck calls it on every
  // hover/pick, so a thrown error there stalls all map interaction).
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

export const MapView = forwardRef(MapViewInner);
