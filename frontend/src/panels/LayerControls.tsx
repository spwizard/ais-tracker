/**
 * The Eyes rail — every data layer, scoped to what's in front of you.
 *
 * Rules (see lib/regions.ts + lib/layers.ts):
 *  - A switch shows or hides. It never moves the map.
 *  - Rows carry a live in-view count, so a switch is honest about what it will
 *    show. A layer whose feed can't have data in the current view is folded
 *    under "Elsewhere" with a "→ go there" link — the one thing here allowed to
 *    fly, because you asked for it.
 *  - Map *treatments* (3D, replay, density, weather) live apart under "View".
 */
import { useState, type ReactNode } from "react";
import {
  Eye,
  Route,
  Navigation,
  Flame,
  Wind,
  Waves,
  History,
  Loader2,
  Mountain,
  Plane,
  Cctv,
  LayoutGrid,
  Bus,
  ChevronDown,
  PanelRight,
  type LucideIcon,
  TrainFront,
  TramFront,
  Activity,
  Landmark,
  TriangleAlert,
  Ship,
  CloudLightning,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import { LAYERS, type LayerKey, type LayerMeta } from "@/lib/layers";
import { boundsIntersect, inBounds } from "@/lib/regions";
import type { ViewTarget } from "@/map/MapView";

interface LayerControlsProps {
  chrome: PanelChrome;
  /** Chosen region's name, or null for a custom (panned-away) view. */
  regionLabel: string | null;
  viewportBounds: [number, number, number, number] | null;
  counts: Partial<Record<LayerKey, number>>;
  onGoTo: (t: ViewTarget) => void;
  /** Which side rails are open, and a toggle for them (one at a time). */
  railOpen: Partial<Record<"incidents" | "fire" | "ferry", boolean>>;
  onOpenRail: (k: "incidents" | "fire" | "ferry") => void;
  showVessels: boolean;
  onToggleVessels: (v: boolean) => void;
  showTrails: boolean;
  onToggleTrails: (v: boolean) => void;
  densityMode: boolean;
  onToggleDensity: (v: boolean) => void;
  showWind: boolean;
  onToggleWind: (v: boolean) => void;
  windAvailable: boolean;
  showWaves: boolean;
  onToggleWaves: (v: boolean) => void;
  wavesAvailable: boolean;
  showAir: boolean;
  onToggleAir: (v: boolean) => void;
  airAvailable: boolean;
  showFire: boolean;
  onToggleFire: (v: boolean) => void;
  fireAvailable: boolean;
  showFerry: boolean;
  onToggleFerry: (v: boolean) => void;
  ferryAvailable: boolean;
  showHazards: boolean;
  onToggleHazards: (v: boolean) => void;
  hazardAvailable: boolean;
  showBus: boolean;
  showTrain: boolean;
  showTube: boolean;
  onToggleBus: (v: boolean) => void;
  onToggleTrain: (v: boolean) => void;
  onToggleTube: (v: boolean) => void;
  onOpenRailPulse?: () => void;
  showHotspots?: boolean;
  onToggleHotspots?: () => void;
  onOpenLondon?: () => void;
  showIncidents?: boolean;
  onToggleIncidents?: (v: boolean) => void;
  incidentsAvailable?: boolean;
  busAvailable: boolean;
  trainAvailable: boolean;
  tubeAvailable: boolean;
  showCameras: boolean;
  onToggleCameras: (v: boolean) => void;
  camerasAvailable: boolean;
  onOpenWall: () => void;
  wallCount: number;
  replayMode: boolean;
  onToggleReplay: (v: boolean) => void;
  replayAvailable: boolean;
  replayLoading: boolean;
  cinematic: boolean;
  onToggleCinematic: (v: boolean) => void;
}

const ICONS: Record<LayerKey, LucideIcon> = {
  vessels: Route,
  ferry: Ship,
  air: Plane,
  incidents: TriangleAlert,
  cameras: Cctv,
  bus: Bus,
  train: TrainFront,
  tube: TramFront,
  fire: Flame,
  hazards: CloudLightning,
};

/** A collapsible group (Eyes / Elsewhere / View). */
function Section({
  title,
  children,
  defaultOpen = true,
  trailing,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  trailing?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
        {title}
        {trailing && <span className="ml-auto font-normal normal-case tracking-normal">{trailing}</span>}
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

/** A compact toggle row; hint on hover; optional in-view count. */
function Row({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
  count,
  goTo,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  count?: number;
  /** Shown instead of a zero count: "→ Iberia" flies to where the data is. */
  goTo?: { label: string; onClick: () => void };
}) {
  const content = (
    <span className="flex min-w-0 items-center gap-2 text-sm">
      <Icon className={cn("h-4 w-4 shrink-0", checked ? "text-primary" : "text-muted-foreground")} />
      <span className="truncate">{label}</span>
    </span>
  );
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 transition-colors hover:bg-foreground/5">
      {hint ? (
        <Hint label={hint} side="right">
          {content}
        </Hint>
      ) : (
        content
      )}
      <span className="flex shrink-0 items-center gap-2">
        {count === 0 && goTo ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              goTo.onClick();
            }}
            className="rounded px-1 font-mono text-[10px] text-primary hover:bg-primary/10"
          >
            → {goTo.label}
          </button>
        ) : count != null ? (
          <span
            className={cn(
              "font-mono text-[10px] tabular-nums",
              count > 0 ? "text-muted-foreground" : "text-muted-foreground/50",
            )}
          >
            {count.toLocaleString()}
          </span>
        ) : null}
        <Switch checked={checked} onCheckedChange={onChange} />
      </span>
    </label>
  );
}

