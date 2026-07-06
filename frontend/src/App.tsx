import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVesselsSocket } from "@/hooks/useVesselsSocket";
import { usePanels, type PanelId } from "@/hooks/usePanels";
import { useTheme } from "@/hooks/useTheme";
import { useSources } from "@/hooks/useSources";
import { useVesselTrail, type TrailPoint } from "@/hooks/useVesselTrail";
import { MapView, type MapHandle, type ViewTarget } from "@/map/MapView";
import { TopBar, type IslandPanel } from "@/panels/TopBar";
import { IslandDropdown } from "@/panels/IslandDropdown";
import { FiltersContent } from "@/panels/FiltersContent";
import { AlertsContent } from "@/panels/AlertsContent";
import { StatsPanel } from "@/panels/StatsPanel";
import { LayerControls } from "@/panels/LayerControls";
import { VesselDetail } from "@/panels/VesselDetail";
import { AircraftDetail } from "@/panels/AircraftDetail";
import { useAircraftDossier } from "@/hooks/useAircraftDossier";
import { assessRoute } from "@/lib/airRoute";
import type { AirRoute } from "@/map/aircraftLayers";
import { CameraView } from "@/panels/CameraView";
import { CameraWall } from "@/panels/CameraWall";
import { BusDetail } from "@/panels/BusDetail";
import { TrainDetail } from "@/panels/TrainDetail";
import { useCameras } from "@/hooks/useCameras";
import { useStations } from "@/hooks/useStations";
import { useTubeNetwork } from "@/hooks/useTubeNetwork";
import { useCameraWall } from "@/hooks/useCameraWall";
import { nearbyCameras, nextCameraAhead } from "@/lib/nearbyCameras";
import type { Camera, TrackedBus, TrackedTrain, TubeTrain } from "@/types";
import { MapControls } from "@/panels/MapControls";
import { ZonesPanel } from "@/panels/ZonesPanel";
import { DrawToolbar } from "@/panels/DrawToolbar";
import { AlertToasts, type ToastAlert } from "@/panels/AlertToasts";
import { OwnershipGraph } from "@/panels/OwnershipGraph";
import { DensityTimeline } from "@/panels/DensityTimeline";
import { GlobalSearchContent } from "@/panels/GlobalSearch";
import { ReplayTimeline } from "@/panels/ReplayTimeline";
import { AlertCard } from "@/panels/AlertCard";
import { ForecastTimeline } from "@/panels/ForecastTimeline";
import { MapLegend } from "@/panels/MapLegend";
import { AnalystPanel } from "@/panels/AnalystPanel";
import { useAnalyst, type MapDirective } from "@/hooks/useAnalyst";
import { DataSheet, type DataTab } from "@/panels/DataSheet";
import type { Alert } from "@/types";
import { useDensity } from "@/hooks/useDensity";
import { useReplay, type ReplayWindow } from "@/hooks/useReplay";
import { useReplayAlerts } from "@/hooks/useReplayAlerts";
import { alertsAt } from "@/lib/replayAlerts";
import type { TrailMode, ColorMode } from "@/map/replayLayers";
import { useWeather, useWaves } from "@/hooks/useWeather";
import { useFlag } from "@/hooks/useFlags";
import type { DensityPoint, SearchVessel } from "@/types";
import { useGeofences } from "@/hooks/useGeofences";
import type { DrawResult } from "@/hooks/useGeofenceDraw";
import { containsPoint } from "@/geofence/geometry";
import {
  FENCE_CATEGORIES,
  categoryColor,
  type FenceCategory,
  type FenceShape,
  type Geofence,
} from "@/geofence/types";
import type { PanelChrome } from "@/components/FloatingPanel";
import { defaultFilters, matchesFilter, SPEED_MAX, type Filters } from "@/lib/filters";
import { colorRgbFor, groupKeyFor, SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import type { TrackedVessel, TrackedAircraft } from "@/types";

function fenceName(cat: FenceCategory, fences: Geofence[]): string {
  const label = FENCE_CATEGORIES.find((c) => c.key === cat)?.label.split(" ")[0] ?? "Zone";
  return `${label} ${fences.filter((f) => f.category === cat).length + 1}`;
}

const TRAIL_WINDOW_SEC = 900; // trails fade over the last 15 minutes
const SEARCH_API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const SEARCH_TRACK_COLOR: [number, number, number] = [180, 210, 255];

export default function App() {
  const { vesselsRef, aircraftRef, busesRef, trainsRef, tubeRef, version, status, events, riskEvents, flagged, geofenceSync, setTrailGate } =
    useVesselsSocket();
  const { panels, setOpen, toggle, togglePin, move, focus, zIndexOf, autoPlace } =
    usePanels();
  const { theme, toggle: toggleTheme } = useTheme();
  const sources = useSources();

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [showVessels, setShowVessels] = useState(true); // the whole sea picture
  const [showTrails, setShowTrails] = useState(false); // off until the user enables it
  const [densityMode, setDensityMode] = useState(false);
  const [showWind, setShowWind] = useState(false);
  const [showWaves, setShowWaves] = useState(false);
  const [forecastStep, setForecastStep] = useState(0); // GFS forecast hour, 0 = now
  const [is3D, setIs3D] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const google3d = useFlag("google_3d"); // backend proxy can serve photoreal tiles
  const [showAir, setShowAir] = useState(false); // ADS-B air-traffic layer (opt-in)
  const airAvailable = useFlag("air"); // backend ADS-B feed is enabled
  const [showCameras, setShowCameras] = useState(false); // London traffic cameras
  const camerasAvailable = useFlag("cameras");
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const wall = useCameraWall(); // multi-feed camera wall (grid of up to 12)
  const [showBus, setShowBus] = useState(false); // London buses layer
  const busAvailable = useFlag("bus");
  const [showTrain, setShowTrain] = useState(false); // GB trains layer (rail)
  const trainAvailable = useFlag("train");
  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const railStations = useStations(showTrain);
  const [showTube, setShowTube] = useState(false); // London Underground layer
  const tubeAvailable = useFlag("tube");
  const tubeNetwork = useTubeNetwork(showTube);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [followBusId, setFollowBusId] = useState<string | null>(null);
  const [wallBusFollow, setWallBusFollow] = useState<string | null>(null); // wall tracks this bus
  const [wallContext, setWallContext] = useState<string | null>(null); // wall shows cams near an alert

  // Only store aircraft/bus trails while their layer is on (memory).
  useEffect(
    () => setTrailGate({ air: showAir, bus: showBus }),
    [showAir, showBus, setTrailGate],
  );
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [networkMmsi, setNetworkMmsi] = useState<number | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null); // selected aircraft
  const [showAircraftRoute, setShowAircraftRoute] = useState(true);

  // GFS wind particle overlay + GFS-Wave sea state. Metadata (incl. forecast
  // steps) loads whenever the feature flag is on so the toggles + scrubber can
  // appear; the textures load only for the layer that's toggled on, at the
  // scrubbed forecast hour.
  const weatherOn = useFlag("weather");
  const weather = useWeather(weatherOn, forecastStep, showWind);
  const waves = useWaves(weatherOn, forecastStep, showWaves);
  const forecastSteps = weather.steps.length ? weather.steps : waves.steps;

  // Historical traffic-density timeline.
  const { buckets, fetchBucket } = useDensity();
  const [densityOverride, setDensityOverride] = useState<DensityPoint[] | null>(null);
  const onTimelineSelect = useCallback(
    async (ts: number | null) => {
      if (ts == null) {
        setDensityOverride(null);
        return;
      }
      setDensityOverride(await fetchBucket(ts));
    },
    [fetchBucket],
  );
  // Leaving density mode snaps back to live (and hides the timeline).
  useEffect(() => {
    if (!densityMode) setDensityOverride(null);
  }, [densityMode]);

  // --- vessel-movement replay -------------------------------------------
  const replayAvailable = useFlag("replay");
  const [replayMode, setReplayMode] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(true);
  const [replaySpeed, setReplaySpeed] = useState(100);
  const [replayWindow, setReplayWindow] = useState<ReplayWindow | null>(null);
  // Scrub time reported back from the map clock (~4Hz) — drives the readout only.
  const [replayTime, setReplayTime] = useState(0);
  const [replaySelectedMmsi, setReplaySelectedMmsi] = useState<number | null>(null);
  // Alert clicked in replay → a card showing it; alerts stacked on one spot are
  // grouped so you can page through them (e.g. a geofence firing repeatedly).
  const [alertCard, setAlertCard] = useState<{ alerts: Alert[]; index: number } | null>(null);
  const [replayTrailMode, setReplayTrailMode] = useState<TrailMode>("comet");
  const [replayColorMode, setReplayColorMode] = useState<ColorMode>("speed");
  const [replayMovingOnly, setReplayMovingOnly] = useState(false);
  const REPLAY_WINDOW_SEC = 24 * 3600;

  const replay = useReplay(replayMode ? replayWindow : null);
  const replayAlerts = useReplayAlerts(replayMode ? replayWindow : null);

  // The time span actually covered by the tracks IN VIEW — not the whole store's
  // span. This matters when the viewed area has less history than the store (e.g.
  // after a feed outage the English Channel only has the last N hours, while the
  // Baltic span is 48h): the scrubber and start point track the visible data, so
  // replay never opens parked in an empty stretch of time. Tracks are oldest-first
  // per path, so min/max are the path endpoints — O(tracks), not O(points).
  const replayDataSpan = useMemo<[number, number] | null>(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of replay.tracks) {
      const p = t.path;
      if (p.length) {
        lo = Math.min(lo, p[0][2]);
        hi = Math.max(hi, p[p.length - 1][2]);
      }
    }
    return lo <= hi ? [lo, hi] : null;
  }, [replay.tracks]);

  // Slider range = requested window, clamped to the in-view data span (falling
  // back to the store span, then the raw window) so the scrubber doesn't cover
  // empty time.
  const replayRange = useMemo(() => {
    if (!replayWindow) return null;
    const span = replayDataSpan ?? replay.span;
    let { start, end } = replayWindow;
    if (span) {
      start = Math.max(start, span[0]);
      end = Math.min(end, span[1]);
    }
    return end > start ? { start, end } : { start: replayWindow.start, end: replayWindow.end };
  }, [replayWindow, replayDataSpan, replay.span]);

  // Position the clock at the in-view data start ONCE per replay session, after
  // the first fetch lands — not on every refetch (which would jolt on pan).
  const replaySeekedRef = useRef(false);
  useEffect(() => {
    if (!replayMode) replaySeekedRef.current = false;
  }, [replayMode]);
  useEffect(() => {
    const span = replayDataSpan ?? replay.span;
    if (replayMode && !replaySeekedRef.current && span) {
      replaySeekedRef.current = true;
      mapRef.current?.seek(span[0]);
    }
  }, [replayMode, replayDataSpan, replay.span]);

  // Tracks follow the map: update only the bbox (keep the time window + scrub
  // position). Ignore sub-threshold changes so we don't refetch on tiny nudges.
  const onReplayViewportChange = useCallback(
    (bbox: [number, number, number, number]) => {
      setReplayWindow((w) => {
        if (!w) return w;
        const b = w.bbox;
        if (b && b.every((v, i) => Math.abs(v - bbox[i]) < 1e-4)) return w;
        return { ...w, bbox };
      });
    },
    [],
  );

  const toggleReplay = useCallback((on: boolean) => {
    if (on) {
      const bounds = mapRef.current?.getBounds() ?? undefined;
      const end = Date.now() / 1000;
      setReplayWindow({ start: end - REPLAY_WINDOW_SEC, end, bbox: bounds });
      setReplayTime(end - REPLAY_WINDOW_SEC);
      setReplaySelectedMmsi(null);
      setReplayPlaying(true);
      setDensityMode(false); // mutually exclusive with the density timeline
      setReplayMode(true);
    } else {
      setReplayMode(false);
      setAlertCard(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [REPLAY_WINDOW_SEC]);

  // Click an alert marker → card for it + every alert stacked on the same spot,
  // and highlight the related vessel's route.
  const onReplayAlertClick = useCallback(
    (a: Alert) => {
      const { group, index } = alertsAt(replayAlerts, a, replayTime);
      setAlertCard({ alerts: group, index });
      setReplaySelectedMmsi(a.mmsi);
    },
    [replayAlerts, replayTime],
  );

  const setAlertIndex = useCallback((i: number) => {
    setAlertCard((cur) => {
      if (!cur) return cur;
      setReplaySelectedMmsi(cur.alerts[i]?.mmsi ?? null);
      return { ...cur, index: i };
    });
  }, []);
  const [showSelectedTrack, setShowSelectedTrack] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  // --- geofences --------------------------------------------------------
  const { fences, compiled, add, update, remove } = useGeofences(geofenceSync);
  const [drawMode, setDrawMode] = useState<FenceShape | null>(null);
  const [drawCategory, setDrawCategory] = useState<FenceCategory>("custom");
  const [selectedFenceId, setSelectedFenceId] = useState<string | null>(null);

  // --- derive renderable data from the live ref on each version bump -----
  const allVessels = useMemo<TrackedVessel[]>(() => {
    const out: TrackedVessel[] = [];
    for (const v of vesselsRef.current.values()) {
      if (v.lat != null && v.lon != null) out.push(v);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, vesselsRef]);

  // Aircraft (ADS-B) — materialized only while the layer is on, same version bump.
  const aircraft = useMemo<TrackedAircraft[]>(() => {
    if (!showAir) return [];
    const out: TrackedAircraft[] = [];
    for (const a of aircraftRef.current.values()) {
      if (a.lat != null && a.lon != null) out.push(a);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, aircraftRef, showAir]);

  // Selected aircraft (live record) + its dossier (registration/operator/route).
  const selectedAircraft = useMemo(
    () => (selectedHex ? aircraftRef.current.get(selectedHex) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedHex, version, aircraftRef],
  );
  const { data: airDossier, loading: airDossierLoading } = useAircraftDossier(selectedHex);
  // Cross-check the callsign-derived route against the live position (recomputes
  // as the plane moves, via the `version`-keyed selectedAircraft).
  const routeAssessment = useMemo(
    () =>
      selectedAircraft && airDossier?.route
        ? assessRoute(selectedAircraft, airDossier.route)
        : { plausible: true, note: null },
    // `version`: entity records mutate in place, so identity alone won't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedAircraft, airDossier, version],
  );
  // Origin → destination airports for the map overlay — only drawn when the
  // route is toggled on AND the live position actually supports it.
  const airRoute = useMemo<AirRoute | null>(() => {
    const r = airDossier?.route;
    if (!showAircraftRoute || !routeAssessment.plausible) return null;
    if (!r?.origin?.lat || !r?.destination?.lat) return null;
    return {
      from: [r.origin.lon as number, r.origin.lat as number],
      to: [r.destination.lon as number, r.destination.lat as number],
      fromLabel: r.origin.iata ?? r.origin.icao ?? "",
      toLabel: r.destination.iata ?? r.destination.icao ?? "",
    };
  }, [airDossier, showAircraftRoute, routeAssessment]);

  // London buses — materialized only while the layer is on, same version bump.
  const buses = useMemo<TrackedBus[]>(() => {
    if (!showBus) return [];
    const out: TrackedBus[] = [];
    for (const b of busesRef.current.values()) {
      if (b.lat != null && b.lon != null) out.push(b);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, busesRef, showBus]);
  const selectedBus = useMemo(
    () => (selectedBusId ? busesRef.current.get(selectedBusId) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedBusId, version, busesRef],
  );

  // GB trains — materialized only while the layer is on, same version bump.
  const trains = useMemo<TrackedTrain[]>(() => {
    if (!showTrain) return [];
    const out: TrackedTrain[] = [];
    for (const t of trainsRef.current.values()) {
      if (t.lat != null && t.lon != null) out.push(t);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, trainsRef, showTrain]);
  // Underground trains — materialized only while the layer is on.
  const tubeTrains = useMemo<TubeTrain[]>(() => {
    if (!showTube) return [];
    const out: TubeTrain[] = [];
    for (const t of tubeRef.current.values()) {
      if (t.lat != null && t.lon != null) out.push(t);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tubeRef, showTube]);

  const selectedTrain = useMemo(
    () => (selectedTrainId ? trainsRef.current.get(selectedTrainId) ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedTrainId, version, trainsRef],
  );
  // Follow mode: gently keep the followed bus in view as it moves.
  useEffect(() => {
    if (!followBusId) return;
    const b = busesRef.current.get(followBusId);
    if (b?.lat != null && b?.lon != null) mapRef.current?.panTo(b.lon, b.lat);
  }, [version, followBusId, busesRef]);
  // Follow's only off-switch is the Follow button in the bus panel — if that
  // panel closes or the bus is deselected, the map must stop chasing the bus
  // (it used to keep panning forever with no visible way to stop it).
  useEffect(() => {
    if (!panels.bus.open || selectedBusId == null) setFollowBusId(null);
  }, [panels.bus.open, selectedBusId]);

  // London traffic cameras — loaded once whenever the feature exists: the map
  // layer, the wall, bus fusion AND alert-eyes all draw on the same catalog.
  const cameras = useCameras(camerasAvailable);
  // Cameras nearest the selected bus, right now (recomputes as it moves).
  const busNearby = useMemo(
    () => (selectedBus ? nearbyCameras(selectedBus, cameras) : []),
    // `version`: the bus record mutates in place as it moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedBus, cameras, version],
  );
  // The camera the selected bus is heading toward next (ahead in its bearing).
  const nextCameraId = useMemo(
    () => (selectedBus ? nextCameraAhead(selectedBus, busNearby) : null),
    [selectedBus, busNearby],
  );
  const nextCameraPos = useMemo<[number, number] | null>(() => {
    const c = nextCameraId ? cameras.find((x) => x.id === nextCameraId) : null;
    return c ? [c.lon, c.lat] : null;
  }, [nextCameraId, cameras]);
  // Wall bus-follow: keep the wall showing the nearest cameras to a bus as it
  // moves. Recompute on each version bump; only replace when the set changes.
  const followedBus = wallBusFollow ? busesRef.current.get(wallBusFollow) ?? null : null;
  // On the wall, badge the camera the followed bus is heading toward next.
  const wallNextId = useMemo(
    () =>
      followedBus
        ? nextCameraAhead(followedBus, nearbyCameras(followedBus, cameras, wall.max))
        : null,
    // `version`: the bus record mutates in place as it moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followedBus, cameras, wall.max, version],
  );
  useEffect(() => {
    if (!wallBusFollow || !wall.open) return;
    const b = busesRef.current.get(wallBusFollow);
    if (!b) return;
    const ids = nearbyCameras(b, cameras, wall.max).map((c) => c.camera.id);
    // Replace only when the SET changes (a camera enters/leaves) — not when the
    // distance order merely shuffles, which would needlessly churn the tiles.
    const cur = wall.ids;
    const sameSet = ids.length === cur.length && ids.every((id) => cur.includes(id));
    if (ids.length && !sameSet) wall.replace(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, wallBusFollow, wall.open, cameras]);
  // Bulk-add the cameras currently in the map view (nearest the centre first).
  const addCamerasInView = useCallback(() => {
    const b = mapRef.current?.getBounds();
    if (!b) return;
    const [w, s, e, n] = b;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const inView = cameras
      .filter((c) => c.lon >= w && c.lon <= e && c.lat >= s && c.lat <= n)
      .sort(
        (a, z) =>
          (a.lon - cx) ** 2 + (a.lat - cy) ** 2 - ((z.lon - cx) ** 2 + (z.lat - cy) ** 2),
      )
      .map((c) => c.id);
    wall.addMany(inView);
  }, [cameras, wall]);

  // Eyes-on-alert: turn the nearest cameras toward an alert (one click from the
  // toast). Wider radius than bus fusion — alerts are sparser than junctions.
  const ALERT_EYES_RADIUS_M = 1500;
  const alertHasEyes = useCallback(
    (a: ToastAlert) =>
      cameras.length > 0 && nearbyCameras(a, cameras, 1, ALERT_EYES_RADIUS_M).length > 0,
    [cameras],
  );
  const alertEyes = useCallback(
    (a: ToastAlert) => {
      const near = nearbyCameras(a, cameras, wall.max, ALERT_EYES_RADIUS_M);
      if (near.length === 0) return;
      setWallBusFollow(null);
      setWallContext(a.title);
      wall.replace(near.map((c) => c.camera.id));
      wall.setOpen(true);
    },
    [cameras, wall],
  );

  const selectedCamera = useMemo(
    () => (selectedCameraId ? cameras.find((c) => c.id === selectedCameraId) ?? null : null),
    [selectedCameraId, cameras],
  );

  const filtered = useMemo(
    () => allVessels.filter((v) => matchesFilter(v, filters)),
    [allVessels, filters],
  );

  const countsByGroup = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of allVessels) {
      const k = groupKeyFor(v.ship_type);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [allVessels]);

  const selected = useMemo(
    () => (selectedMmsi != null ? vesselsRef.current.get(selectedMmsi) ?? null : null),
    // re-read on version so the open detail panel updates live
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMmsi, version, vesselsRef],
  );

  // The selected vessel's on-map artifacts (icon, ring, track) should only show
  // while it passes the current filters — otherwise we'd leave an orphan track.
  const selectedVisible = useMemo(
    () => selected != null && matchesFilter(selected, filters),
    // `version`: the vessel record mutates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, filters, version],
  );

  // Backend history for the selected vessel, extended with live positions.
  const trackHistory = useVesselTrail(selectedMmsi);
  const selectedTrack = useMemo<TrailPoint[]>(() => {
    if (!selected) return [];
    if (trackHistory.length === 0) return selected.trail;
    const lastTs = trackHistory[trackHistory.length - 1][2];
    const live = selected.trail.filter((p) => p[2] > lastTs);
    return [...trackHistory, ...live];
    // `version`: the vessel record (and its trail) mutate in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackHistory, selected, version]);

  const highlightColor = useMemo(
    () => colorRgbFor(selected?.ship_type ?? null),
    // `version`: ship_type can arrive late via static AIS data on the same record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, version],
  );

  const zoomToTrack = () =>
    mapRef.current?.fitBounds(selectedTrack.map((p) => [p[0], p[1]]));

  // Live count of vessels inside each fence (bbox-prefiltered point-in-polygon).
  const fenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of compiled) {
      let n = 0;
      for (const v of allVessels) {
        if (v.lon != null && v.lat != null && containsPoint(c, v.lon, v.lat)) n++;
      }
      counts[c.fence.id] = n;
    }
    return counts;
  }, [compiled, allVessels]);

  const selectFence = (id: string) => {
    setSelectedFenceId(id);
    if (!panels.zones.open) {
      setOpen("zones", true);
      autoPlace("zones");
    }
    focus("zones");
  };

  const handleDrawComplete = (r: DrawResult) => {
    const base = {
      name: fenceName(drawCategory, fences),
      category: drawCategory,
      color: categoryColor(drawCategory),
      visible: true,
      triggers: [{ on: "enter" as const }, { on: "exit" as const }],
    };
    const geom: Partial<Geofence> =
      r.shape === "circle"
        ? { shape: "circle", center: r.center, radiusM: r.radiusM }
        : { shape: r.shape, ring: r.ring };
    setSelectedFenceId(add({ ...base, ...geom } as Omit<Geofence, "id">));
    setDrawMode(null); // finished one shape → back to pan/select
  };

  const zoomFence = (id: string) => {
    const c = compiled.find((c) => c.fence.id === id);
    if (c) mapRef.current?.fitBounds(c.ring);
  };

  const onEventClick = (e: { mmsi: number; lat: number; lon: number }) => {
    const v = vesselsRef.current.get(e.mmsi);
    // Prefer the vessel's live (dead-reckoned) position; fall back to the event's.
    const lon = v?.lon ?? e.lon;
    const lat = v?.lat ?? e.lat;
    if (v) selectVessel(v);
    mapRef.current?.flyTo({ longitude: lon, latitude: lat, zoom: 14 });
  };

  // Selecting a live vessel from the ownership-network graph.
  const selectByMmsi = (mmsi: number) => {
    const v = vesselsRef.current.get(mmsi);
    if (!v) return;
    selectVessel(v);
    if (v.lon != null && v.lat != null) {
      mapRef.current?.flyTo({ longitude: v.lon, latitude: v.lat, zoom: 13 });
    }
  };

  // --- AI analyst ---------------------------------------------------------
  const [analystMmsis, setAnalystMmsis] = useState<Set<number>>(new Set());
  const onAnalystMap = useCallback(
    (d: MapDirective) => {
      if (d.mmsis) setAnalystMmsis(new Set(d.mmsis));
      // Prefer framing the cited vessels by their actual live positions — tight
      // and precise, and fitBounds caps the zoom so it never dives into the
      // heatmap regime. Fall back to the model's coarse area hint only when no
      // cited vessel is locatable.
      const pts: [number, number][] = [];
      for (const m of d.mmsis ?? []) {
        const v = vesselsRef.current.get(m);
        if (v && v.lon != null && v.lat != null) pts.push([v.lon, v.lat]);
      }
      if (pts.length > 0) {
        mapRef.current?.fitBounds(pts);
      } else if (d.lat != null && d.lon != null) {
        mapRef.current?.flyTo({ longitude: d.lon, latitude: d.lat, zoom: d.zoom ?? 9 });
      }
    },
    [vesselsRef],
  );
  const analyst = useAnalyst(onAnalystMap);
  // Closing the panel clears the analyst's rings.
  useEffect(() => {
    if (!panels.analyst.open) setAnalystMmsis(new Set());
  }, [panels.analyst.open]);

  // --- data sheet (vessels / alerts tables) -----------------------------
  const [sheet, setSheet] = useState<{ open: boolean; tab: DataTab; minimized: boolean }>({
    open: false,
    tab: "vessels",
    minimized: false,
  });
  const [hoverMmsi, setHoverMmsi] = useState<number | null>(null);
  const openData = (tab: DataTab) => setSheet({ open: true, tab, minimized: false });
  const onTableSelectVessel = (mmsi: number) => {
    selectByMmsi(mmsi); // select + fly + open detail
    setSheet((s) => ({ ...s, minimized: true })); // drop the sheet to a bar
    setHoverMmsi(null);
  };
  const onSelectAlert = (a: Alert) => {
    if (a.mmsi != null && vesselsRef.current.has(a.mmsi)) {
      selectByMmsi(a.mmsi);
    } else if (a.lat != null && a.lon != null) {
      mapRef.current?.flyTo({ longitude: a.lon, latitude: a.lat, zoom: 11 });
    }
    setSheet((s) => ({ ...s, minimized: true }));
  };

  // Which graph vessels are currently live (clickable) — snapshot while open.
  const liveMmsis = useMemo(
    () =>
      networkMmsi != null
        ? new Set(vesselsRef.current.keys())
        : new Set<number>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [networkMmsi, version, vesselsRef],
  );

  // Unified toast feed: geofence events + behavioral risk events.
  const toastAlerts = useMemo<ToastAlert[]>(() => {
    const verb: Record<string, string> = {
      enter: "entered",
      exit: "left",
      dwell: "dwelling in",
      speed: "speeding in",
      dark: "went dark in",
    };
    const geo = events.map((e) => ({
      key: `g-${e.ts}-${e.mmsi}-${e.fence_id}-${e.event}`,
      ts: e.ts,
      kind: e.event,
      title: e.name ?? `MMSI ${e.mmsi}`,
      subtitle: `${verb[e.event] ?? e.event} ${e.fence_name}`,
      mmsi: e.mmsi,
      lat: e.lat,
      lon: e.lon,
    }));
    const risk = riskEvents.map((e) => ({
      key: `r-${e.ts}-${e.mmsi}-${e.kind}`,
      ts: e.ts,
      kind: e.kind,
      title: e.title,
      subtitle:
        e.kind === "rendezvous"
          ? `${e.name ?? e.mmsi} ⇄ ${e.name_b ?? e.mmsi_b} · ${e.detail.dist_nm} nm`
          : `${e.name ?? `MMSI ${e.mmsi}`} · ${e.detail.jump_nm} nm in ${e.detail.gap_sec}s`,
      mmsi: e.mmsi,
      lat: e.lat,
      lon: e.lon,
    }));
    return [...risk, ...geo];
  }, [events, riskEvents]);

  // Most-recent event timestamp per fence — drives the on-map border pulse.
  const fenceFlash = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of events) {
      if (!(e.fence_id in m) || e.ts > m[e.fence_id]) m[e.fence_id] = e.ts;
    }
    return m;
  }, [events]);

  // --- selection <-> detail panel ---------------------------------------
  const selectVessel = (v: TrackedVessel | null) => {
    setSearchTrack(null); // a live selection (or deselect) clears any dark-vessel track
    setSelectedMmsi(v?.mmsi ?? null);
    if (v) {
      setOpen("detail", true);
      // Drop the detail panel into a free slot so it never covers an open panel.
      autoPlace("detail");
      focus("detail");
    } else {
      setOpen("detail", false);
    }
  };

  // Aircraft selection → its own detail panel (independent of the vessel one).
  const selectAircraft = (a: TrackedAircraft | null) => {
    setSelectedHex(a?.hex ?? null);
    if (a) {
      setOpen("aircraft", true);
      autoPlace("aircraft");
      focus("aircraft");
    } else {
      setOpen("aircraft", false);
    }
  };

  // Bus selection → the bus detail panel (follow is opt-in per selection).
  const selectBus = (b: TrackedBus | null) => {
    setSelectedBusId(b?.id ?? null);
    setFollowBusId(null);
    if (b) {
      setOpen("bus", true);
      autoPlace("bus");
      focus("bus");
    } else {
      setOpen("bus", false);
    }
  };

  // Train selection → the train detail panel.
  const selectTrain = (t: TrackedTrain | null) => {
    setSelectedTrainId(t?.id ?? null);
    if (t) {
      setOpen("train", true);
      autoPlace("train");
      focus("train");
    } else {
      setOpen("train", false);
    }
  };

  // Camera selection → the live camera view panel.
  const selectCamera = (c: Camera | null) => {
    setSelectedCameraId(c?.id ?? null);
    if (c) {
      setOpen("camera", true);
      autoPlace("camera");
      focus("camera");
    } else {
      setOpen("camera", false);
    }
  };

  // Selecting a vessel from the replay view: highlight its route AND, when the
  // vessel is still transmitting, open the detail panel (which reads live state).
  const selectReplayVessel = (mmsi: number | null) => {
    setReplaySelectedMmsi(mmsi);
    if (mmsi == null) return;
    const v = vesselsRef.current.get(mmsi);
    if (v) selectVessel(v); // no-op panel if the vessel has gone dark since
  };

  // Build the draggable-chrome props the FloatingPanel needs.
  const chromeFor = (id: PanelId): PanelChrome => ({
    position: { x: panels[id].x, y: panels[id].y },
    onMove: (x, y) => move(id, x, y),
    onClose: () => setOpen(id, false),
    onFocus: () => focus(id),
    zIndex: zIndexOf(id),
    pinned: panels[id].pinned,
    onTogglePin: () => togglePin(id),
  });

  const handleJump = (t: ViewTarget) => mapRef.current?.flyTo(t);

  // --- island dropdowns (search / filters / alerts) --------------------
  const [island, setIsland] = useState<IslandPanel | null>(null);
  const toggleIsland = useCallback(
    (p: IslandPanel) => setIsland((cur) => (cur === p ? null : p)),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsland((cur) => (cur === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const filtersActive =
    filters.status !== "all" ||
    filters.groups.size !== SHIP_TYPE_GROUPS.length ||
    filters.speed[0] > 0 ||
    filters.speed[1] < SPEED_MAX;
  // A no-longer-live vessel picked from search: draw its last-known track from
  // the history store and frame it. Live vessels select + fly as usual.
  const [searchTrack, setSearchTrack] = useState<TrailPoint[] | null>(null);
  const onSearchVessel = (v: SearchVessel) => {
    setSearchTrack(null);
    if (v.live && vesselsRef.current.has(v.mmsi)) {
      selectByMmsi(v.mmsi);
      return;
    }
    if (v.lat != null && v.lon != null) {
      mapRef.current?.flyTo({ longitude: v.lon, latitude: v.lat, zoom: 10 });
      fetch(`${SEARCH_API}/api/vessel/${v.mmsi}/history`)
        .then((r) => r.json())
        .then((d: { track: TrailPoint[] }) => {
          if (d.track && d.track.length >= 2) setSearchTrack(d.track);
        })
        .catch(() => void 0);
    }
  };
  const onSearchLocation = (loc: { lat: number; lon: number; zoom?: number }) =>
    mapRef.current?.flyTo({ longitude: loc.lon, latitude: loc.lat, zoom: loc.zoom ?? 12 });
  const onSearchIntel = (it: { mmsi: number | null; lat?: number | null; lon?: number | null }) => {
    if (it.mmsi != null && vesselsRef.current.has(it.mmsi)) selectByMmsi(it.mmsi);
    else if (it.lat != null && it.lon != null)
      mapRef.current?.flyTo({ longitude: it.lon, latitude: it.lat, zoom: 11 });
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <MapView
        ref={mapRef}
        vessels={showVessels ? filtered : []}
        version={version}
        showTrails={showTrails}
        trailWindowSec={TRAIL_WINDOW_SEC}
        densityMode={densityMode}
        selectedMmsi={replayMode ? replaySelectedMmsi : selectedMmsi}
        onSelect={selectVessel}
        replayMode={replayMode}
        replayTracks={replay.tracks}
        replayAlerts={replayAlerts}
        replayRange={replayRange}
        replayPlaying={replayPlaying}
        replaySpeed={replaySpeed}
        replayTrailMode={replayTrailMode}
        replayColorMode={replayColorMode}
        replayMovingOnly={replayMovingOnly}
        onReplayTime={setReplayTime}
        onReplaySelect={selectReplayVessel}
        onReplayAlertClick={onReplayAlertClick}
        onReplayViewportChange={onReplayViewportChange}
        theme={theme}
        highlightTrack={
          searchTrack ??
          (showSelectedTrack && selectedVisible && selectedTrack.length >= 2
            ? selectedTrack
            : null)
        }
        highlightColor={searchTrack ? SEARCH_TRACK_COLOR : highlightColor}
        flaggedMmsis={flagged}
        analystMmsis={analystMmsis}
        hoverMmsi={hoverMmsi}
        densityOverride={densityOverride}
        showWind={showWind}
        windImage={weather.image}
        windMeta={weather.meta}
        showWaves={showWaves}
        waveImage={waves.image}
        waveMeta={waves.meta}
        compiledFences={compiled}
        fenceCounts={fenceCounts}
        fenceFlash={fenceFlash}
        selectedFenceId={selectedFenceId}
        onSelectFence={selectFence}
        drawMode={drawMode}
        drawColor={categoryColor(drawCategory)}
        onDrawComplete={handleDrawComplete}
        onDrawCancel={() => setDrawMode(null)}
        cinematic={cinematic}
        google3d={google3d}
        aircraft={aircraft}
        showAir={showAir}
        onSelectAircraft={selectAircraft}
        selectedHex={selectedHex}
        airRoute={airRoute}
        cameras={cameras}
        showCameras={showCameras}
        onSelectCamera={selectCamera}
        selectedCameraId={selectedCameraId}
        buses={buses}
        showBus={showBus}
        onSelectBus={selectBus}
        selectedBusId={selectedBusId}
        trains={trains}
        stations={railStations}
        showTrain={showTrain}
        tubeNetwork={tubeNetwork}
        tubeTrains={tubeTrains}
        showTube={showTube}
        onSelectTrain={selectTrain}
        selectedTrainId={selectedTrainId}
        nextCameraPos={nextCameraPos}
      />

      {/* Floating UI — pointer-events re-enabled per element. */}
      <div className="pointer-events-none absolute inset-0">
        <TopBar
          status={status}
          total={allVessels.length}
          visible={filtered.length}
          sources={sources}
          island={island}
          onToggleIsland={toggleIsland}
          hasAlerts={toastAlerts.length > 0}
          filtersActive={filtersActive}
          panelOpen={{
            filters: panels.filters.open,
            stats: panels.stats.open,
            layers: panels.layers.open,
            detail: panels.detail.open,
            aircraft: panels.aircraft.open,
            camera: panels.camera.open,
            bus: panels.bus.open,
            train: panels.train.open,
            zones: panels.zones.open,
            analyst: panels.analyst.open,
          }}
          onTogglePanel={(id) => {
            if (id === "detail" && selectedMmsi == null) return;
            const opening = !panels[id].open;
            toggle(id);
            if (opening) autoPlace(id); // place into a free slot when reopened
            // Closing the Zones panel also stops any in-progress drawing.
            if (id === "zones" && !opening) setDrawMode(null);
          }}
          hasSelection={selectedMmsi != null}
          theme={theme}
          onToggleTheme={toggleTheme}
          dataTab={sheet.open ? sheet.tab : null}
          onOpenData={openData}
        />

        <IslandDropdown open={island === "search"} onClose={() => setIsland(null)}>
          <GlobalSearchContent
            onClose={() => setIsland(null)}
            onSelectVessel={onSearchVessel}
            onSelectAlert={onSelectAlert}
            onJumpLocation={onSearchLocation}
            onSelectIntel={onSearchIntel}
            isLive={(m) => m != null && vesselsRef.current.has(m)}
          />
        </IslandDropdown>

        <IslandDropdown open={island === "filters"} onClose={() => setIsland(null)}>
          <FiltersContent filters={filters} onChange={setFilters} countsByGroup={countsByGroup} />
        </IslandDropdown>

        <IslandDropdown open={island === "alerts"} onClose={() => setIsland(null)}>
          <AlertsContent
            alerts={toastAlerts}
            onSelect={(a) => {
              onEventClick(a);
              setIsland(null);
            }}
            onSeeAll={() => {
              openData("alerts");
              setIsland(null);
            }}
            hasEyes={alertHasEyes}
            onEyes={(a) => {
              alertEyes(a);
              setIsland(null);
            }}
          />
        </IslandDropdown>

        {panels.stats.open && (
          <StatsPanel
            chrome={chromeFor("stats")}
            vessels={allVessels}
            countsByGroup={countsByGroup}
          />
        )}
        {panels.layers.open && (
          <LayerControls
            chrome={chromeFor("layers")}
            showVessels={showVessels}
            onToggleVessels={setShowVessels}
            showTrails={showTrails}
            onToggleTrails={setShowTrails}
            densityMode={densityMode}
            onToggleDensity={setDensityMode}
            showWind={showWind}
            onToggleWind={setShowWind}
            windAvailable={weather.available}
            showWaves={showWaves}
            onToggleWaves={setShowWaves}
            wavesAvailable={waves.available}
            showAir={showAir}
            onToggleAir={setShowAir}
            airAvailable={airAvailable}
            showBus={showBus}
            onToggleBus={setShowBus}
            showTrain={showTrain}
            onToggleTrain={setShowTrain}
            trainAvailable={trainAvailable}
            showTube={showTube}
            onToggleTube={setShowTube}
            tubeAvailable={tubeAvailable}
            busAvailable={busAvailable}
            showCameras={showCameras}
            onToggleCameras={setShowCameras}
            camerasAvailable={camerasAvailable}
            onOpenWall={() => wall.setOpen(true)}
            wallCount={wall.ids.length}
            replayMode={replayMode}
            onToggleReplay={toggleReplay}
            replayAvailable={replayAvailable}
            replayLoading={replay.loading}
            cinematic={cinematic}
            onToggleCinematic={(on) => {
              setCinematic(on);
              setIs3D(on);
              mapRef.current?.setCinematic(on);
            }}
            onJump={handleJump}
          />
        )}
        {panels.detail.open && selected && (
          <VesselDetail
            chrome={chromeFor("detail")}
            vessel={selected}
            track={selectedTrack}
            showOnMap={showSelectedTrack}
            onToggleShowOnMap={() => setShowSelectedTrack((s) => !s)}
            onZoomToTrack={zoomToTrack}
            onOpenNetwork={setNetworkMmsi}
          />
        )}
        {panels.aircraft.open && selectedAircraft && (
          <AircraftDetail
            chrome={chromeFor("aircraft")}
            aircraft={selectedAircraft}
            dossier={airDossier}
            loading={airDossierLoading}
            showRoute={showAircraftRoute}
            routeWarning={routeAssessment.note}
            onToggleShowRoute={() => setShowAircraftRoute((s) => !s)}
            onZoomToRoute={() => {
              if (airRoute) mapRef.current?.fitBounds([airRoute.from, airRoute.to]);
            }}
          />
        )}
        {panels.bus.open && selectedBus && (
          <BusDetail
            chrome={chromeFor("bus")}
            bus={selectedBus}
            following={followBusId === selectedBus.id}
            onToggleFollow={() =>
              setFollowBusId((f) => (f === selectedBus.id ? null : selectedBus.id))
            }
            onZoomTo={() =>
              mapRef.current?.flyTo({
                longitude: selectedBus.lon as number,
                latitude: selectedBus.lat as number,
                zoom: 15,
              })
            }
            nearby={busNearby}
            nextId={nextCameraId}
            onOpenCamera={(c) => selectCamera(c)}
            onWatchNearby={() => {
              setWallBusFollow(selectedBus.id);
              setWallContext(null);
              wall.replace(busNearby.map((c) => c.camera.id));
              wall.setOpen(true);
            }}
          />
        )}
        {panels.train.open && selectedTrain && (
          <TrainDetail
            chrome={chromeFor("train")}
            train={selectedTrain}
            onZoomTo={() =>
              mapRef.current?.flyTo({
                longitude: selectedTrain.lon as number,
                latitude: selectedTrain.lat as number,
                zoom: 11,
              })
            }
          />
        )}
        {panels.camera.open && selectedCamera && (
          <CameraView
            chrome={chromeFor("camera")}
            camera={selectedCamera}
            onZoomTo={() =>
              mapRef.current?.flyTo({
                longitude: selectedCamera.lon,
                latitude: selectedCamera.lat,
                zoom: 15,
              })
            }
            inWall={wall.ids.includes(selectedCamera.id)}
            onAddToWall={() => wall.add(selectedCamera.id)}
          />
        )}
        <CameraWall
          open={wall.open}
          onOpenChange={(v) => {
            // Closing the wall ends its follow/eyes-on context — reopening
            // later shouldn't surprise-resume tracking an old bus or alert.
            if (!v) {
              setWallBusFollow(null);
              setWallContext(null);
            }
            wall.setOpen(v);
          }}
          cameras={cameras}
          ids={wall.ids}
          onToggle={(id) => {
            setWallBusFollow(null); // manual edit exits bus-follow / alert context
            setWallContext(null);
            wall.toggle(id);
          }}
          onRemove={(id) => {
            setWallBusFollow(null);
            setWallContext(null);
            wall.remove(id);
          }}
          onClear={() => {
            setWallBusFollow(null);
            setWallContext(null);
            wall.clear();
          }}
          onAddInView={() => {
            setWallBusFollow(null);
            setWallContext(null);
            addCamerasInView();
          }}
          onFocus={(c) => {
            wall.setOpen(false);
            selectCamera(c);
          }}
          max={wall.max}
          followLabel={followedBus ? `Route ${followedBus.route ?? "?"}` : null}
          onUnfollow={() => setWallBusFollow(null)}
          contextLabel={wallContext}
          onClearContext={() => setWallContext(null)}
          nextId={wallNextId}
        />
        {panels.zones.open && (
          <ZonesPanel
            chrome={chromeFor("zones")}
            fences={fences}
            counts={fenceCounts}
            selectedId={selectedFenceId}
            events={events}
            onSelect={selectFence}
            onSetVisible={(id, v) => update(id, { visible: v })}
            onRename={(id, name) => update(id, { name })}
            onSetTriggers={(id, triggers) => update(id, { triggers })}
            onZoom={zoomFence}
            onRemove={(id) => {
              remove(id);
              if (selectedFenceId === id) setSelectedFenceId(null);
            }}
            onEventClick={onEventClick}
          />
        )}
        {panels.zones.open && (
          <DrawToolbar
            drawMode={drawMode}
            onSetMode={setDrawMode}
            category={drawCategory}
            onSetCategory={setDrawCategory}
          />
        )}
        {panels.analyst.open && (
          <AnalystPanel
            chrome={chromeFor("analyst")}
            messages={analyst.messages}
            busy={analyst.busy}
            onSend={analyst.send}
            onStop={analyst.stop}
            onClear={analyst.clear}
            onVessel={selectByMmsi}
            onOpenCamera={(id) => {
              const c = cameras.find((x) => x.id === id);
              if (c) selectCamera(c);
            }}
          />
        )}

        <MapControls
          onZoom={(d) => mapRef.current?.zoomBy(d)}
          onPitch={(d) => {
            mapRef.current?.pitchBy(d);
            if (d > 0) setIs3D(true);
          }}
          onResetNorth={() => {
            mapRef.current?.resetNorth();
            setIs3D(false);
          }}
          onFit={() => mapRef.current?.fit()}
          is3D={is3D}
          onToggle3D={() => {
            const next = !is3D;
            setIs3D(next);
            mapRef.current?.set3D(next);
          }}
        />

        <AlertToasts
          alerts={toastAlerts}
          onClick={onEventClick}
          hasEyes={alertHasEyes}
          onEyes={alertEyes}
        />

        {densityMode && (
          <DensityTimeline buckets={buckets} onSelect={onTimelineSelect} />
        )}

        {replayMode && replay.loading && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
            <div className="glass flex items-center gap-3 px-5 py-3 text-sm">
              <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
              Loading replay tracks…
            </div>
          </div>
        )}

        {replayMode && replayRange && (
          <ReplayTimeline
            range={replayRange}
            currentTime={replayTime}
            playing={replayPlaying}
            onTogglePlaying={() => setReplayPlaying((p) => !p)}
            speed={replaySpeed}
            onSpeed={setReplaySpeed}
            trailMode={replayTrailMode}
            onTrailMode={setReplayTrailMode}
            colorMode={replayColorMode}
            onColorMode={setReplayColorMode}
            movingOnly={replayMovingOnly}
            onMovingOnly={setReplayMovingOnly}
            onSeek={(t) => mapRef.current?.seek(t)}
            onExit={() => toggleReplay(false)}
            loading={replay.loading}
            trackCount={replay.tracks.length}
          />
        )}

        {replayMode && alertCard && (
          <AlertCard
            alerts={alertCard.alerts}
            index={alertCard.index}
            onIndex={setAlertIndex}
            onSelectVessel={selectReplayVessel}
            onClose={() => setAlertCard(null)}
          />
        )}

        <MapLegend
          showWind={showWind}
          windAvailable={weather.available}
          showWaves={showWaves}
          wavesAvailable={waves.available}
          densityMode={densityMode}
          replayMode={replayMode}
          replayColorMode={replayColorMode}
          flaggedCount={flagged.size}
          hasSelection={selectedMmsi != null}
        />

        {(showWind || showWaves) && (
          <ForecastTimeline
            steps={forecastSteps}
            value={forecastStep}
            onChange={setForecastStep}
            raised={densityMode}
          />
        )}

        <DataSheet
          open={sheet.open}
          tab={sheet.tab}
          onTab={(t) => setSheet((s) => ({ ...s, tab: t, minimized: false }))}
          onClose={() => {
            setSheet((s) => ({ ...s, open: false }));
            setHoverMmsi(null);
          }}
          minimized={sheet.minimized}
          onSetMinimized={(v) => setSheet((s) => ({ ...s, minimized: v }))}
          vessels={allVessels}
          flagged={flagged}
          selectedMmsi={selectedMmsi}
          onHoverVessel={setHoverMmsi}
          onSelectVessel={onTableSelectVessel}
          onSelectAlert={onSelectAlert}
        />
      </div>

      {networkMmsi != null && (
        <OwnershipGraph
          mmsi={networkMmsi}
          vesselName={
            vesselsRef.current.get(networkMmsi)?.name ?? `MMSI ${networkMmsi}`
          }
          liveMmsis={liveMmsis}
          onClose={() => setNetworkMmsi(null)}
          onSelectVessel={selectByMmsi}
        />
      )}

      {status === "connecting" && allVessels.length === 0 && <LoadingVeil />}
    </div>
  );
}

function LoadingVeil() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-background/60 backdrop-blur-sm">
      <div className="glass flex items-center gap-3 px-5 py-3 text-sm">
        <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
        Connecting to AIS stream…
      </div>
    </div>
  );
}
