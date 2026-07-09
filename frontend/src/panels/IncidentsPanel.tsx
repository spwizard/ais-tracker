/**
 * The incident rail — a live list of everything Argus is watching in London,
 * across all eyes (official road feed + inference). Sorted worst/most-recent
 * first; click one to fly to it and open its card.
 */
import { useState } from "react";
import {
  TriangleAlert, Car, Wrench, AlertOctagon, Clock, Plane, Grip, Landmark, ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import { incidentTier, type Incident, type IncidentTier } from "@/types";

const TIER_META: Record<IncidentTier, { label: string; cls: string }> = {
  confirmed: { label: "confirmed", cls: "border-emerald-500/40 text-emerald-400" },
  reported: { label: "reported", cls: "border-sky-500/40 text-sky-400" },
  official: { label: "official", cls: "border-foreground/20 text-muted-foreground" },
  suspected: { label: "suspected", cls: "border-amber-500/40 text-amber-400" },
  cleared: { label: "cleared", cls: "border-foreground/20 text-muted-foreground" },
};

const CAT_ICON: Record<string, LucideIcon> = {
  collision: Car,
  breakdown: Wrench,
  hazard: AlertOctagon,
  delay: Clock,
  works: Wrench,
  event: TriangleAlert,
  aerial: Plane,
  congestion: Grip,
  other: TriangleAlert,
};
const SEV_COLOR: Record<string, string> = {
  serious: "text-rose-400",
  moderate: "text-orange-400",
  minor: "text-amber-400",
};
const SEV_RANK: Record<string, number> = { serious: 0, moderate: 1, minor: 2 };

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const TIER_RANK: Record<IncidentTier, number> = { confirmed: 0, reported: 1, official: 2, suspected: 3, cleared: 4 };

// Within a group: severity leads, then credibility, then recency.
function byPriority(a: Incident, b: Incident): number {
  return (
    (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) ||
    TIER_RANK[incidentTier(a)] - TIER_RANK[incidentTier(b)] ||
    b.updated - a.updated
  );
}

/** One incident row. `compact` drops the second line for the collapsed groups. */
function IncidentRow({ i, onFocus, compact }: { i: Incident; onFocus: (i: Incident) => void; compact?: boolean }) {
  const Icon = CAT_ICON[i.category] ?? TriangleAlert;
  const tier = incidentTier(i);
  const meta = TIER_META[tier];
  const sub = i.verification_note ?? i.location ?? i.category;
  return (
    <button
      onClick={() => onFocus(i)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-foreground/5",
        tier === "cleared" && "opacity-45",
      )}
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <Icon className={cn("h-3.5 w-3.5", SEV_COLOR[i.severity] ?? "text-muted-foreground")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{i.title}</span>
        {!compact && (
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">{sub}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("rounded border px-1 py-0 text-[9px] font-medium", meta.cls)}>
          {meta.label}
        </span>
        {!compact && <span className="text-[10px] tabular-nums text-muted-foreground">{ago(i.updated)}</span>}
      </span>
    </button>
  );
}

/** A collapsible section for the routine noise (roadworks, cleared) so it
 *  doesn't bury the handful of things actually happening. Collapsed by default. */
function CollapsibleGroup({
  label, items, onFocus,
}: { label: string; items: Incident[]; onFocus: (i: Incident) => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-foreground/5"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
        <span className="flex-1">{label}</span>
        <span className="tabular-nums">{items.length}</span>
      </button>
      {open && (
        <div className="border-l border-foreground/10 pl-1">
          {items.map((i) => (
            <IncidentRow key={i.id} i={i} onFocus={onFocus} compact />
          ))}
        </div>
      )}
    </div>
  );
}

export function IncidentsPanel({
  chrome,
  incidents,
  onFocus,
}: {
  chrome: PanelChrome;
  incidents: Incident[];
  onFocus: (i: Incident) => void;
}) {
  // Three registers: live incidents you should see now; routine roadworks
  // folded away; and camera-cleared ones sunk out of the way. Only the live
  // ones are shown by default, so a serious report never drowns under works.
  const isCleared = (i: Incident) => incidentTier(i) === "cleared";
  const isWorks = (i: Incident) => i.category === "works" && !isCleared(i);
  const live = incidents.filter((i) => !isWorks(i) && !isCleared(i)).sort(byPriority);
  const works = incidents.filter(isWorks).sort(byPriority);
  const cleared = incidents.filter(isCleared).sort(byPriority);
  const confirmed = incidents.filter((i) => incidentTier(i) === "confirmed").length;

  return (
    <FloatingPanel title="Incidents" icon={TriangleAlert} width={320} {...chrome}>
      <div className="p-1.5">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Watching London
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Landmark className="h-3 w-3" />
            {live.length} live{confirmed > 0 && ` · ${confirmed} confirmed`}
          </span>
        </div>

        {incidents.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            Nothing happening right now.
          </div>
        ) : (
          <div className="max-h-[56vh] overflow-y-auto">
            {live.map((i) => (
              <IncidentRow key={i.id} i={i} onFocus={onFocus} />
            ))}
            {live.length === 0 && (
              <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                No live incidents — only routine roadworks.
              </div>
            )}
            <CollapsibleGroup label="Roadworks" items={works} onFocus={onFocus} />
            <CollapsibleGroup label="Cleared" items={cleared} onFocus={onFocus} />
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
