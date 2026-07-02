import { Layers, Route, Navigation, Flame, Wind, Waves, History, Loader2, Mountain, Plane, Cctv } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import type { ViewTarget } from "@/map/MapView";

interface LayerControlsProps {
  chrome: PanelChrome;
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
  showCameras: boolean;
  onToggleCameras: (v: boolean) => void;
  camerasAvailable: boolean;
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
  // Digitraffic (Fintraffic) coverage — Finnish / Baltic waters.
  { label: "Gulf of Finland", target: { longitude: 25.0, latitude: 59.8, zoom: 7 } },
  // Kystverket coverage — Norwegian coast.
  { label: "Norway (Skagerrak)", target: { longitude: 10.5, latitude: 59.2, zoom: 7 } },
];

export function LayerControls({
  chrome,
  showTrails,
  onToggleTrails,
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
  showCameras,
  onToggleCameras,
  camerasAvailable,
  replayMode,
  onToggleReplay,
  replayAvailable,
  replayLoading,
  cinematic,
  onToggleCinematic,
  onJump,
}: LayerControlsProps) {
  return (
    <FloatingPanel title="Layers & regions" icon={Layers} width={240} {...chrome}>
      <div className="space-y-3 p-3">
        <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Route className="h-4 w-4 text-muted-foreground" />
            Vessel trails
          </span>
          <Switch checked={showTrails} onCheckedChange={onToggleTrails} />
        </label>

        <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Flame className="h-4 w-4 text-muted-foreground" />
            Density heatmap
          </span>
          <Switch checked={densityMode} onCheckedChange={onToggleDensity} />
        </label>
        <p className="px-1 text-[10px] leading-snug text-muted-foreground/60">
          Shows shipping-lane density. Also appears automatically when you zoom out.
        </p>

        {windAvailable && (
          <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
            <span className="flex items-center gap-2 text-sm">
              <Wind className="h-4 w-4 text-muted-foreground" />
              Wind (GFS)
            </span>
            <Switch checked={showWind} onCheckedChange={onToggleWind} />
          </label>
        )}

        {wavesAvailable && (
          <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
            <span className="flex items-center gap-2 text-sm">
              <Waves className="h-4 w-4 text-muted-foreground" />
              Sea state (GFS-Wave)
            </span>
            <Switch checked={showWaves} onCheckedChange={onToggleWaves} />
          </label>
        )}

        {airAvailable && (
          <>
            <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
              <span className="flex items-center gap-2 text-sm">
                <Plane className="h-4 w-4 text-muted-foreground" />
                Air traffic (ADS-B)
              </span>
              <Switch checked={showAir} onCheckedChange={onToggleAir} />
            </label>
            <p className="px-1 text-[10px] leading-snug text-muted-foreground/60">
              Live aircraft over the region, coloured by altitude.
            </p>
          </>
        )}

        {camerasAvailable && (
          <>
            <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
              <span className="flex items-center gap-2 text-sm">
                <Cctv className="h-4 w-4 text-muted-foreground" />
                Traffic cameras (London)
              </span>
              <Switch checked={showCameras} onCheckedChange={onToggleCameras} />
            </label>
            <p className="px-1 text-[10px] leading-snug text-muted-foreground/60">
              Live TfL junction cameras — zoom into London, then click one.
            </p>
          </>
        )}

        <Separator />
        <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
          <span className="flex items-center gap-2 text-sm">
            <Mountain className="h-4 w-4 text-muted-foreground" />
            Cinematic coast (3D)
          </span>
          <Switch checked={cinematic} onCheckedChange={onToggleCinematic} />
        </label>
        <p className="px-1 text-[10px] leading-snug text-muted-foreground/60">
          Photoreal 3D terrain + buildings, tilted to the horizon.
        </p>

        {replayAvailable && (
          <>
            <Separator />
            <label className="flex cursor-pointer items-center justify-between rounded-md px-1 py-1">
              <span className="flex items-center gap-2 text-sm">
                <History className="h-4 w-4 text-muted-foreground" />
                Movement replay
              </span>
              <Switch checked={replayMode} onCheckedChange={onToggleReplay} />
            </label>
            <p className="px-1 text-[10px] leading-snug text-muted-foreground/60">
              Scrub recent vessel tracks in view through time. Pauses the live feed.
            </p>
            {replayMode && replayLoading && (
              <div className="flex items-center gap-2 px-1 text-[11px] text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading tracks…
              </div>
            )}
          </>
        )}

        <Separator />

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Navigation className="h-3 w-3" />
            Jump to region
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
        </div>
      </div>
    </FloatingPanel>
  );
}
