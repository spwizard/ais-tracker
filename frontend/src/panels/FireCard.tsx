/**
 * Fire detail view — the story of one wildfire: how intense, whether it's
 * growing, and (the useful part) where the wind is driving it and which town
 * lies in its path. Rendered inside the Wildfires panel (master–detail), so
 * it's content-only with a back affordance rather than its own floating panel.
 */
import { Wind, Satellite, Navigation, ChevronLeft, Factory } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FireComplex } from "@/types";
import { fmtFrp } from "./WildfiresPanel";

const STATUS: Record<string, { label: string; cls: string }> = {
  spreading: { label: "Spreading", cls: "text-rose-400" },
  active: { label: "Active", cls: "text-orange-400" },
  easing: { label: "Easing", cls: "text-sky-400" },
  cooling: { label: "Cooling", cls: "text-muted-foreground" },
};

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Cell({ k, v, accent }: { k: string; v: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-foreground/10 bg-foreground/[0.04] p-2.5">
      <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">{k}</div>
      <div className={cn("mt-1 font-mono text-base font-bold tabular-nums", accent)}>{v}</div>
    </div>
  );
}

export function FireDetail({ fire, onBack }: { fire: FireComplex; onBack: () => void }) {
  const isIndustrial = fire.kind === "industrial";
  const st = isIndustrial
    ? { label: "Industrial", cls: "text-slate-300" }
    : STATUS[fire.status] ?? STATUS.active;
  const name = fire.place ?? `${fire.lat.toFixed(2)}, ${fire.lon.toFixed(2)}`;
  const growthUp = fire.growth > 1;

  return (
    <div className="flex flex-col gap-3 p-2.5">
      <button
        onClick={onBack}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All fires
      </button>

      {/* location */}
      <div>
        <div className="flex items-center gap-2 text-[17px] font-bold leading-tight">
          {isIndustrial ? (
            <Factory className="h-[18px] w-[18px] shrink-0 text-slate-400" />
          ) : (
            fire.flag && <span>{fire.flag}</span>
          )}
          <span className="text-balance">{name}</span>
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {fire.lat.toFixed(3)}°, {fire.lon.toFixed(3)}° {fire.region && `· ${fire.region}`}
        </div>
      </div>

      {/* intensity hero */}
      <div className="flex items-baseline gap-2.5 rounded-xl border border-orange-500/25 bg-[radial-gradient(130%_120%_at_15%_10%,rgba(249,115,22,0.18),transparent_60%)] p-3">
        <span
          className="font-mono text-[34px] font-extrabold leading-none tabular-nums"
          style={{
            background: "linear-gradient(180deg,#fff0cf,#f97316)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {fmtFrp(fire.total_frp)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">MW total</span>
        <span className="ml-auto text-right">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">Status</div>
          <div className={cn("text-sm font-bold", st.cls)}>{st.label}</div>
        </span>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-2">
        <Cell k="Detections 24h" v={fire.count_24h.toLocaleString()} />
        <Cell
          k="Growth vs prev 24h"
          v={`${growthUp ? "↑" : "↓"} ${Math.round(Math.abs(fire.growth - 1) * 100)}%`}
          accent={growthUp ? "text-rose-400" : "text-emerald-400"}
        />
        <Cell k="Extent" v={<>{fire.span_km}<span className="text-[11px] text-muted-foreground"> km</span></>} />
        <Cell k="Peak pixel" v={<>{Math.round(fire.peak_frp)}<span className="text-[11px] text-muted-foreground"> MW</span></>} />
      </div>

      {/* Industrial sites get an explanation instead of a spread forecast. */}
      {isIndustrial ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-slate-500/25 bg-slate-500/[0.08] p-3">
          <Factory className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-[12.5px] leading-snug text-foreground/85">
            Likely a <b className="text-slate-200">fixed industrial heat source</b> — a power
            station, refinery, flare or works. It burns steadily day and night from one spot,
            which is how it's told apart from a spreading wildfire. Not a spread risk.
          </p>
        </div>
      ) : fire.spread_compass ? (
        <div className="flex flex-col gap-2.5 rounded-xl border border-sky-500/25 bg-gradient-to-b from-sky-500/[0.08] to-transparent p-3">
          <div className="flex items-center gap-2">
            <Wind className="h-4 w-4 text-sky-400" />
            <span className="text-[11px] font-bold tracking-wide">Spread forecast</span>
            <span className="ml-auto font-mono text-[11px] text-sky-400">
              {fire.spread_compass}
              {fire.wind_kmh != null && ` · ${Math.round(fire.wind_kmh)} km/h`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* wind rose — arrow points where the fire is being pushed */}
            <div className="relative h-14 w-14 shrink-0">
              <div className="absolute inset-0 rounded-full border border-dashed border-sky-500/30" />
              <div className="absolute left-1/2 top-0.5 -translate-x-1/2 font-mono text-[8px] text-muted-foreground/70">N</div>
              <div
                className="absolute left-1/2 top-1/2"
                style={{ transform: `translate(-50%,-50%) rotate(${fire.spread_deg ?? 0}deg)` }}
              >
                <Navigation className="h-5 w-5 fill-sky-400 text-sky-400" style={{ filter: "drop-shadow(0 0 5px rgba(56,189,248,0.6))" }} />
              </div>
            </div>
            <p className="text-[12.5px] leading-snug text-foreground/85">
              Wind is pushing the fire <b className="text-[#ffd9a8]">{fire.spread_compass}</b>
              {fire.downwind_place ? (
                <> toward <b className="text-[#ffd9a8]">{fire.downwind_place}</b>, ~12 km downwind.</>
              ) : (
                <>.</>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3 text-[11px] text-muted-foreground">
          Wind data unavailable — spread direction not forecast.
        </div>
      )}

      {/* last pass + source */}
      <div className="flex items-center gap-2 border-t border-foreground/10 pt-2.5 text-[11px] text-muted-foreground">
        <Satellite className="h-3.5 w-3.5 text-orange-400/70" />
        <span>
          Last pass <span className="text-foreground/80">{fire.last_satellite}</span> · {ago(fire.last_seen)}
        </span>
        {fire.high_conf > 0 && (
          <span className="ml-auto">
            <span className="text-emerald-400">{fire.high_conf}</span> high-conf
          </span>
        )}
      </div>
      <div className="-mt-1 text-[10px] leading-relaxed text-muted-foreground/60">
        NASA FIRMS (VIIRS 375 m). Satellite detections, not verified perimeters. Spread modelled from live wind.
      </div>
    </div>
  );
}
