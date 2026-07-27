/**
 * The wildfire rail — active fires ranked by intensity (fire radiative power),
 * each with its trend and where the wind is driving it. Click one to fly to it
 * and open its detail card. Fed by NASA FIRMS clustering.
 */
import { Flame, Wind, ChevronRight, Factory } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { FireComplex } from "@/types";
import { FireDetail } from "./FireCard";

const STATUS: Record<string, { label: string; cls: string }> = {
  spreading: { label: "spreading", cls: "border-rose-500/40 text-rose-400" },
  active: { label: "active", cls: "border-orange-500/40 text-orange-400" },
  easing: { label: "easing", cls: "border-sky-500/40 text-sky-400" },
  cooling: { label: "cooling", cls: "border-foreground/20 text-muted-foreground" },
};

/** FRP → heat colour for the intensity bar (deep ember → white-hot). */
function frpColor(frp: number): string {
  if (frp >= 5000) return "#fff0cf";
  if (frp >= 1500) return "#fbbf24";
  if (frp >= 400) return "#f97316";
  if (frp >= 100) return "#ef4444";
  return "#b91c1c";
}

export function fmtFrp(mw: number): string {
  return mw >= 1000 ? `${(mw / 1000).toFixed(1)}k` : `${Math.round(mw)}`;
}

export function WildfiresPanel({
  chrome,
  complexes,
  selected,
  onSelect,
  onBack,
}: {
  chrome: PanelChrome;
  complexes: FireComplex[];
  selected: FireComplex | null;
  onSelect: (f: FireComplex) => void;
  onBack: () => void;
}) {
  // Real fires first (by intensity), then suspected industrial/persistent heat
  // sources — which are labelled, not counted as fires.
  const wildfires = complexes.filter((c) => c.kind !== "industrial");
  const industrial = complexes.filter((c) => c.kind === "industrial");
  const ordered = [...wildfires, ...industrial];
  const spreading = wildfires.filter((c) => c.status === "spreading").length;
  // Intensity bar is scaled against the fiercest fire in view.
  const maxFrp = complexes.reduce((m, c) => Math.max(m, c.total_frp), 1);

  // Master–detail in one panel: a selected fire shows its detail, else the list.
  if (selected) {
    return (
      <FloatingPanel title="Wildfires" icon={Flame} width={320} {...chrome}>
        <FireDetail fire={selected} onBack={onBack} />
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel title="Wildfires" icon={Flame} width={320} {...chrome}>
      <div className="p-1.5">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            NASA FIRMS · live
          </span>
          <span className="text-[11px] text-muted-foreground">
            {wildfires.length} fires{spreading > 0 && ` · ${spreading} spreading`}
          </span>
        </div>

        {complexes.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            No active fires detected in view.
          </div>
        ) : (
          <div className="lg:max-h-[58vh] lg:overflow-y-auto">
            {ordered.map((c) => {
              const industrialRow = c.kind === "industrial";
              const st = STATUS[c.status] ?? STATUS.active;
              const name = c.place ?? `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`;
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/5",
                    industrialRow && "opacity-75",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {industrialRow ? (
                        <Factory className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      ) : (
                        c.flag && <span className="text-xs">{c.flag}</span>
                      )}
                      <span className="truncate text-sm font-medium">{name}</span>
                    </span>
                    {/* intensity bar */}
                    <span className="mt-1 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.max(6, (c.total_frp / maxFrp) * 100)}%`,
                            background: industrialRow ? "#64748b" : frpColor(c.total_frp),
                          }}
                        />
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtFrp(c.total_frp)} MW
                      </span>
                    </span>
                    {!industrialRow && c.spread_compass && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] text-sky-400/80">
                        <Wind className="h-3 w-3" />
                        {c.spread_compass}
                        {c.downwind_place && (
                          <span className="truncate text-muted-foreground">
                            {" "}→ {c.downwind_place}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "rounded border px-1 py-0 text-[9px] font-medium",
                        industrialRow ? "border-slate-500/40 text-slate-400" : st.cls,
                      )}
                    >
                      {industrialRow ? "industrial" : st.label}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
