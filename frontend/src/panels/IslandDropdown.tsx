import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A single dropdown surface that drops from the centre of the top-bar island.
 *  All island panels (search, filters, alerts) share this position, width and
 *  dismiss behaviour. Clicks on the island bar itself are ignored so the trigger
 *  icons can toggle their panel without the outside-click immediately reopening. */
export function IslandDropdown({
  open,
  onClose,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return; // inside the panel
      if (t.closest("[data-island-bar]")) return; // on the island / a trigger
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-50 flex justify-center px-4">
      <div
        ref={ref}
        className={cn(
          "glass pointer-events-auto flex max-h-[72vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border/60 shadow-2xl animate-fade-in",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
