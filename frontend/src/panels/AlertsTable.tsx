import { type ComponentType } from "react";
import {
  Radar,
  Zap,
  LogIn,
  LogOut,
  Clock,
  Gauge,
  EyeOff,
  Crosshair,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mmsiCountry } from "@/lib/flags";
import type { Alert } from "@/types";

const KIND_META: Record<
  string,
  { label: string; cls: string; Icon: ComponentType<{ className?: string }> }
> = {
  rendezvous: { label: "STS rendezvous", cls: "bg-amber-500/15 text-amber-400", Icon: Radar },
  spoof: { label: "AIS spoof", cls: "bg-rose-500/15 text-rose-400", Icon: Zap },
  enter: { label: "Zone enter", cls: "bg-sky-500/15 text-sky-300", Icon: LogIn },
  exit: { label: "Zone exit", cls: "bg-slate-500/20 text-slate-300", Icon: LogOut },
  dwell: { label: "Dwell", cls: "bg-violet-500/15 text-violet-300", Icon: Clock },
  speed: { label: "Speeding", cls: "bg-orange-500/15 text-orange-300", Icon: Gauge },
  dark: { label: "Went dark", cls: "bg-rose-500/15 text-rose-400", Icon: EyeOff },
};

const COLS = "92px 150px minmax(140px,1fr) minmax(160px,1.5fr) 40px";

function timeAgo(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function summary(a: Alert): string {
  const d = a.detail || {};
  if (a.kind === "rendezvous") {
    const who = a.name_b || (a.mmsi_b ? `MMSI ${a.mmsi_b}` : "another vessel");
    const bits = [`with ${who}`];
    if (d.dist_nm != null) bits.push(`${d.dist_nm} nm apart`);
    if (d.duration_min != null) bits.push(`${d.duration_min} min`);
    return bits.join(" · ");
  }
  if (a.kind === "spoof") {
    const bits = [];
    if (d.implied_kn != null) bits.push(`${d.implied_kn} kn jump`);
    if (d.jump_nm != null && d.gap_sec != null) bits.push(`${d.jump_nm} nm in ${d.gap_sec}s`);
    return bits.join(" · ") || "impossible movement";
  }
  // geofence
  const bits = [];
  if (a.fence_name) bits.push(a.fence_name);
  if (d.sog != null) bits.push(`${d.sog} kn`);
  return bits.join(" · ") || a.title || "";
}

export function AlertsTable({
  alerts,
  total,
  loading,
  hasMore,
  onLoadMore,
  onSelect,
}: {
  alerts: Alert[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (a: Alert) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div
        className="grid shrink-0 items-center border-b border-foreground/10 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: COLS }}
      >
        <span className="px-2">When</span>
        <span className="px-2">Event</span>
        <span className="px-2">Vessel</span>
        <span className="px-2">Details</span>
        <span />
      </div>

      <div className="panel-scroll flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="grid h-24 place-items-center gap-2 text-sm text-muted-foreground">
            {loading ? (
              "Loading alerts…"
            ) : (
              <span className="flex flex-col items-center gap-2">
                <Bell className="h-5 w-5 opacity-40" />
                No alerts recorded yet.
              </span>
            )}
          </div>
        ) : (
          <>
            {alerts.map((a) => {
              const meta = KIND_META[a.kind] ?? {
                label: a.kind,
                cls: "bg-foreground/10 text-foreground/70",
                Icon: Bell,
              };
              const country = a.mmsi ? mmsiCountry(a.mmsi) : null;
              return (
                <button
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className="group grid w-full items-center border-b border-foreground/5 py-1.5 text-left transition-colors hover:bg-foreground/[0.06]"
                  style={{ gridTemplateColumns: COLS }}
                >
                  <span
                    className="px-2 text-[11px] tabular-nums text-muted-foreground"
                    title={new Date(a.ts * 1000).toLocaleString()}
                  >
                    {timeAgo(a.ts)}
                  </span>
                  <span className="px-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        meta.cls,
                      )}
                    >
                      <meta.Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </span>
                  <span className="truncate px-2 text-xs">
                    {country && <span className="mr-1">{country.flag}</span>}
                    <span className="font-medium text-foreground/90">
                      {a.name?.trim() || (a.mmsi ? `MMSI ${a.mmsi}` : "—")}
                    </span>
                  </span>
                  <span className="truncate px-2 text-xs text-muted-foreground">
                    {summary(a)}
                  </span>
                  <span className="grid place-items-center">
                    <Crosshair className="h-3.5 w-3.5 text-muted-foreground/30 transition-colors group-hover:text-primary" />
                  </span>
                </button>
              );
            })}
            <div className="grid place-items-center py-2 text-[11px] text-muted-foreground">
              {hasMore ? (
                <button
                  onClick={onLoadMore}
                  className="rounded-md px-3 py-1 text-primary transition-colors hover:bg-foreground/5"
                >
                  Load more ({alerts.length} of {total})
                </button>
              ) : (
                <span>
                  {total} alert{total === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
