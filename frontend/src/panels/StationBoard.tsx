/**
 * Live station departure board — the classic under-the-clock Departures
 * screen, generated from our own Darwin picture. Rows click through to the
 * train on the map. Refreshes every 30s while open (see useStationBoard).
 */
import { TrainFront, RadioTower } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RailBoard } from "@/types";

function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Expected({ delay }: { delay: number }) {
  if (delay >= 5)
    return <span className="text-[11px] font-semibold tabular-nums text-rose-400">+{delay} min</span>;
  if (delay >= 1)
    return <span className="text-[11px] font-semibold tabular-nums text-amber-400">+{delay} min</span>;
  if (delay <= -1)
    return <span className="text-[11px] font-medium tabular-nums text-sky-400">{delay} min</span>;
  return <span className="text-[11px] font-medium text-emerald-400">On time</span>;
}

export function StationBoard({
  chrome,
  stationQuery,
  board,
  onSelectService,
}: {
  chrome: PanelChrome;
  stationQuery: string;
  board: RailBoard | null;
  onSelectService: (id: string) => void;
}) {
  return (
    <FloatingPanel title="Departures" icon={RadioTower} width={340} {...chrome}>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight">
            {board?.station ?? stationQuery}
          </span>
          {board?.crs && <Badge variant="muted" className="shrink-0">{board.crs}</Badge>}
          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            live
          </span>
        </div>

        {board == null ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading board…</div>
        ) : board.services.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No upcoming services in the live picture.
          </div>
        ) : (
          <div className="space-y-0.5">
            {board.services.map((s) => (
              <button
                key={`${s.id}-${s.t}`}
                onClick={() => onSelectService(s.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5"
                title="Show this train on the map"
              >
                <span className="w-11 shrink-0 text-sm font-semibold tabular-nums">
                  {hhmm(s.t)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-tight">{s.to ?? "—"}</span>
                  <span
                    className={cn(
                      "block truncate text-[11px] leading-tight text-muted-foreground",
                    )}
                  >
                    from {s.from ?? "—"}
                  </span>
                </span>
                <Expected delay={s.delay_min} />
                <TrainFront className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              </button>
            ))}
          </div>
        )}

        <p className="mt-2 border-t border-foreground/10 pt-2 text-[10px] leading-snug text-muted-foreground/70">
          Built live from the national Darwin feed — times are predictions, and
          only services currently tracked appear.
        </p>
      </div>
    </FloatingPanel>
  );
}
