import { Activity, Gauge, Anchor } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import type { TrackedVessel } from "@/types";

interface StatsPanelProps {
  chrome: PanelChrome;
  vessels: TrackedVessel[]; // full (unfiltered) set
  countsByGroup: Record<string, number>;
}

export function StatsPanel({ chrome, vessels, countsByGroup }: StatsPanelProps) {
  const total = vessels.length || 1;
  let moving = 0;
  let speedSum = 0;
  for (const v of vessels) {
    if ((v.sog ?? 0) > 0.5) {
      moving += 1;
      speedSum += v.sog ?? 0;
    }
  }
  const avgSpeed = moving ? speedSum / moving : 0;
  const maxGroupCount = Math.max(1, ...Object.values(countsByGroup));

  return (
    <FloatingPanel title="Live statistics" icon={Activity} width={256} {...chrome}>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Avg speed"
            value={`${avgSpeed.toFixed(1)} kn`}
          />
          <Stat
            icon={<Anchor className="h-3.5 w-3.5" />}
            label="Moving"
            value={`${Math.round((moving / total) * 100)}%`}
          />
        </div>

        <div className="space-y-1.5">
          {SHIP_TYPE_GROUPS.map((g) => {
            const count = countsByGroup[g.key] ?? 0;
            return (
              <div key={g.key} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: g.color }}
                    />
                    {g.label}
                  </span>
                  <span className="tabular-nums text-foreground">{count}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-foreground/5">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(count / maxGroupCount) * 100}%`,
                      background: g.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FloatingPanel>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-foreground/5 p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
