import { useEffect, useState, type ReactNode } from "react";
import {
  Plane,
  Gauge,
  Navigation2,
  TrendingUp,
  TrendingDown,
  Minus,
  Radio,
  Clock,
  MapPin,
  PlaneTakeoff,
  PlaneLanding,
  Building2,
  Loader2,
  Crosshair,
  Eye,
  EyeOff,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { AircraftDossier, TrackedAircraft } from "@/types";

interface AircraftDetailProps {
  chrome: PanelChrome;
  aircraft: TrackedAircraft;
  dossier: AircraftDossier | null;
  loading: boolean;
  showRoute: boolean;
  // Set when the live position contradicts the callsign route (stale/reused
  // callsign). The map overlay is suppressed and this note is shown instead.
  routeWarning: string | null;
  onToggleShowRoute: () => void;
  onZoomToRoute: () => void;
}

// ADS-B emitter categories → human labels (the common ones).
const CATEGORY: Record<string, string> = {
  A1: "Light",
  A2: "Small",
  A3: "Large",
  A4: "High-vortex",
  A5: "Heavy",
  A6: "High-perf",
  A7: "Rotorcraft",
  B1: "Glider",
  B2: "Lighter-than-air",
  B4: "Ultralight",
  B6: "UAV",
  C1: "Surface vehicle",
  C2: "Surface vehicle",
  C3: "Obstacle",
};

// Emergency squawk codes: hijack / radio-failure / general emergency.
const EMERGENCY_SQUAWK: Record<string, string> = {
  "7500": "Hijack",
  "7600": "Radio failure",
  "7700": "Emergency",
};

/** ISO-3166 alpha-2 → flag emoji via regional indicator symbols. */
function iso2Flag(cc: string | null | undefined): string | null {
  if (!cc || cc.length !== 2) return null;
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function AircraftDetail({
  chrome,
  aircraft: a,
  dossier,
  loading,
  showRoute,
  routeWarning,
  onToggleShowRoute,
  onZoomToRoute,
}: AircraftDetailProps) {
  const info = dossier?.info ?? null;
  const route = dossier?.route ?? null;

  // Tick once a second so "updated … ago" counts up live.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, now - a.ts);

  const title = a.callsign ?? info?.registration ?? a.reg ?? a.hex.toUpperCase();
  const flag = iso2Flag(info?.owner_country_iso);
  const emergency = a.squawk ? EMERGENCY_SQUAWK[a.squawk] : undefined;
  const catLabel = a.category ? CATEGORY[a.category] : undefined;
  const hasRoute = !!(route?.origin?.lat != null && route?.destination?.lat != null);

  const climb =
    a.baro_rate == null || Math.abs(a.baro_rate) < 100
      ? { icon: <Minus />, text: "Level" }
      : a.baro_rate > 0
        ? { icon: <TrendingUp />, text: `+${Math.round(a.baro_rate)} fpm` }
        : { icon: <TrendingDown />, text: `${Math.round(a.baro_rate)} fpm` };

  return (
    <FloatingPanel title={title} icon={Plane} width={380} {...chrome}>
      <div className="space-y-3 p-4">
        {/* Photo */}
        {info?.photo_thumb ? (
          <div className="overflow-hidden rounded-lg border border-foreground/5">
            <img
              src={info.photo_thumb}
              alt={info.registration ?? a.hex}
              className="h-36 w-full object-cover"
              loading="lazy"
            />
            <div className="bg-foreground/5 px-2 py-0.5 text-right text-[9px] text-muted-foreground/70">
              Photo via adsbdb
            </div>
          </div>
        ) : loading ? (
          <div className="grid h-36 place-items-center rounded-lg border border-foreground/5 bg-foreground/5">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
          </div>
        ) : null}

        {/* Identity */}
        <div className="flex items-center gap-2.5">
          <Plane className="h-4 w-4 shrink-0 text-sky-400" />
          {flag && (
            <span className="text-base leading-none" title={info?.owner_country ?? undefined}>
              {flag}
            </span>
          )}
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            <span className="font-mono">{info?.registration ?? a.reg ?? a.hex.toUpperCase()}</span>
            {(info?.icao_type ?? a.ac_type) && <span> · {info?.icao_type ?? a.ac_type}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {info?.owner && (
            <Badge variant="muted" className="gap-1">
              <Building2 className="h-3 w-3" />
              {info.owner}
            </Badge>
          )}
          {catLabel && <Badge variant="muted">{catLabel}</Badge>}
          {a.on_ground && <Badge variant="muted">On ground</Badge>}
          {emergency && (
            <span className="ml-auto flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
              <TriangleAlert className="h-3 w-3" />
              {emergency}
            </span>
          )}
        </div>

        {(info?.type || info?.manufacturer) && (
          <div className="text-xs text-muted-foreground">
            {[info?.manufacturer, info?.type].filter(Boolean).join(" ")}
          </div>
        )}

        <Separator />

        {/* Route */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
              <Navigation2 className="h-3 w-3" />
              Route
            </span>
            {hasRoute && !routeWarning && (
              <div className="flex items-center gap-1">
                <Hint label={showRoute ? "Hide route on map" : "Show route on map"} side="top">
                  <button
                    aria-label="Toggle route on map"
                    onClick={onToggleShowRoute}
                    className={cn(
                      "grid h-6 w-6 place-items-center rounded-md transition-colors",
                      showRoute
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                    )}
                  >
                    {showRoute ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </Hint>
                <Hint label="Zoom to route" side="top">
                  <button
                    aria-label="Zoom to route"
                    onClick={onZoomToRoute}
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                </Hint>
              </div>
            )}
          </div>
          {route?.origin || route?.destination ? (
            <div className="rounded-lg border border-foreground/5 bg-foreground/5 p-2.5">
              <div className="flex items-center gap-2">
                <AirportEnd
                  icon={<PlaneTakeoff className="h-3.5 w-3.5" />}
                  code={route?.origin?.iata ?? route?.origin?.icao}
                  place={route?.origin?.municipality ?? route?.origin?.name}
                  align="left"
                />
                <div className="flex-1 border-t border-dashed border-foreground/20" />
                <Plane className="h-3.5 w-3.5 shrink-0 rotate-90 text-sky-400" />
                <div className="flex-1 border-t border-dashed border-foreground/20" />
                <AirportEnd
                  icon={<PlaneLanding className="h-3.5 w-3.5" />}
                  code={route?.destination?.iata ?? route?.destination?.icao}
                  place={route?.destination?.municipality ?? route?.destination?.name}
                  align="right"
                />
              </div>
              {route?.airline?.name && (
                <div className="mt-2 text-center text-[11px] text-muted-foreground">
                  {route.airline.name}
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-12 place-items-center rounded-lg border border-foreground/5 bg-foreground/5 text-[11px] text-muted-foreground">
              {loading ? "Looking up route…" : "No route data"}
            </div>
          )}
          {routeWarning && (
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-500/90">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{routeWarning}</span>
            </div>
          )}
        </div>

        {/* Flight data */}
        <div className="grid grid-cols-2 gap-2">
          <Field
            icon={<Gauge />}
            label="Altitude"
            value={a.on_ground ? "Ground" : fmt(a.alt_baro, " ft", 0)}
          />
          <Field icon={climb.icon} label="Vertical" value={climb.text} />
          <Field icon={<Gauge />} label="Ground speed" value={fmt(a.gs, " kn", 0)} />
          <Field icon={<Navigation2 />} label="Track" value={fmt(a.track, "°", 0)} />
          <Field icon={<Radio />} label="Squawk" value={a.squawk ?? "—"} />
          <Field icon={<Clock />} label="Updated" value={fmtAge(ageSec)} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            Position
          </span>
          <span className="font-mono">
            {a.lat?.toFixed(4)}, {a.lon?.toFixed(4)}
          </span>
        </div>
      </div>
    </FloatingPanel>
  );
}

function AirportEnd({
  icon,
  code,
  place,
  align,
}: {
  icon: ReactNode;
  code?: string | null;
  place?: string | null;
  align: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <div
        className={cn(
          "flex items-center gap-1 text-sm font-semibold",
          align === "right" && "justify-end",
        )}
      >
        <span className="text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        {code ?? "—"}
      </div>
      <div className="truncate text-[10px] text-muted-foreground">{place ?? ""}</div>
    </div>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-foreground/5 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function fmt(n: number | null, unit: string, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}${unit}`;
}

/** Compact "time since last report", e.g. 42s · 3m 05s · 1h 12m. */
function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
