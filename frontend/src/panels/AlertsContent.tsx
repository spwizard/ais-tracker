import { Activity, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToastAlert } from "@/panels/AlertToasts";

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const RISK_KINDS = new Set(["rendezvous", "spoof", "dark", "speed"]);

/** Recent-events list for the island dropdown. Content only. */
export function AlertsContent({
  alerts,
  onSelect,
  onSeeAll,
}: {
  alerts: ToastAlert[];
  onSelect: (a: { mmsi: number; lat: number; lon: number }) => void;
  onSeeAll: () => void;
}) {
  const recent = alerts.slice(0, 8);
  return (
    <div className="p-1.5">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Recent events
        </span>
        <button onClick={onSeeAll} className="text-[11px] font-medium text-primary hover:underline">
          See all
        </button>
      </div>

      {recent.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-muted-foreground">No events yet.</div>
      ) : (
        <div className="max-h-[56vh] overflow-y-auto">
          {recent.map((a) => (
            <button
              key={a.key}
              onClick={() => onSelect({ mmsi: a.mmsi, lat: a.lat, lon: a.lon })}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
                <Activity
                  className={cn("h-3.5 w-3.5", RISK_KINDS.has(a.kind) ? "text-rose-400" : "text-sky-400")}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-tight">{a.title}</span>
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                  {a.subtitle}
                </span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{ago(a.ts)}</span>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/30" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
