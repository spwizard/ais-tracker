/**
 * The place picker — the front door. Sits in the top bar; choosing a region is
 * the one action that flies the map (and sets that region's default eyes).
 * Reads "Custom view" once you've panned away, so it never lies about where
 * you are. Desktop: a small dropdown under the pill. Mobile: a sheet.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Compass, MapPin } from "lucide-react";
import { REGIONS, regionById, type RegionId } from "@/lib/regions";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/Sheet";

export function RegionPicker({
  regionId,
  onEnterRegion,
  compact = false,
  sheet = false,
}: {
  regionId: RegionId | null;
  onEnterRegion: (id: RegionId) => void;
  /** Tighter pill for the mobile bar. */
  compact?: boolean;
  /** Present the list as a bottom sheet (phones) instead of a dropdown. */
  sheet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = regionById(regionId);

  useEffect(() => {
    if (!open || sheet) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, sheet]);

  const choose = (id: RegionId) => {
    setOpen(false);
    onEnterRegion(id);
  };

  const list = (
    <div className="flex flex-col p-1">
      {REGIONS.map((r) => {
        const active = r.id === regionId;
        return (
          <button
            key={r.id}
            onClick={() => choose(r.id)}
            className={cn(
              "flex items-center justify-between gap-4 rounded-lg px-3 py-2 text-left transition-colors",
              active ? "bg-primary/15 text-foreground" : "hover:bg-foreground/10",
            )}
          >
            <span className="flex items-center gap-2.5">
              <MapPin className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
              <span className="text-sm font-medium">{r.label}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">{r.tagline}</span>
          </button>
        );
      })}
      <div className="mx-3 my-1 h-px bg-foreground/10" />
      <div className="flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-muted-foreground">
        <Compass className="h-3.5 w-3.5" />
        Pan anywhere — the picker reads “Custom view” until you choose a place.
      </div>
    </div>
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        aria-label="Choose a region"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors",
          compact ? "h-8 px-2 text-xs" : "h-8 px-2.5 text-xs",
          current
            ? "bg-primary/15 text-primary hover:bg-primary/20"
            : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <MapPin className="h-3.5 w-3.5" />
        <span className={cn(compact && "max-w-[7rem] truncate")}>{current?.label ?? "Custom view"}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && !sheet && (
        <div className="glass absolute left-0 top-10 z-50 w-72 overflow-hidden rounded-xl border border-border/60 shadow-2xl animate-fade-in">
          {list}
        </div>
      )}
      {open &&
        sheet &&
        // Portal: the glass bar's backdrop-filter would otherwise become the
        // containing block for the sheet's `fixed` positioning.
        createPortal(
          <Sheet title="Where are you looking?" icon={MapPin} onClose={() => setOpen(false)}>
            {list}
          </Sheet>,
          document.body,
        )}
    </div>
  );
}
