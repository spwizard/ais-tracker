/**
 * "State of the Railway" — live national punctuality, an AI headline, and a
 * per-operator league table, all from our own Darwin picture.
 */
import { Activity, TrendingUp, TrendingDown, Minus, Sparkles, Clock, Gauge } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { RailPulse as Pulse } from "@/hooks/useRailPulse";

/** Tiny inline punctuality sparkline over the last ~30 samples. */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 300;
  const h = 28;
  const lo = Math.min(...data) - 2;
  const hi = Math.max(...data) + 2;
  const span = Math.max(hi - lo, 1);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - lo) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = data[data.length - 1];
  const lastX = w;
  const lastY = h - ((last - lo) / span) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="rgb(56,150,255)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="rgb(56,150,255)" />
    </svg>
  );
}

function punctualityColor(pct: number): string {
  if (pct >= 85) return "text-emerald-400";
  if (pct >= 70) return "text-amber-400";
  return "text-rose-400";
}

function Trend({ t }: { t: number }) {
  if (t >= 2)
    return (
      <span className="flex items-center gap-0.5 text-emerald-400">
        <TrendingUp className="h-3.5 w-3.5" /> improving
      </span>
    );
  if (t <= -2)
    return (
      <span className="flex items-center gap-0.5 text-rose-400">
        <TrendingDown className="h-3.5 w-3.5" /> worsening
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" /> steady
    </span>
  );
}

export function RailPulse({
  chrome,
  pulse,
  onSelectTrain,
}: {
  chrome: PanelChrome;
  pulse: Pulse | null;
  onSelectTrain?: (id: string) => void;
}) {
  return (
    <FloatingPanel title="State of the Railway" icon={Activity} width={340} {...chrome}>
      <div className="space-y-3 p-3">
        {pulse == null || pulse.total === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Waiting for the live rail picture…
          </div>
        ) : (
          <>
            {/* Headline punctuality */}
            <div className="flex items-end gap-3">
              <div>
                <div className={cn("text-4xl font-bold tabular-nums leading-none", punctualityColor(pulse.on_time_pct ?? 0))}>
                  {pulse.on_time_pct}%
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  on time (within 5 min)
                </div>
              </div>
              <div className="ml-auto text-right text-[11px] text-muted-foreground">
                <div className="tabular-nums text-sm text-foreground/90">{pulse.total} services</div>
                {pulse.trend != null && <Trend t={pulse.trend} />}
              </div>
            </div>

            {/* Punctuality trend, last ~30 min */}
            {pulse.history && pulse.history.length >= 2 && (
              <div>
                <Sparkline data={pulse.history} />
                <div className="-mt-0.5 text-[10px] text-muted-foreground/70">
                  punctuality · last {pulse.history.length} min
                </div>
              </div>
            )}

            {/* AI narrative */}
            {pulse.narrative && (
              <div className="flex items-start gap-2 rounded-lg bg-primary/5 px-2.5 py-2 text-[12px] leading-snug text-foreground/85">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span>{pulse.narrative}</span>
              </div>
            )}

            {/* Spread */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-foreground/5 py-1.5">
                <div className="text-sm font-semibold tabular-nums text-amber-400">{pulse.late}</div>
                <div className="text-[10px] text-muted-foreground">running late</div>
              </div>
              <div className="rounded-lg bg-foreground/5 py-1.5">
                <div className="text-sm font-semibold tabular-nums text-rose-400">{pulse.bad}</div>
                <div className="text-[10px] text-muted-foreground">5+ min down</div>
              </div>
              <div className="rounded-lg bg-foreground/5 py-1.5">
                <div className="text-sm font-semibold tabular-nums">{pulse.avg_delay}</div>
                <div className="text-[10px] text-muted-foreground">avg delay (min)</div>
              </div>
            </div>

            {/* Extremes — worst + fastest right now, click to fly to it */}
            {(pulse.worst || pulse.fastest) && (
              <div className="space-y-1">
                {pulse.worst && (
                  <button
                    onClick={() => onSelectTrain?.(pulse.worst!.id)}
                    className="flex w-full items-center gap-2 rounded-lg bg-foreground/5 px-2 py-1.5 text-left transition-colors hover:bg-foreground/10"
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{pulse.worst.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        most delayed{pulse.worst.next ? ` · near ${pulse.worst.next}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-rose-400">
                      +{pulse.worst.delay_min}m
                    </span>
                  </button>
                )}
                {pulse.fastest && (
                  <button
                    onClick={() => onSelectTrain?.(pulse.fastest!.id)}
                    className="flex w-full items-center gap-2 rounded-lg bg-foreground/5 px-2 py-1.5 text-left transition-colors hover:bg-foreground/10"
                  >
                    <Gauge className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs">{pulse.fastest.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        fastest right now{pulse.fastest.next ? ` · to ${pulse.fastest.next}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-sky-400">
                      {pulse.fastest.mph} mph
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Operator league table */}
            {pulse.operators.length > 0 ? (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  By operator · worst first
                </div>
                <div className="space-y-0.5">
                  {pulse.operators.slice(0, 8).map((o) => (
                    <div key={o.name} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {o.count}
                      </span>
                      <span className={cn("w-9 shrink-0 text-right font-semibold tabular-nums", punctualityColor(o.on_time_pct))}>
                        {o.on_time_pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-[10px] leading-snug text-muted-foreground/70">
                Operator breakdown builds as schedule data flows (or instantly
                once the Timetable Files feed is wired).
              </p>
            )}
          </>
        )}
      </div>
    </FloatingPanel>
  );
}
