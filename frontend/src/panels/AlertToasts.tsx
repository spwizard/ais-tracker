import { useEffect, useRef, useState } from "react";
import {
  LogIn,
  LogOut,
  Timer,
  Gauge,
  WifiOff,
  Waypoints,
  Zap,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AlertKind =
  | "enter"
  | "exit"
  | "dwell"
  | "speed"
  | "dark"
  | "rendezvous"
  | "spoof";

export interface ToastAlert {
  key: string;
  ts: number;
  kind: AlertKind;
  title: string;
  subtitle: string;
  mmsi: number;
  lat: number;
  lon: number;
}

const META: Record<AlertKind, { icon: LucideIcon; color: string }> = {
  enter: { icon: LogIn, color: "text-emerald-400" },
  exit: { icon: LogOut, color: "text-amber-400" },
  dwell: { icon: Timer, color: "text-sky-400" },
  speed: { icon: Gauge, color: "text-violet-400" },
  dark: { icon: WifiOff, color: "text-rose-400" },
  rendezvous: { icon: Waypoints, color: "text-orange-400" },
  spoof: { icon: Zap, color: "text-red-400" },
};

const DISMISS_MS = 6500;
const MAX_VISIBLE = 4;

interface Toast {
  key: string;
  alert: ToastAlert;
}

/** Transient notifications for incoming alerts (geofence + risk). Pre-existing
 *  ones (already in the feed at mount) don't toast — only genuinely new ones. */
export function AlertToasts({
  alerts,
  onClick,
}: {
  alerts: ToastAlert[];
  onClick: (a: ToastAlert) => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      alerts.forEach((a) => seen.current.add(a.key));
      return;
    }
    const fresh: Toast[] = [];
    for (const a of alerts) {
      if (!seen.current.has(a.key)) {
        seen.current.add(a.key);
        fresh.push({ key: a.key, alert: a });
      }
    }
    // Bound the de-dupe set: drop the oldest keys (Sets iterate in insertion
    // order) so a long session doesn't retain every alert key ever toasted.
    while (seen.current.size > 500) {
      const oldest = seen.current.values().next().value;
      if (oldest == null) break;
      seen.current.delete(oldest);
    }
    if (fresh.length === 0) return;
    setToasts((prev) => [...fresh, ...prev].slice(0, MAX_VISIBLE));
    fresh.forEach(({ key }) => {
      const id = window.setTimeout(
        () => setToasts((p) => p.filter((t) => t.key !== key)),
        DISMISS_MS,
      );
      timers.current.push(id);
    });
  }, [alerts]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-20 z-50 flex w-80 -translate-x-1/2 flex-col gap-2">
      {toasts.map(({ key, alert }) => {
        const m = META[alert.kind];
        const Icon = m.icon;
        return (
          <div
            key={key}
            onClick={() => onClick(alert)}
            className="glass pointer-events-auto flex cursor-pointer items-center gap-2.5 px-3 py-2.5 animate-slide-in"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground/5">
              <Icon className={cn("h-4 w-4", m.color)} />
            </span>
            <div className="min-w-0 flex-1 text-xs leading-tight">
              <div className="truncate font-medium">{alert.title}</div>
              <div className="truncate text-muted-foreground">{alert.subtitle}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setToasts((p) => p.filter((t) => t.key !== key));
              }}
              aria-label="Dismiss"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
