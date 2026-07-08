/**
 * London transport pulse — one live cross-modal read: tube + rail + bus fused.
 * The seed of the "Argus London" view; nobody tracks all three live at once.
 */
import { Landmark, TrainFront, TramFront, Bus } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { LondonPulse as Pulse } from "@/hooks/useLondonPulse";

function healthColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  return "text-rose-400";
}

export function LondonPulse({ chrome, pulse }: { chrome: PanelChrome; pulse: Pulse | null }) {
  return (
    <FloatingPanel title="London transport" icon={Landmark} width={320} {...chrome}>
      <div className="space-y-3 p-3">
        {pulse == null ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
        ) : (
          <>
            {pulse.health != null && (
              <div className="flex items-end gap-3">
                <div className={cn("text-4xl font-bold tabular-nums leading-none", healthColor(pulse.health))}>
                  {pulse.health}%
                </div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  network health
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {pulse.tube && (
                <div className="flex items-center gap-2.5 rounded-lg bg-foreground/5 px-2.5 py-2">
                  <TramFront className="h-4 w-4 shrink-0 text-sky-400" />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block">{pulse.tube.trains} tube trains · {pulse.tube.moving} on the move</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {pulse.tube.lines_good}/{pulse.tube.lines_total} lines good service
                      {pulse.tube.disrupted.length > 0 && ` · delays on ${pulse.tube.disrupted.join(", ")}`}
                    </span>
                  </span>
                </div>
              )}
              {pulse.rail && (
                <div className="flex items-center gap-2.5 rounded-lg bg-foreground/5 px-2.5 py-2">
                  <TrainFront className="h-4 w-4 shrink-0 text-rose-400" />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block">{pulse.rail.count} rail services in London</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {pulse.rail.on_time_pct != null ? `${pulse.rail.on_time_pct}% on time · ${pulse.rail.late} late` : "—"}
                    </span>
                  </span>
                </div>
              )}
              {pulse.bus && (
                <div className="flex items-center gap-2.5 rounded-lg bg-foreground/5 px-2.5 py-2">
                  <Bus className="h-4 w-4 shrink-0 text-[#e22d26]" />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block">{pulse.bus.count.toLocaleString()} buses running</span>
                    <span className="block text-[10px] text-muted-foreground">across Greater London</span>
                  </span>
                </div>
              )}
            </div>

            <p className="border-t border-foreground/10 pt-2 text-[10px] leading-snug text-muted-foreground/70">
              Live · health blends tube line status and London rail punctuality.
            </p>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
