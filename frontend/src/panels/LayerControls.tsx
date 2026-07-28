import { useState, type ReactNode } from "react";
import {
  Layers,
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
  type LucideIcon,
  TrainFront,
  TramFront,
  Activity,
  Landmark,
  TriangleAlert,
  Eye,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { ViewTarget } from "@/map/MapView";

interface LayerControlsProps {
  chrome: PanelChrome;
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
  onEnterArgusLondon?: () => void;
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
  onJump: (target: ViewTarget) => void;
}

/** Quick-jump regions for the "zoom to region" buttons. */
const REGIONS: { label: string; target: ViewTarget }[] = [
  { label: "English Channel", target: { longitude: -1.0, latitude: 50.2, zoom: 7.2 } },
  { label: "Thames / Dover", target: { longitude: 1.3, latitude: 51.2, zoom: 8 } },
  { label: "Solent", target: { longitude: -1.3, latitude: 50.78, zoom: 9.5 } },
  { label: "Bristol Channel", target: { longitude: -3.6, latitude: 51.4, zoom: 8 } },
  { label: "Scotland", target: { longitude: -4.3, latitude: 56.8, zoom: 6.3 } },
  // Digitraffic (Fintraffic) coverage — Finnish / Baltic waters.
  { label: "Gulf of Finland", target: { longitude: 25.0, latitude: 59.8, zoom: 7 } },
  // Kystverket coverage — Norwegian coast.
  { label: "Norway (Skagerrak)", target: { longitude: 10.5, latitude: 59.2, zoom: 7 } },
];

/** A collapsible domain group (Sea / Air / Land / View / Regions). */
function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
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
      </button>
      {open && <div className="mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
}

/** A compact toggle row; its description (if any) shows on hover. */
function Row({
  icon: Icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const content = (
    <span className="flex items-center gap-2 text-sm">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {label}
    </span>
  );
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1 transition-colors hover:bg-foreground/5">
      {hint ? (
        <Hint label={hint} side="right">
          {content}
        </Hint>
      ) : (
        content
      )}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function LayerControls({
  chrome,
  showVessels,
  onToggleVessels,
  showTrails,
  onToggleTrails,
  // (trails toggle parked — see the commented row in the Sea section)
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
  showIncidents,
  onToggleIncidents,
  incidentsAvailable,
  onEnterArgusLondon,
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
  onJump,
}: LayerControlsProps) {
  void showTrails;
  void onToggleTrails; // parked with the commented trails row below
  return (
    <FloatingPanel title="Layers & regions" icon={Layers} width={240} {...chrome}>
      <div className="space-y-2 p-3">
        <Section title="Sea">
          <Row
            icon={Route}
            label="Vessels"
            hint="Show or hide the live vessel picture (AIS)."
            checked={showVessels}
            onChange={onToggleVessels}
          />
          {/* Trails temporarily parked — the toggle spot now shows/hides vessels.
              Re-enable by restoring this row (state + plumbing are all intact):
          <Row icon={Route} label="Vessel trails" checked={showTrails} onChange={onToggleTrails} />
          */}
          <Row
            icon={Flame}
            label="Density heatmap"
            hint="Shipping-lane density. Also appears automatically when you zoom out."
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
              checked={showWaves}
              onChange={onToggleWaves}
            />
          )}
        </Section>

        {airAvailable && (
          <Section title="Air">
            <Row
              icon={Plane}
              label="Air traffic (ADS-B)"
              hint="Live aircraft over the region, coloured by altitude."
              checked={showAir}
              onChange={onToggleAir}
            />
          </Section>
        )}

        {fireAvailable && (
          <Section title="Fire">
            <Row
              icon={Flame}
              label="Wildfires (NASA FIRMS)"
              hint="Live satellite fire detections over Iberia & France, glowing by intensity (fire radiative power). Near-real-time from VIIRS."
              checked={showFire}
              onChange={onToggleFire}
            />
          </Section>
        )}

        {(busAvailable || camerasAvailable || trainAvailable || tubeAvailable) && (
          <Section title="Land">
            {onEnterArgusLondon && (
              <button
                onClick={onEnterArgusLondon}
                className="mb-1 flex w-full items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <Eye className="h-3.5 w-3.5" />
                Argus London — focus the city
              </button>
            )}
            {incidentsAvailable && onToggleIncidents && (
              <Row
                icon={TriangleAlert}
                label="Incidents"
                hint="Live located incidents — road collisions, hazards, closures. Click one to see detail and turn nearby cameras on it."
                checked={!!showIncidents}
                onChange={onToggleIncidents}
              />
            )}
            {busAvailable && (
              <Row
                icon={Bus}
                label="Buses (London)"
                hint="Live TfL buses — zoom into London, then click one to follow it."
                checked={showBus}
                onChange={onToggleBus}
              />
            )}
            {tubeAvailable && (
              <Row
                icon={TramFront}
                label="London Underground"
                hint="The tube network as light: official line colours, live status, and every train inferred from TfL arrivals."
                checked={showTube}
                onChange={onToggleTube}
              />
            )}
            {trainAvailable && (
              <Row
                icon={TrainFront}
                label="Trains (GB · beta)"
                hint="Live GB rail via Darwin. Click a station for its live departure board."
                checked={showTrain}
                onChange={onToggleTrain}
              />
            )}
            {trainAvailable && showTrain && onOpenRailPulse && (
              // Indented under the Trains label as its drill-in sub-action.
              <button
                onClick={onOpenRailPulse}
                className="ml-6 flex items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Activity className="h-3.5 w-3.5 text-primary/80" />
                State of the Railway
              </button>
            )}
            {onOpenLondon && (tubeAvailable || busAvailable || trainAvailable) && (
              <button
                onClick={onOpenLondon}
                className="ml-6 flex items-center gap-2 rounded-md px-2 py-1 text-xs text-foreground/75 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <Landmark className="h-3.5 w-3.5 text-primary/80" />
                London transport
              </button>
            )}
            {trainAvailable && showTrain && onToggleHotspots && (
              <button
                onClick={onToggleHotspots}
                className={cn(
                  "ml-6 flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                  showHotspots
                    ? "bg-orange-500/15 text-orange-300"
                    : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                <Flame className={cn("h-3.5 w-3.5", showHotspots ? "text-orange-400" : "text-orange-400/70")} />
                Delay hotspots
              </button>
            )}
            {camerasAvailable && (
              <>
                <Row
                  icon={Cctv}
                  label="Traffic cameras"
                  hint="Live TfL junction cameras — zoom into London, then click one."
                  checked={showCameras}
                  onChange={onToggleCameras}
                />
                <button
                  onClick={onOpenWall}
                  className="!mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-foreground/10 bg-foreground/5 px-2 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Camera wall{wallCount > 0 ? ` (${wallCount})` : ""}
                </button>
              </>
            )}
          </Section>
        )}

        <Section title="View">
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
        </Section>

        <Section title="Jump to region" defaultOpen={false}>
          <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground/50">
            <Navigation className="h-3 w-3" />
            Fly the map to a coverage area
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {REGIONS.map((r) => (
              <Button
                key={r.label}
                variant="outline"
                size="sm"
                className="h-7 justify-start truncate text-[11px]"
                onClick={() => onJump(r.target)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </Section>
      </div>
    </FloatingPanel>
  );
}
