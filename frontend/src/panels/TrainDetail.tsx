/**
 * Train detail panel (rail domain, Tier-1). Identity + delay, then the full
 * calling pattern with the next stop highlighted. Positions are inferred, so
 * the panel says so — and the prototype's simulated feed is clearly badged.
 */
import { TrainFront, Clock, MapPin, FlaskConical } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TrackedTrain } from "@/types";

function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TrainDetail({
  chrome,
  train,
  onZoomTo,
}: {
  chrome: PanelChrome;
  train: TrackedTrain;
  onZoomTo: () => void;
}) {
  const late = train.delay_min ?? 0;
  const now = Date.now() / 1000;
  const nextIdx = train.stops.findIndex((s) => s.t > now);

  return (
    <FloatingPanel title="Train" icon={TrainFront} width={340} {...chrome}>
      <div className="space-y-3 p-3">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight">
                {train.headcode ?? train.id}
              </span>
              {train.operator && (
                <Badge variant="muted" className="shrink-0">{train.operator}</Badge>
              )}
              {train.sim && (
                <Badge
                  variant="outline"
                  className="shrink-0 gap-1 border-amber-500/40 text-amber-500"
                  title="Simulated service — the Tier-1 prototype feed. Real data arrives with Darwin credentials."
                >
                  <FlaskConical className="h-3 w-3" />
                  SIM
                </Badge>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {train.origin} → {train.destination}
            </div>
          </div>
          <button
            onClick={onZoomTo}
            title="Zoom to train"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <MapPin className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {late >= 1 ? (
            <span className={cn("font-medium", late >= 5 ? "text-rose-400" : "text-amber-400")}>
              Running {Math.round(late)} min late
            </span>
          ) : (
            <span className="font-medium text-emerald-400">On time</span>
          )}
          {train.next_name && (
            <span className="ml-auto truncate text-muted-foreground">
              Next: <span className="text-foreground/90">{train.next_name}</span>
            </span>
          )}
        </div>

        {/* Calling pattern */}
        <div className="space-y-0">
          {train.stops.map((s, i) => {
            const passed = nextIdx === -1 || i < nextIdx;
            const isNext = i === nextIdx;
            return (
              <div key={`${s.crs}-${i}`} className="flex items-center gap-2.5 py-1">
                <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                  {i > 0 && (
                    <span className="absolute -top-2.5 h-2.5 w-px bg-foreground/15" />
                  )}
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      isNext
                        ? "bg-sky-400 ring-4 ring-sky-400/20"
                        : passed
                          ? "bg-foreground/25"
                          : "border border-foreground/40",
                    )}
                  />
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs",
                    isNext ? "font-medium text-foreground" : passed ? "text-muted-foreground/60" : "text-foreground/85",
                  )}
                >
                  {s.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[11px] tabular-nums",
                    isNext ? "text-sky-400" : "text-muted-foreground/70",
                  )}
                >
                  {hhmm(s.t)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="border-t border-foreground/10 pt-2 text-[10px] leading-snug text-muted-foreground/70">
          Position inferred between calling points (straight-line) — indicative,
          not signalling-grade.
        </p>
      </div>
    </FloatingPanel>
  );
}
