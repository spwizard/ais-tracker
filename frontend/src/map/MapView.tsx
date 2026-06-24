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
import type { TrackedVessel, DensityPoint, WeatherMeta, ReplayTrack, Alert } from "@/types";
import { NAV_STATUS, colorHexFor } from "@/lib/shipTypes";
import { buildLayers } from "./layers";
import { buildReplayLayers, type TrailMode, type ColorMode } from "./replayLayers";
import { advanceClock } from "./replayMath";
import { buildFenceLayers, buildDraftLayers } from "./geofenceLayers";
import { useGeofenceDraw, type DrawResult } from "@/hooks/useGeofenceDraw";
import type { CompiledFence } from "@/geofence/geometry";
import type { FenceShape } from "@/geofence/types";

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
  zoomBy: (delta: number) => void;
  resetNorth: () => void;
  fit: () => void;
  fitBounds: (points: [number, number][]) => void;
  set3D: (on: boolean) => void;
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

  // Live clock — wall-clock, paused while replaying.
  useEffect(() => {
    if (replayMode) return;
    let raf = 0;
    const tick = () => {
      if (!document.hidden) setTime(Date.now() / 1000);
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
      layers={layers as never}
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
        // Click on empty water (no vessel, no fence) clears the vessel selection.
        if (!info.object) onSelect(null);
      }}
      onHover={(info) => {
        if (drawing)
          draw.onMapHover(
            info.coordinate ? [info.coordinate[0], info.coordinate[1]] : null,
          );
      }}
      onDragStart={(info) => {
        if (drawing && info.coordinate)
          draw.onMapDragStart([info.coordinate[0], info.coordinate[1]]);
      }}
      onDrag={(info) => {
        if (drawing && info.coordinate)
          draw.onMapDrag([info.coordinate[0], info.coordinate[1]]);
      }}
      onDragEnd={(info) => {
        if (drawing && info.coordinate)
          draw.onMapDragEnd([info.coordinate[0], info.coordinate[1]]);
      }}
      style={{ position: "absolute", inset: "0" }}
    >
      <Map
        reuseMaps
        mapStyle={theme === "dark" ? DARK_STYLE : LIGHT_STYLE}
        attributionControl={false}
        maxPitch={79}
      />
      </DeckGL>
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
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

export const MapView = forwardRef(MapViewInner);
