import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVesselsSocket } from "@/hooks/useVesselsSocket";
import { usePanels, type PanelId } from "@/hooks/usePanels";
import { useTheme } from "@/hooks/useTheme";
import { useSources } from "@/hooks/useSources";
import { useVesselTrail, type TrailPoint } from "@/hooks/useVesselTrail";
import { MapView, type MapHandle, type ViewTarget } from "@/map/MapView";
import { TopBar } from "@/panels/TopBar";
import { FilterPanel } from "@/panels/FilterPanel";
import { StatsPanel } from "@/panels/StatsPanel";
import { LayerControls } from "@/panels/LayerControls";
import { VesselDetail } from "@/panels/VesselDetail";
import { MapControls } from "@/panels/MapControls";
import { ZonesPanel } from "@/panels/ZonesPanel";
import { DrawToolbar } from "@/panels/DrawToolbar";
import { AlertToasts, type ToastAlert } from "@/panels/AlertToasts";
import { OwnershipGraph } from "@/panels/OwnershipGraph";
import { DensityTimeline } from "@/panels/DensityTimeline";
import { useDensity } from "@/hooks/useDensity";
import { useWeather } from "@/hooks/useWeather";
import { useFlag } from "@/hooks/useFlags";
import type { DensityPoint } from "@/types";
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
import { defaultFilters, matchesFilter, type Filters } from "@/lib/filters";
import { colorRgbFor, groupKeyFor } from "@/lib/shipTypes";
import type { TrackedVessel } from "@/types";

function fenceName(cat: FenceCategory, fences: Geofence[]): string {
  const label = FENCE_CATEGORIES.find((c) => c.key === cat)?.label.split(" ")[0] ?? "Zone";
  return `${label} ${fences.filter((f) => f.category === cat).length + 1}`;
}

const TRAIL_WINDOW_SEC = 900; // trails fade over the last 15 minutes

export default function App() {
  const { vesselsRef, version, status, events, riskEvents, flagged } =
    useVesselsSocket();
  const { panels, setOpen, toggle, move, focus, zIndexOf, autoPlace } = usePanels();
  const { theme, toggle: toggleTheme } = useTheme();
  const sources = useSources();

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [showTrails, setShowTrails] = useState(false); // off until the user enables it
  const [densityMode, setDensityMode] = useState(false);
  const [showWind, setShowWind] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [selectedMmsi, setSelectedMmsi] = useState<number | null>(null);
  const [networkMmsi, setNetworkMmsi] = useState<number | null>(null);

  // GFS wind particle overlay (loaded only when the feature flag is on).
  const weatherOn = useFlag("weather");
  const weather = useWeather(weatherOn);

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
  const [showSelectedTrack, setShowSelectedTrack] = useState(false);
  const mapRef = useRef<MapHandle>(null);

  // --- geofences --------------------------------------------------------
  const { fences, compiled, add, update, remove } = useGeofences();
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
    [selected, filters],
  );

  // Backend history for the selected vessel, extended with live positions.
  const trackHistory = useVesselTrail(selectedMmsi);
  const selectedTrack = useMemo<TrailPoint[]>(() => {
    if (!selected) return [];
    if (trackHistory.length === 0) return selected.trail;
    const lastTs = trackHistory[trackHistory.length - 1][2];
    const live = selected.trail.filter((p) => p[2] > lastTs);
    return [...trackHistory, ...live];
  }, [trackHistory, selected]);

  const highlightColor = useMemo(
    () => colorRgbFor(selected?.ship_type ?? null),
    [selected],
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

  // Build the draggable-chrome props the FloatingPanel needs.
  const chromeFor = (id: PanelId): PanelChrome => ({
    position: { x: panels[id].x, y: panels[id].y },
    onMove: (x, y) => move(id, x, y),
    onClose: () => setOpen(id, false),
    onFocus: () => focus(id),
    zIndex: zIndexOf(id),
  });

  const handleJump = (t: ViewTarget) => mapRef.current?.flyTo(t);

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <MapView
        ref={mapRef}
        vessels={filtered}
        version={version}
        showTrails={showTrails}
        trailWindowSec={TRAIL_WINDOW_SEC}
        densityMode={densityMode}
        selectedMmsi={selectedMmsi}
        onSelect={selectVessel}
        theme={theme}
        highlightTrack={
          showSelectedTrack && selectedVisible && selectedTrack.length >= 2
            ? selectedTrack
            : null
        }
        highlightColor={highlightColor}
        flaggedMmsis={flagged}
        densityOverride={densityOverride}
        showWind={showWind}
        windImage={weather.image}
        windMeta={weather.meta}
        compiledFences={compiled}
        fenceCounts={fenceCounts}
        fenceFlash={fenceFlash}
        selectedFenceId={selectedFenceId}
        onSelectFence={selectFence}
        drawMode={drawMode}
        drawColor={categoryColor(drawCategory)}
        onDrawComplete={handleDrawComplete}
        onDrawCancel={() => setDrawMode(null)}
      />

      {/* Floating UI — pointer-events re-enabled per element. */}
      <div className="pointer-events-none absolute inset-0">
        <TopBar
          status={status}
          total={allVessels.length}
          visible={filtered.length}
          sources={sources}
          statusFilter={filters.status}
          onStatusFilter={(s) => setFilters((f) => ({ ...f, status: s }))}
          panelOpen={{
            filters: panels.filters.open,
            stats: panels.stats.open,
            layers: panels.layers.open,
            detail: panels.detail.open,
            zones: panels.zones.open,
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
        />

        {panels.filters.open && (
          <FilterPanel
            chrome={chromeFor("filters")}
            filters={filters}
            onChange={setFilters}
            countsByGroup={countsByGroup}
          />
        )}
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
            showTrails={showTrails}
            onToggleTrails={setShowTrails}
            densityMode={densityMode}
            onToggleDensity={setDensityMode}
            showWind={showWind}
            onToggleWind={setShowWind}
            windAvailable={!!weather.meta?.available}
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

        <AlertToasts alerts={toastAlerts} onClick={onEventClick} />

        {densityMode && (
          <DensityTimeline buckets={buckets} onSelect={onTimelineSelect} />
        )}
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
