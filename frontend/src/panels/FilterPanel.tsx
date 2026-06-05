import { Search, SlidersHorizontal, X } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { SPEED_MAX, defaultFilters, type Filters } from "@/lib/filters";

interface FilterPanelProps {
  chrome: PanelChrome;
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Live count per group key for the legend badges. */
  countsByGroup: Record<string, number>;
}

export function FilterPanel({
  chrome,
  filters,
  onChange,
  countsByGroup,
}: FilterPanelProps) {
  const toggleGroup = (key: string) => {
    const groups = new Set(filters.groups);
    groups.has(key) ? groups.delete(key) : groups.add(key);
    onChange({ ...filters, groups });
  };

  const allOn = filters.groups.size === SHIP_TYPE_GROUPS.length;

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
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Search name or MMSI…"
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

        <Separator />

        {/* Speed range */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Speed</span>
            <span className="tabular-nums text-foreground">
              {filters.speed[0]}–{filters.speed[1]}
              {filters.speed[1] >= SPEED_MAX ? "+" : ""} kn
            </span>
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
