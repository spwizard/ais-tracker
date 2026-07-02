import { useEffect, useMemo, useState } from "react";
import { Cctv, Plus, Trash2, MapPin, Check, X } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CameraTile } from "./CameraTile";
import type { Camera } from "@/types";

/** Rows × cols that fill the screen for a given tile count (all tiles visible,
 *  no scroll — a proper video wall). */
function gridDims(n: number): [cols: number, rows: number] {
  if (n <= 1) return [1, 1];
  if (n <= 2) return [2, 1];
  if (n <= 4) return [2, 2];
  if (n <= 6) return [3, 2];
  return [3, 3]; // 7–9
}

interface CameraWallProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cameras: Camera[];
  ids: string[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onAddInView: () => void;
  onFocus: (c: Camera) => void;
  max: number;
}

export function CameraWall({
  open,
  onOpenChange,
  cameras,
  ids,
  onToggle,
  onRemove,
  onClear,
  onAddInView,
  onFocus,
  max,
}: CameraWallProps) {
  const [mode, setMode] = useState<"live" | "stills">("live");
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);
  const selected = useMemo(
    () => ids.map((id) => byId.get(id)).filter((c): c is Camera => !!c),
    [ids, byId],
  );
  const full = ids.length >= max;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cameras.filter((c) => (c.name ?? "").toLowerCase().includes(q)).slice(0, 40);
  }, [query, cameras]);

  // Esc closes the picker first, then the wall.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picking) setPicking(false);
      else onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picking, onOpenChange]);

  if (!open) return null;

  const [cols, rows] = gridDims(selected.length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera wall"
      className="pointer-events-auto fixed inset-0 z-[70] flex flex-col bg-background"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Cctv className="h-4 w-4 text-primary" />
          Camera wall
        </div>
        <Badge variant="muted" className="tabular-nums">
          {ids.length}/{max}
        </Badge>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant={picking ? "secondary" : "outline"}
            className="h-7 gap-1 text-xs"
            onClick={() => setPicking((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add cameras
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onAddInView}
            disabled={full}
          >
            <MapPin className="h-3.5 w-3.5" />
            Add in view
          </Button>
          <label className="flex cursor-pointer items-center gap-1.5 pl-1 text-[11px] font-medium text-muted-foreground">
            {mode === "live" ? "Live" : "Stills"}
            <Switch
              checked={mode === "live"}
              onCheckedChange={(v) => setMode(v ? "live" : "stills")}
            />
          </label>
          {ids.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={onClear}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </Button>
          )}
          <button
            aria-label="Close camera wall"
            onClick={() => onOpenChange(false)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative min-h-0 flex-1 p-3">
        {selected.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div className="space-y-1.5">
              <Cctv className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Your wall is empty</p>
              <p className="mx-auto max-w-xs text-xs text-muted-foreground/60">
                Use “Add cameras” or “Add in view” to build a grid of up to {max} live
                London feeds.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="grid h-full w-full gap-2"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
            }}
          >
            {selected.map((c, i) => (
              <CameraTile
                key={c.id}
                camera={c}
                mode={mode}
                index={i}
                onRemove={() => onRemove(c.id)}
                onFocus={() => onFocus(c)}
              />
            ))}
          </div>
        )}

        {/* Floating picker — overlays the grid instead of pushing it. */}
        {picking && (
          <div className="glass absolute right-3 top-3 z-10 w-80 overflow-hidden rounded-lg border border-border/60 shadow-2xl">
            <Command shouldFilter={false} className="bg-transparent">
              <CommandInput
                autoFocus
                placeholder="Search London cameras…"
                value={query}
                onValueChange={setQuery}
              />
              <CommandList className="max-h-72">
                {!query && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Type a road or place — click to add or remove.
                  </div>
                )}
                {query && matches.length === 0 && (
                  <CommandEmpty>No cameras found.</CommandEmpty>
                )}
                {matches.map((c) => {
                  const on = ids.includes(c.id);
                  const blocked = !on && full;
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => !blocked && onToggle(c.id)}
                      className={cn("gap-2", blocked && "opacity-40")}
                    >
                      <span
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded border",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-foreground/30",
                        )}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{c.name ?? c.id}</span>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </div>
        )}
      </div>
    </div>
  );
}
