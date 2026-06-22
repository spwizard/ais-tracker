import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { SPEED_MAX, STATUS_FILTERS, defaultFilters, type Filters } from "@/lib/filters";
import { cn } from "@/lib/utils";

/** Filter controls for the island dropdown — status, ship type (with live
 *  counts) and speed. Content only; the IslandDropdown provides the surface. */
export function FiltersContent({
  filters,
  onChange,
  countsByGroup,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  countsByGroup: Record<string, number>;
}) {
  const allOn = filters.groups.size === SHIP_TYPE_GROUPS.length;
  const dirty =
    filters.status !== "all" || !allOn || filters.speed[0] > 0 || filters.speed[1] < SPEED_MAX;

  const toggleGroup = (key: string) => {
    const groups = new Set(filters.groups);
    groups.has(key) ? groups.delete(key) : groups.add(key);
    onChange({ ...filters, groups });
  };

  return (
    <div className="space-y-3.5 p-4">
      {/* Status */}
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Status</span>
        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.key}
              onClick={() => onChange({ ...filters, status: s.key })}
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                filters.status === s.key
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Ship-type groups with live counts */}
      <div className="space-y-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Vessel type</span>
          <button
            className="text-[11px] text-primary hover:underline"
            onClick={() =>
              onChange({
                ...filters,
                groups: allOn ? new Set() : new Set(SHIP_TYPE_GROUPS.map((g) => g.key)),
              })
            }
          >
            {allOn ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-4">
          {SHIP_TYPE_GROUPS.map((g) => (
            <label
              key={g.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-foreground/5"
            >
              <Checkbox checked={filters.groups.has(g.key)} onCheckedChange={() => toggleGroup(g.key)} />
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
              <span className="flex-1 text-sm">{g.label}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {(countsByGroup[g.key] ?? 0).toLocaleString()}
              </span>
            </label>
          ))}
        </div>
      </div>

      <Separator />

      {/* Speed */}
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
          onValueChange={(v) => onChange({ ...filters, speed: [v[0], v[1]] as [number, number] })}
        />
      </div>

      {dirty && (
        <>
          <Separator />
          <button
            onClick={() => onChange(defaultFilters())}
            className="w-full rounded-md py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            Reset filters
          </button>
        </>
      )}
    </div>
  );
}
