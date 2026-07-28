import type { ReactNode } from "react";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { WIND_SPEED_PALETTE, WAVE_HEIGHT_PALETTE, HEAT_COLOR_RANGE } from "@/map/layers";
import { SPEED_RAMP, SPEED_MAX_KN, type ColorMode } from "@/map/replayLayers";
import { TUBE_LINE_LEGEND } from "@/map/tubeLayers";

const MS_TO_KN = 1.94384;

// Build CSS gradients once from the same palettes the map layers use, so the
// legend can never drift from what's actually drawn.
const WIND_GRADIENT = WIND_SPEED_PALETTE.map(
  ([, [r, g, b]], i) =>
    `rgb(${r},${g},${b}) ${Math.round((i / (WIND_SPEED_PALETTE.length - 1)) * 100)}%`,
).join(", ");
const WIND_MAX_KN = Math.round(WIND_SPEED_PALETTE[WIND_SPEED_PALETTE.length - 1][0] * MS_TO_KN);
const WAVE_GRADIENT = WAVE_HEIGHT_PALETTE.map(
  ([, [r, g, b]], i) =>
    `rgb(${r},${g},${b}) ${Math.round((i / (WAVE_HEIGHT_PALETTE.length - 1)) * 100)}%`,
).join(", ");
const HEAT_GRADIENT = HEAT_COLOR_RANGE.map(
  ([r, g, b], i) =>
    `rgb(${r},${g},${b}) ${Math.round((i / (HEAT_COLOR_RANGE.length - 1)) * 100)}%`,
).join(", ");
// Speed ramp keyed by actual knots so the gradient stops sit where the colours
// truly change (the ramp is non-linear), matching the replay lines exactly.
const SPEED_GRADIENT = SPEED_RAMP.map(
  ([kn, [r, g, b]]) => `rgb(${r},${g},${b}) ${Math.round((kn / SPEED_MAX_KN) * 100)}%`,
).join(", ");

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function Ramp({ gradient, ticks }: { gradient: string; ticks: string[] }) {
  return (
    <div className="space-y-1">
      <div
        className="h-2 w-full rounded-full"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <div className="flex justify-between text-[9px] tabular-nums text-muted-foreground">
        {ticks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * Contextual map key — only renders rows for layers that are currently visible.
 * Fixed bottom-left; collapses to nothing when no annotated layer is on.
 */
export function MapLegend({
  showWind,
  windAvailable,
  showWaves,
  wavesAvailable,
  densityMode,
  replayMode,
  replayColorMode,
  flaggedCount,
  hasSelection,
  showVessels,
  showTrains,
  showBuses,
  showTube,
  showHotspots,
}: {
  showWind: boolean;
  windAvailable: boolean;
  showWaves: boolean;
  wavesAvailable: boolean;
  densityMode: boolean;
  replayMode: boolean;
  replayColorMode: ColorMode;
  flaggedCount: number;
  hasSelection: boolean;
  /** Each domain's key only appears while its layer is actually visible. */
  showVessels: boolean;
  showTrains: boolean;
  showBuses: boolean;
  showTube: boolean;
  showHotspots: boolean;
}) {
  const wind = showWind && windAvailable;
  const waves = showWaves && wavesAvailable;
  const sections: ReactNode[] = [];

  if (wind) {
    sections.push(
      <Section key="wind" label="Wind speed">
        <Ramp
          gradient={WIND_GRADIENT}
          ticks={["calm", "~17", "~31", `${WIND_MAX_KN}+ kn`]}
        />
      </Section>,
    );
  }

  if (waves) {
    sections.push(
      <Section key="waves" label="Sea state (wave height)">
        <Ramp gradient={WAVE_GRADIENT} ticks={["calm", "2 m", "4 m", "9 m+"]} />
      </Section>,
    );
  }

  if (densityMode) {
    sections.push(
      <Section key="density" label="Traffic density">
        <Ramp gradient={HEAT_GRADIENT} ticks={["low", "high"]} />
      </Section>,
    );
  }

  // Replay colours lines + heads by speed, so show the speed key instead of type.
  if (replayMode) {
    const label =
      replayColorMode === "speed"
        ? "Vessel speed"
        : replayColorMode === "type"
          ? "Vessel type"
          : "Routes";
    sections.push(
      <Section key="replay" label={label}>
        {replayColorMode === "speed" && (
          <Ramp
            gradient={SPEED_GRADIENT}
            ticks={["stopped", "~9", "~17", `${SPEED_MAX_KN}+ kn`]}
          />
        )}
        {replayColorMode === "type" && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {SHIP_TYPE_GROUPS.map((g) => (
              <span key={g.key} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: g.color }}
                />
                <span className="truncate text-[11px] text-foreground/90">{g.label}</span>
              </span>
            ))}
          </div>
        )}
        {replayColorMode === "mono" && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 shrink-0 rounded-full bg-[#d2e1ff]" />
            <span className="text-[11px] text-foreground/90">Vessel route</span>
          </span>
        )}
        <span className="mt-1.5 flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#facc15] ring-2 ring-[#facc15]/40" />
          <span className="text-[11px] text-foreground/90">Alert event</span>
        </span>
      </Section>,
    );
  }

  // Vessel icons are visible whenever the layer is on and we're not in the
  // (icon-hiding) density view.
  if (showVessels && !densityMode && !replayMode) {
    sections.push(
      <Section key="vessels" label="Vessel type">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {SHIP_TYPE_GROUPS.map((g) => (
            <span key={g.key} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: g.color }}
              />
              <span className="truncate text-[11px] text-foreground/90">{g.label}</span>
            </span>
          ))}
        </div>
      </Section>,
    );
  }

  // Buses & coaches: operator colours (matches busLayers).
  if (showBuses && !replayMode) {
    sections.push(
      <Section key="buses" label="Buses & coaches">
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#e22d26]" />
            <span className="text-[11px] text-foreground/90">TfL bus</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#34d399]" />
            <span className="text-[11px] text-foreground/90">Ember coach</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#fbbf24]" />
            <span className="text-[11px] text-foreground/90">Other operator</span>
          </span>
        </div>
      </Section>,
    );
  }

  // Underground: official line colours; dimmed lines are disrupted.
  if (showTube && !replayMode) {
    sections.push(
      <Section key="tube" label="Underground lines">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {TUBE_LINE_LEGEND.map((l) => (
            <span key={l.id} className="flex items-center gap-1.5">
              <span
                className="h-[3px] w-4 shrink-0 rounded-full"
                style={{ background: `rgb(${l.color[0]},${l.color[1]},${l.color[2]})` }}
              />
              <span className="truncate text-[11px] text-foreground/90">{l.name}</span>
            </span>
          ))}
        </div>
        <span className="mt-1.5 flex items-center gap-1.5">
          <span className="h-[3px] w-4 shrink-0 rounded-full bg-foreground/25" />
          <span className="text-[11px] text-foreground/90">Dimmed = disruption</span>
        </span>
      </Section>,
    );
  }

  // Delay hotspots: a heat ramp + an explicit "live snapshot" note.
  if (showHotspots && !replayMode) {
    sections.push(
      <Section key="hotspots" label="Delay hotspots">
        <Ramp
          gradient={"rgb(70,30,14), rgb(200,70,30), rgb(252,176,64), rgb(255,230,150)"}
          ticks={["fewer", "more delay"]}
        />
        <span className="mt-1 block text-[10px] text-muted-foreground/70">
          Trains 5+ min late, right now · live
        </span>
      </Section>,
    );
  }

  // Live GB trains: punctuality colours + the station badge. Hidden while the
  // hotspot view owns the map.
  if (showTrains && !showHotspots && !replayMode) {
    sections.push(
      <Section key="trains" label="Trains (live GB rail)">
        <div className="space-y-1">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#34d399]" />
            <span className="text-[11px] text-foreground/90">On time</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#fbbf24]" />
            <span className="text-[11px] text-foreground/90">Running late</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#f43f5e]" />
            <span className="text-[11px] text-foreground/90">5+ min late</span>
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 62 39" className="h-2.5 w-4 shrink-0" aria-hidden>
              <g stroke="#e13237" fill="none">
                <path d="M1,-8.9 46,12.4 16,26.6 61,47.9" strokeWidth="6" />
                <path d="M0,12.4H62m0,14.2H0" strokeWidth="6.4" />
              </g>
            </svg>
            <span className="text-[11px] text-foreground/90">Station · click for board</span>
          </span>
        </div>
      </Section>,
    );
  }

  if (showVessels && (flaggedCount > 0 || hasSelection)) {
    sections.push(
      <Section key="markers" label="Markers">
        <div className="space-y-1">
          {flaggedCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-rose-500" />
              <span className="text-[11px] text-foreground/90">Sanctioned / flagged</span>
            </span>
          )}
          {hasSelection && (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[#3896ff]" />
              <span className="text-[11px] text-foreground/90">Selected vessel</span>
            </span>
          )}
        </div>
      </Section>,
    );
  }

  if (sections.length === 0) return null;

  return (
    <div className="glass pointer-events-auto absolute bottom-4 left-4 z-30 w-[188px] space-y-2.5 rounded-xl px-3 py-2.5 animate-fade-in">
      {sections}
    </div>
  );
}
