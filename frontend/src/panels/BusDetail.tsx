import { useEffect, useState, type ReactNode } from "react";
import {
  Bus,
  Navigation2,
  MapPin,
  Clock,
  Building2,
  Flag,
  Crosshair,
  LocateFixed,
  Cctv,
  Eye,
  LayoutGrid,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { TrackedBus, Camera } from "@/types";
import type { NearbyCamera } from "@/lib/nearbyCameras";

interface BusDetailProps {
  chrome: PanelChrome;
  bus: TrackedBus;
  following: boolean;
  onToggleFollow: () => void;
  onZoomTo: () => void;
  nearby: NearbyCamera[];
  nextId: string | null;
  onOpenCamera: (c: Camera) => void;
  onWatchNearby: () => void;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function compass(deg: number | null): string {
  if (deg == null) return "—";
  return COMPASS[Math.round(deg / 45) % 8];
}

export function BusDetail({
  chrome,
  bus: b,
  following,
  onToggleFollow,
  onZoomTo,
  nearby,
  nextId,
  onOpenCamera,
  onWatchNearby,
}: BusDetailProps) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, now - b.ts);
  const isTfl = b.operator === "TFLO";

  return (
    <FloatingPanel title={b.route ? `Route ${b.route}` : "Bus"} icon={Bus} width={340} {...chrome}>
      <div className="space-y-3 p-4">
        {/* Identity */}
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md px-1 text-xs font-bold text-white"
            style={{ background: isTfl ? "#e22d26" : "#f59e0b" }}
          >
            {b.route ?? "?"}
          </span>
          {b.destination && (
            <span className="flex items-center gap-1 truncate text-sm">
              <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {b.destination}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted" className="gap-1">
            <Building2 className="h-3 w-3" />
            {isTfl ? "Transport for London" : (b.operator ?? "Operator")}
          </Badge>
        </div>

        {/* Follow */}
        <button
          onClick={onToggleFollow}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            following
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-foreground/10 bg-foreground/5 text-foreground/80 hover:bg-foreground/10",
          )}
        >
          <LocateFixed className="h-4 w-4" />
          {following ? "Following — keeping in view" : "Follow this bus"}
        </button>

        <Separator />

        <div className="grid grid-cols-2 gap-2">
          <Field icon={<Navigation2 />} label="Heading" value={compass(b.bearing)} />
          <Field
            icon={<Navigation2 />}
            label="Bearing"
            value={b.bearing != null ? `${Math.round(b.bearing)}°` : "—"}
          />
          <Field icon={<Clock />} label="Updated" value={fmtAge(ageSec)} />
          <div className="flex items-end justify-end">
            <Hint label="Zoom to bus" side="top">
              <button
                aria-label="Zoom to bus"
                onClick={onZoomTo}
                className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <Crosshair className="h-4 w-4" />
              </button>
            </Hint>
          </div>
        </div>

        {/* Bus → camera fusion: the feeds nearest this bus right now. */}
        {nearby.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Cctv className="h-3 w-3" />
                  Nearby cameras
                </span>
                <span className="tabular-nums text-muted-foreground/70">{nearby.length}</span>
              </div>
              <div className="space-y-1">
                {nearby.slice(0, 5).map(({ camera, distM, facing }) => {
                  const next = camera.id === nextId;
                  return (
                    <button
                      key={camera.id}
                      onClick={() => onOpenCamera(camera)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors",
                        next
                          ? "border-cyan-400/50 bg-cyan-400/10 hover:bg-cyan-400/15"
                          : "border-foreground/5 bg-foreground/5 hover:bg-foreground/10",
                      )}
                    >
                      {facing ? (
                        <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />
                      ) : (
                        <Cctv className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{camera.name}</span>
                      {next && (
                        <span className="shrink-0 rounded-full bg-cyan-400 px-1.5 text-[9px] font-bold uppercase text-black">
                          Next
                        </span>
                      )}
                      <span className="shrink-0 tabular-nums text-muted-foreground/70">
                        {Math.round(distM)} m
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                    </button>
                  );
                })}
              </div>
              <button
                onClick={onWatchNearby}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Watch {nearby.length} nearby on a wall
              </button>
            </div>
          </>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            Position
          </span>
          <span className="font-mono">
            {b.lat?.toFixed(4)}, {b.lon?.toFixed(4)}
          </span>
        </div>
      </div>
    </FloatingPanel>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-foreground/5 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
