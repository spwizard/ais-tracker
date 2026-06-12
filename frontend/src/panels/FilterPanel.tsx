import { useMemo, type ReactNode } from "react";
import { Search, SlidersHorizontal, X, Crosshair } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { SHIP_TYPE_GROUPS, colorHexFor, groupKeyFor, NAV_STATUS } from "@/lib/shipTypes";
import { SPEED_MAX, defaultFilters, searchVessels, type Filters } from "@/lib/filters";
import { cn } from "@/lib/utils";
import type { TrackedVessel } from "@/types";

interface FilterPanelProps {
  chrome: PanelChrome;
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Live count per group key for the legend badges. */
  countsByGroup: Record<string, number>;
  /** Full live fleet — drives the finder results + speed histogram. */
  vessels: TrackedVessel[];
  /** Locate a vessel from the results list (select + fly to it). */
  onSelectVessel: (v: TrackedVessel) => void;
}

const GROUP_LABEL = new Map(SHIP_TYPE_GROUPS.map((g) => [g.key, g.label]));
const MAX_RESULTS = 8;

/** Wrap case-insensitive matches of `q` in `text` with a highlight span. */
function highlight(text: string, q: string): ReactNode {
  const query = q.trim();
  if (!query) return text;
  const lower = text.toLowerCase();
  const ql = query.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let hit = lower.indexOf(ql);
  while (hit >= 0) {
    if (hit > i) out.push(text.slice(i, hit));
    out.push(
      <mark key={i} className="bg-primary/25 text-foreground">
        {text.slice(hit, hit + ql.length)}
      </mark>,
    );
    i = hit + ql.length;
    hit = lower.indexOf(ql, i);
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

function ResultRow({
  v,
  query,
  onSelect,
}: {
  v: TrackedVessel;
  query: string;
  onSelect: () => void;
}) {
  const title = v.name?.trim() || `MMSI ${v.mmsi}`;
  const type = GROUP_LABEL.get(groupKeyFor(v.ship_type)) ?? "Vessel";
  const status = v.nav_status != null ? NAV_STATUS[v.nav_status] : undefined;
  const sog = v.sog != null ? `${v.sog.toFixed(1)} kn` : "—";
  return (
    <button
      onClick={onSelect}
      className="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-foreground/5"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: colorHexFor(v.ship_type) }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">
          {highlight(title, query)}
        </span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
          {v.name ? `${v.mmsi} · ` : ""}
          {type} · {sog}
          {status ? ` · ${status}` : ""}
        </span>
      </span>
      <Crosshair className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-primary" />
    </button>
  );
}

export function FilterPanel({
  chrome,
  filters,
  onChange,
  countsByGroup,
  vessels,
  onSelectVessel,
}: FilterPanelProps) {
  const toggleGroup = (key: string) => {
    const groups = new Set(filters.groups);
    groups.has(key) ? groups.delete(key) : groups.add(key);
    onChange({ ...filters, groups });
  };

  const allOn = filters.groups.size === SHIP_TYPE_GROUPS.length;

  const results = useMemo(
    () => searchVessels(vessels, filters.search),
    [vessels, filters.search],
  );

  // Speed distribution (1-kn bins), sqrt-scaled so the stationary spike doesn't
  // flatten the rest. Bars under the selected range are highlighted.
  const hist = useMemo(() => {
    const bins = new Array(SPEED_MAX).fill(0);
    for (const v of vessels) {
      const s = Math.max(0, v.sog ?? 0);
      bins[Math.min(SPEED_MAX - 1, Math.floor(s))]++;
    }
    const max = Math.max(1, ...bins);
    return bins.map((b) => Math.sqrt(b / max));
  }, [vessels]);

  return (
    <FloatingPanel
      title="Filters"
      icon={SlidersHorizontal}
      width={288}
      {...chrome}
      actions={
        <button
          className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          onClick={() => onChange({ ...defaultFilters(), status: filters.status })}
        >
          Reset
        </button>
      }
    >
      <div className="space-y-4 p-4">
        {/* Finder */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              placeholder="Find a vessel by name or MMSI…"
              className="pl-8 pr-8"
            />
            {filters.search && (
              <Hint label="Clear search" side="top">
                <button
                  onClick={() => onChange({ ...filters, search: "" })}
                  aria-label="Clear search"
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </Hint>
            )}
          </div>

          {filters.search.trim() && (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] p-1">
              {results.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No live vessels match “{filters.search.trim()}”.
                </div>
              ) : (
                <>
                  <div className="px-1.5 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    {results.length} match{results.length === 1 ? "" : "es"}
                  </div>
                  {results.slice(0, MAX_RESULTS).map((v) => (
                    <ResultRow
                      key={v.mmsi}
                      v={v}
                      query={filters.search}
                      onSelect={() => onSelectVessel(v)}
                    />
                  ))}
                  {results.length > MAX_RESULTS && (
                    <div className="px-1.5 py-1 text-[11px] text-muted-foreground/60">
                      +{results.length - MAX_RESULTS} more — refine your search
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <Separator />

        {/* Speed range, with a live distribution behind it */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Speed</span>
            <span className="tabular-nums text-foreground">
              {filters.speed[0]}–{filters.speed[1]}
              {filters.speed[1] >= SPEED_MAX ? "+" : ""} kn
            </span>
          </div>
          <div className="flex h-9 items-end gap-px">
            {hist.map((h, i) => {
              const inRange =
                i >= filters.speed[0] &&
                (i < filters.speed[1] || filters.speed[1] >= SPEED_MAX);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-t-sm transition-colors",
                    inRange ? "bg-primary/55" : "bg-foreground/10",
                  )}
                  style={{ height: `${Math.max(4, h * 100)}%` }}
                />
              );
            })}
          </div>
          <Slider
            min={0}
            max={SPEED_MAX}
            step={1}
            value={filters.speed}
            onValueChange={(v) =>
              onChange({ ...filters, speed: [v[0], v[1]] as [number, number] })
            }
          />
          <div className="flex justify-between text-[10px] text-muted-foreground/60">
            <span>stationary</span>
            <span>{SPEED_MAX}+ kn</span>
          </div>
        </div>

        <Separator />

        {/* Ship-type groups */}
        <div className="space-y-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Vessel type
            </span>
            <button
              className="text-[11px] text-primary hover:underline"
              onClick={() =>
                onChange({
                  ...filters,
                  groups: allOn
                    ? new Set()
                    : new Set(SHIP_TYPE_GROUPS.map((g) => g.key)),
                })
              }
            >
              {allOn ? "Clear all" : "Select all"}
            </button>
          </div>
          {SHIP_TYPE_GROUPS.map((g) => (
            <label
              key={g.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-foreground/5"
            >
              <Checkbox
                checked={filters.groups.has(g.key)}
                onCheckedChange={() => toggleGroup(g.key)}
              />
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: g.color }}
              />
              <span className="flex-1 text-sm">{g.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {(countsByGroup[g.key] ?? 0).toLocaleString()}
              </span>
            </label>
          ))}
        </div>
      </div>
    </FloatingPanel>
  );
}
