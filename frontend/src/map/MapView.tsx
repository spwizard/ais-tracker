import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
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
import type { TrackedVessel, DensityPoint } from "@/types";
import { NAV_STATUS, colorHexFor } from "@/lib/shipTypes";
import { buildLayers } from "./layers";
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
}

interface MapViewProps {
  vessels: TrackedVessel[];
  version: number;
  showTrails: boolean;
  trailWindowSec: number;
  densityMode: boolean;
  selectedMmsi: number | null;
  onSelect: (v: TrackedVessel | null) => void;
  theme: "light" | "dark";
  highlightTrack: [number, number, number][] | null;
  highlightColor: [number, number, number];
  flaggedMmsis: Set<number>;
  densityOverride: DensityPoint[] | null;
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
    theme,
    highlightTrack,
    highlightColor,
    flaggedMmsis,
    densityOverride,
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

  // Animation clock: drives both vessel dead-reckoning and the trail fade.
  // Kept local to the map so 60fps ticks re-render only the map, not the app.
  const [currentTime, setCurrentTime] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (!document.hidden) setCurrentTime(Date.now() / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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

  const layers = useMemo(
    () => [
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
        zoom: (viewState.zoom as number) ?? 7,
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
        densityOverride,
      }),
      ...buildDraftLayers(
        drawMode ? { shape: drawMode, points: draw.points, hover: draw.hover, color: drawColor } : null,
      ),
    ],
    // currentTime drives trail animation + motion; version drives data refresh.
    [
      vessels,
      version,
      viewState,
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
      densityOverride,
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
        drawing ? null : buildTooltip(object as TrackedVessel | null)
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
