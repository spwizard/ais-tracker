import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

/**
 * A bottom sheet — the mobile counterpart of a FloatingPanel. The map stays
 * live above it (no backdrop), Apple/Google-Maps style. Drag the header to snap
 * between three heights (peek / half / full); drag well below peek to dismiss.
 *
 * Geometry: the sheet is anchored to the viewport bottom and its *top* moves.
 * That's the important bit — the body always spans exactly the visible area, so
 * long content scrolls inside it instead of running off the bottom of the screen.
 * Only the header is a drag surface, so the body scrolls independently.
 */
const PEEK_PX = 120; // visible height at the "peek" snap (handle + summary row)
const FULL_TOP = 0.07; // "full" leaves a 7% sliver of map at the top
const HALF_TOP = 0.52; // "half" opens with the top edge ~halfway down
const DISMISS_SLOP = 72; // drag this far below peek to close

interface SheetProps {
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function Sheet({ title, icon: Icon, onClose, actions, children }: SheetProps) {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const f = () => setVh(window.innerHeight);
    window.addEventListener("resize", f);
    window.addEventListener("orientationchange", f);
    return () => {
      window.removeEventListener("resize", f);
      window.removeEventListener("orientationchange", f);
    };
  }, []);

  // Snap points as the sheet's top edge (px from the top of the viewport).
  const snaps = {
    full: Math.round(vh * FULL_TOP),
    half: Math.round(vh * HALF_TOP),
    peek: Math.max(0, vh - PEEK_PX),
  };

  const [top, setTop] = useState(() => Math.round(window.innerHeight * HALF_TOP));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startTop: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      drag.current = { startY: e.clientY, startTop: top };
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [top],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      setTop(Math.min(Math.max(snaps.full, d.startTop + (e.clientY - d.startY)), vh));
    },
    [snaps.full, vh],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (!d) return;
      if (top > snaps.peek + DISMISS_SLOP) {
        onClose();
        return;
      }
      const nearest = [snaps.full, snaps.half, snaps.peek].reduce((a, b) =>
        Math.abs(b - top) < Math.abs(a - top) ? b : a,
      );
      setTop(nearest);
    },
    [top, snaps.full, snaps.half, snaps.peek, onClose],
  );

  return (
    <div
      className="glass pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-foreground/10 shadow-2xl"
      style={{
        top: `${top}px`,
        transition: dragging ? undefined : "top 0.28s cubic-bezier(0.32,0.72,0,1)",
      }}
      role="dialog"
      aria-label={title}
    >
      {/* Drag header */}
      <div
        className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-foreground/25" />
        <div className="flex items-center gap-2 px-4 py-2.5">
          <Icon className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 truncate text-sm font-semibold tracking-tight">{title}</span>
          <div className="flex items-center gap-0.5" data-no-drag>
            {actions}
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label={`Close ${title}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Body — spans the visible area exactly, scrolls independently, with room
          for the home-bar inset at the bottom. */}
      <div className="panel-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">
        {children}
      </div>
    </div>
  );
}