/** Indented drill-in action under a layer row. */
function SubAction({
  icon: Icon,
  label,
  onClick,
  active,
  activeClass,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ml-6 flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        active ? activeClass : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "" : "text-primary/80")} />
      {label}
    </button>
  );
}

export function LayerControls(props: LayerControlsProps) {
  const {
    chrome,
    regionLabel,
    viewportBounds,
    counts,
    onGoTo,
    railOpen,
    onOpenRail,
    showVessels,
    onToggleVessels,
    densityMode,
    onToggleDensity,
    showWind,
    onToggleWind,
    windAvailable,
    showWaves,
    onToggleWaves,
    wavesAvailable,
    showAir,
    onToggleAir,
    airAvailable,
    showFire,
    onToggleFire,
    fireAvailable,
    showFerry,
    onToggleFerry,
    ferryAvailable,
    showHazards,
    onToggleHazards,
    hazardAvailable,
    showBus,
    showTrain,
    showTube,
    onToggleBus,
    onToggleTrain,
    onToggleTube,
    onOpenRailPulse,
    showHotspots,
    onToggleHotspots,
    onOpenLondon,
    showIncidents = false,
    onToggleIncidents,
    incidentsAvailable = false,
    busAvailable,
    trainAvailable,
    tubeAvailable,
    showCameras,
    onToggleCameras,
    camerasAvailable,
    onOpenWall,
    wallCount,
    replayMode,
    onToggleReplay,
    replayAvailable,
    replayLoading,
    cinematic,
    onToggleCinematic,
  } = props;

  // Per-layer availability (backend flag) + state + setter, keyed like LAYERS.
  const state: Record<LayerKey, { available: boolean; on: boolean; set: (v: boolean) => void }> = {
    vessels: { available: true, on: showVessels, set: onToggleVessels },
    ferry: { available: ferryAvailable, on: showFerry, set: onToggleFerry },
    air: { available: airAvailable, on: showAir, set: onToggleAir },
    incidents: { available: incidentsAvailable && !!onToggleIncidents, on: showIncidents, set: onToggleIncidents ?? (() => {}) },
    cameras: { available: camerasAvailable, on: showCameras, set: onToggleCameras },
    bus: { available: busAvailable, on: showBus, set: onToggleBus },
    train: { available: trainAvailable, on: showTrain, set: onToggleTrain },
    tube: { available: tubeAvailable, on: showTube, set: onToggleTube },
    fire: { available: fireAvailable, on: showFire, set: onToggleFire },
    hazards: { available: hazardAvailable, on: showHazards, set: onToggleHazards },
  };

  const here: LayerMeta[] = [];
  const elsewhere: LayerMeta[] = [];
  for (const l of LAYERS) {
    if (!state[l.key].available) continue;
    // A layer that's already on stays in the main list even if you've panned
    // out of its footprint — hiding a live switch would be a surprise.
    const covered = !l.coverage || !viewportBounds || boundsIntersect(l.coverage, viewportBounds);
    (covered || state[l.key].on ? here : elsewhere).push(l);
  }
  const onCount = here.filter((l) => state[l.key].on).length;

  // "→ go there" only makes sense when there is a there: skip it when the
  // layer's home is already inside the view (a plain 0 is the honest answer).
  const goToFor = (l: LayerMeta) => {
    if (!l.home || !l.homeLabel) return undefined;
    if (viewportBounds && inBounds(viewportBounds, l.home.longitude, l.home.latitude)) return undefined;
    return { label: l.homeLabel, onClick: () => onGoTo(l.home!) };
  };

  return (
    <FloatingPanel title="Eyes" icon={Eye} width={280} {...chrome}>
      <div className="space-y-2 p-3">
        <Section
          title={regionLabel ?? "Custom view"}
          trailing={<span className="text-[10px] text-muted-foreground/60">{onCount} on · in view</span>}
        >
          {here.map((l) => {
            const st = state[l.key];
            return (
              <div key={l.key}>
                <Row
                  icon={ICONS[l.key]}
                  label={l.label}
                  hint={l.hint}
                  checked={st.on}
                  onChange={st.set}
                  count={counts[l.key]}
                  goTo={goToFor(l)}
                />
                {(l.key === "incidents" || l.key === "fire" || l.key === "ferry") && st.on && (
                  <SubAction
                    icon={PanelRight}
                    label={l.key === "incidents" ? "Incident rail" : l.key === "fire" ? "Fire complexes" : "Service status"}
                    onClick={() => onOpenRail(l.key as "incidents" | "fire" | "ferry")}
                    active={!!railOpen[l.key as "incidents" | "fire" | "ferry"]}
                    activeClass="bg-primary/15 text-primary"
                  />
                )}
                {l.key === "train" && st.on && onOpenRailPulse && (
                  <SubAction icon={Activity} label="State of the Railway" onClick={onOpenRailPulse} />
                )}
                {l.key === "train" && st.on && onToggleHotspots && (
                  <SubAction
                    icon={Flame}
                    label="Delay hotspots"
                    onClick={onToggleHotspots}
                    active={showHotspots}
                    activeClass="bg-orange-500/15 text-orange-300"
                  />
                )}
                {l.key === "tube" && st.on && onOpenLondon && (
                  <SubAction icon={Landmark} label="London transport pulse" onClick={onOpenLondon} />
                )}
                {l.key === "cameras" && st.on && (
                  <SubAction
                    icon={LayoutGrid}
                    label={`Camera wall${wallCount > 0 ? ` (${wallCount})` : ""}`}
                    onClick={onOpenWall}
                  />
                )}
              </div>
            );
          })}
        </Section>

        {elsewhere.length > 0 && (
          <Section title="Elsewhere" defaultOpen>
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground/50">
              <Navigation className="h-3 w-3" />
              Eyes with no coverage in this view
            </div>
            {elsewhere.map((l) => (
              <button
                key={l.key}
                onClick={() => l.home && onGoTo(l.home)}
                className="flex w-full items-center justify-between rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  {(() => {
                    const Icon = ICONS[l.key];
                    return <Icon className="h-4 w-4 opacity-60" />;
                  })()}
                  {l.label}
                </span>
                {l.homeLabel && (
                  <span className="font-mono text-[10px] text-primary">→ {l.homeLabel}</span>
                )}
              </button>
            ))}
          </Section>
        )}

        <Section title="View" defaultOpen={false}>
          <Row
            icon={Mountain}
            label="Cinematic coast (3D)"
            hint="Photoreal 3D terrain + buildings, tilted to the horizon."
            checked={cinematic}
            onChange={onToggleCinematic}
          />
          {replayAvailable && (
            <>
              <Row
                icon={History}
                label="Movement replay"
                hint="Scrub recent vessel tracks in view through time. Pauses the live feed."
                checked={replayMode}
                onChange={onToggleReplay}
              />
              {replayMode && replayLoading && (
                <div className="flex items-center gap-2 px-1 text-[11px] text-primary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading tracks…
                </div>
              )}
            </>
          )}
          <Row
            icon={Waves}
            label="Shipping density"
            hint="Shipping-lane density heatmap. Also appears automatically when you zoom out."
            checked={densityMode}
            onChange={onToggleDensity}
          />
          {windAvailable && (
            <Row icon={Wind} label="Wind (GFS)" checked={showWind} onChange={onToggleWind} />
          )}
          {wavesAvailable && (
            <Row
              icon={Waves}
              label="Sea state (GFS-Wave)"
              hint="Significant wave height from the GFS-Wave model."
              checked={showWaves}
              onChange={onToggleWaves}
            />
          )}
        </Section>
      </div>
    </FloatingPanel>
  );
}
