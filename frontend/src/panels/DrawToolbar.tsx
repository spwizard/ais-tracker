import { Circle, Square, PenTool, X } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FENCE_CATEGORIES, type FenceCategory } from "@/geofence/types";
import type { FenceShape } from "@/geofence/types";

interface DrawToolbarProps {
  drawMode: FenceShape | null;
  onSetMode: (m: FenceShape | null) => void;
  category: FenceCategory;
  onSetCategory: (c: FenceCategory) => void;
}

const SHAPES: { mode: FenceShape; icon: typeof Circle; label: string }[] = [
  { mode: "circle", icon: Circle, label: "Circle / radius" },
  { mode: "rectangle", icon: Square, label: "Rectangle" },
  { mode: "polygon", icon: PenTool, label: "Polygon" },
];

const HINTS: Record<FenceShape, string> = {
  circle: "Drag from the centre to set the radius (or click twice) · Esc to cancel",
  rectangle: "Drag one corner to the opposite (or click twice) · Esc to cancel",
  polygon: "Click to add points · Enter to finish · Esc to cancel",
  corridor: "",
};

export function DrawToolbar({
  drawMode,
  onSetMode,
  category,
  onSetCategory,
}: DrawToolbarProps) {
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 animate-fade-in">
      {drawMode && (
        <div className="glass px-3 py-1.5 text-[11px] text-muted-foreground">
          {HINTS[drawMode]}
        </div>
      )}
      <div className="glass flex items-center gap-1 p-1.5">
        <span className="px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Draw
        </span>
        {SHAPES.map((s) => {
          const active = drawMode === s.mode;
          return (
            <Hint key={s.mode} label={s.label} side="top">
              <button
                aria-label={s.label}
                onClick={() => onSetMode(active ? null : s.mode)}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
              >
                <s.icon className="h-4 w-4" />
              </button>
            </Hint>
          );
        })}

        <div className="mx-1 h-6 w-px bg-foreground/10" />

        {/* Category / colour for the next fence */}
        <div className="flex items-center gap-1">
          {FENCE_CATEGORIES.map((c) => (
            <Hint key={c.key} label={c.label} side="top">
              <button
                aria-label={c.label}
                onClick={() => onSetCategory(c.key)}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-md transition-transform hover:scale-110",
                  category === c.key && "ring-2 ring-offset-2 ring-offset-background",
                )}
                style={
                  category === c.key
                    ? ({ "--tw-ring-color": c.color } as React.CSSProperties)
                    : undefined
                }
              >
                <span
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ background: c.color }}
                />
              </button>
            </Hint>
          ))}
        </div>

        {drawMode && (
          <>
            <div className="mx-1 h-6 w-px bg-foreground/10" />
            <Hint label="Stop drawing (Esc)" side="top">
              <button
                aria-label="Stop drawing"
                onClick={() => onSetMode(null)}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </Hint>
          </>
        )}
      </div>
    </div>
  );
}
