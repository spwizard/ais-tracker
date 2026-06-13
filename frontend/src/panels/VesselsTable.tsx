import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { colorHexFor, groupKeyFor, NAV_STATUS, SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { mmsiCountry } from "@/lib/flags";
import type { TrackedVessel } from "@/types";

const ROW_H = 34;
const OVERSCAN = 8;
const GROUP_LABEL = new Map(SHIP_TYPE_GROUPS.map((g) => [g.key, g.label]));
// flag · name · mmsi · type · speed · status · destination · flag-badge
const COLS = "32px minmax(120px,1.4fr) 96px 130px 76px 150px minmax(120px,1fr) 56px";

type SortKey = "name" | "mmsi" | "type" | "speed" | "status" | "flag" | "flagged";

interface Props {
  vessels: TrackedVessel[];
  flagged: Set<number>;
  search: string;
  selectedMmsi: number | null;
  onHover: (mmsi: number | null) => void;
  onSelect: (mmsi: number) => void;
}

function HeaderCell({
  label,
  col,
  sortKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "left" | "right" | "center";
}) {
  const active = sortKey === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={cn(
        "flex items-center gap-1 px-2 text-[11px] font-medium uppercase tracking-wide transition-colors hover:text-foreground",
        active ? "text-primary" : "text-muted-foreground",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      {label}
      {active &&
        (dir === "asc" ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        ))}
    </button>
  );
}

export function VesselsTable({
  vessels,
  flagged,
  search,
  selectedMmsi,
  onHover,
  onSelect,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const onSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "speed" || k === "flagged" ? "desc" : "asc");
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let r = vessels;
    if (q)
      r = r.filter(
        (v) => (v.name ?? "").toLowerCase().includes(q) || String(v.mmsi).includes(q),
      );
    const s = dir === "asc" ? 1 : -1;
    const cmp = (a: TrackedVessel, b: TrackedVessel): number => {
      switch (sortKey) {
        case "name":
          return s * (a.name ?? "~").localeCompare(b.name ?? "~");
        case "mmsi":
          return s * (a.mmsi - b.mmsi);
        case "speed":
          return s * ((a.sog ?? -1) - (b.sog ?? -1));
        case "type":
          return s * groupKeyFor(a.ship_type).localeCompare(groupKeyFor(b.ship_type));
        case "flag":
          return (
            s *
            (mmsiCountry(a.mmsi)?.name ?? "~").localeCompare(mmsiCountry(b.mmsi)?.name ?? "~")
          );
        case "status":
          return s * ((a.nav_status ?? 99) - (b.nav_status ?? 99));
        case "flagged":
          return s * ((flagged.has(a.mmsi) ? 1 : 0) - (flagged.has(b.mmsi) ? 1 : 0));
        default:
          return 0;
      }
    };
    return [...r].sort(cmp);
  }, [vessels, search, sortKey, dir, flagged]);

  // --- windowed virtualization ---
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(480);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(start, end);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="grid shrink-0 items-center border-b border-foreground/10 py-1.5"
        style={{ gridTemplateColumns: COLS }}
      >
        <span />
        <HeaderCell label="Vessel" col="name" sortKey={sortKey} dir={dir} onSort={onSort} />
        <HeaderCell label="MMSI" col="mmsi" sortKey={sortKey} dir={dir} onSort={onSort} />
        <HeaderCell label="Type" col="type" sortKey={sortKey} dir={dir} onSort={onSort} />
        <HeaderCell label="Speed" col="speed" sortKey={sortKey} dir={dir} onSort={onSort} align="right" />
        <HeaderCell label="Status" col="status" sortKey={sortKey} dir={dir} onSort={onSort} />
        <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Destination
        </span>
        <HeaderCell label="Risk" col="flagged" sortKey={sortKey} dir={dir} onSort={onSort} align="center" />
      </div>

      {/* Virtualized body */}
      <div
        ref={bodyRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="panel-scroll relative flex-1 overflow-y-auto"
      >
        {rows.length === 0 ? (
          <div className="grid h-24 place-items-center text-sm text-muted-foreground">
            No vessels match “{search.trim()}”.
          </div>
        ) : (
          <div style={{ height: rows.length * ROW_H }} className="relative">
            {visible.map((v, i) => {
              const idx = start + i;
              const country = mmsiCountry(v.mmsi);
              const isFlagged = flagged.has(v.mmsi);
              const cell = (node: ReactNode, extra?: string) => (
                <span className={cn("truncate px-2 text-xs", extra)}>{node}</span>
              );
              return (
                <div
                  key={v.mmsi}
                  onMouseEnter={() => onHover(v.mmsi)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(v.mmsi)}
                  className={cn(
                    "absolute grid w-full cursor-pointer items-center border-b border-foreground/5 transition-colors hover:bg-foreground/[0.06]",
                    selectedMmsi === v.mmsi && "bg-primary/10",
                  )}
                  style={{ top: idx * ROW_H, height: ROW_H, gridTemplateColumns: COLS }}
                >
                  <span className="grid place-items-center text-sm" title={country?.name}>
                    {country?.flag ?? "🏳️"}
                  </span>
                  {cell(
                    <span className="font-medium text-foreground/90">
                      {v.name?.trim() || <span className="text-muted-foreground">—</span>}
                    </span>,
                  )}
                  {cell(<span className="tabular-nums text-muted-foreground">{v.mmsi}</span>)}
                  <span className="flex items-center gap-1.5 truncate px-2 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: colorHexFor(v.ship_type) }}
                    />
                    <span className="truncate text-foreground/80">
                      {GROUP_LABEL.get(groupKeyFor(v.ship_type))}
                    </span>
                  </span>
                  {cell(
                    v.sog != null ? `${v.sog.toFixed(1)}` : "—",
                    "text-right tabular-nums text-foreground/80",
                  )}
                  {cell(
                    <span className="text-muted-foreground">
                      {v.nav_status != null ? NAV_STATUS[v.nav_status] ?? "—" : "—"}
                    </span>,
                  )}
                  {cell(
                    <span className="text-muted-foreground">
                      {v.destination?.trim() || "—"}
                    </span>,
                  )}
                  <span className="grid place-items-center">
                    {isFlagged ? (
                      <span className="flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
                        <AlertTriangle className="h-2.5 w-2.5" />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/30">·</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
