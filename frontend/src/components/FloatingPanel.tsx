import { useCallback, useRef, type ReactNode } from "react";
import { X, GripVertical, Pin, type LucideIcon } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface PanelChrome {
  position: { x: number; y: number };
  onMove: (x: number, y: number) => void;
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
  pinned?: boolean;
  onTogglePin?: () => void;
}

interface FloatingPanelProps extends PanelChrome {
  title: string;
  icon: LucideIcon;
  width?: number;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * A self-contained draggable, closable glass panel.
 *
 * Dragging is pointer-event based (no dependency): grabbing the header captures
 * the pointer and reports the new clamped position via `onMove`. The whole panel
 * is positioned absolutely from the viewport top-left so it floats over the map.
 */
export function FloatingPanel({
  title,
  icon: Icon,
  position,
  onMove,
  onClose,
  onFocus,
  zIndex,
  pinned = false,
  onTogglePin,
  width = 288,
  actions,
  className,
  children,
}: FloatingPanelProps) {
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Pinned panels are locked; ignore drags (and drags starting on a header
      // button, e.g. close/pin).
      if (pinned || (e.target as HTMLElement).closest("[data-no-drag]")) return;
      onFocus();
      dragRef.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pinned, position.x, position.y, onFocus],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const margin = 8;
      const maxX = window.innerWidth - width - margin;
      const maxY = window.innerHeight - 48 - margin; // keep header reachable
      const x = Math.min(Math.max(margin, e.clientX - d.dx), Math.max(margin, maxX));
      const y = Math.min(Math.max(margin, e.clientY - d.dy), Math.max(margin, maxY));
      onMove(x, y);
    },
    [onMove, width],
  );

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  return (
    <div
      className={cn(
        "glass pointer-events-auto absolute flex animate-fade-in flex-col overflow-hidden",
        className,
      )}
      style={{ left: position.x, top: position.y, width, zIndex }}
      onPointerDown={onFocus}
    >
      {/* Drag handle / header */}
      <div
        className={cn(
          "flex items-center gap-2 border-b border-foreground/5 px-3 py-2.5",
          pinned ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/50",
            pinned && "opacity-30",
          )}
        />
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        <span className="flex-1 truncate text-sm font-semibold tracking-tight">
          {title}
        </span>
        <div className="flex items-center gap-0.5" data-no-drag>
          {actions}
          {onTogglePin && (
            <Hint label={pinned ? "Unpin (allow dragging)" : "Pin in place"} side="bottom">
              <button
                onClick={onTogglePin}
                className={cn(
                  "grid h-6 w-6 place-items-center rounded-md transition-colors",
                  pinned
                    ? "text-primary hover:bg-primary/10"
                    : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
                aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                aria-pressed={pinned}
              >
                <Pin className={cn("h-3.5 w-3.5", pinned && "fill-current")} />
              </button>
            </Hint>
          )}
          <Hint label="Close panel" side="bottom">
            <button
              onClick={onClose}
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label={`Close ${title}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Hint>
        </div>
      </div>

      {/* Body */}
      <div className="panel-scroll max-h-[calc(100vh-8rem)] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
