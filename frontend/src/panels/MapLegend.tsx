import type { ReactNode } from "react";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { WIND_SPEED_PALETTE, WAVE_HEIGHT_PALETTE, HEAT_COLOR_RANGE } from "@/map/layers";

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
  flaggedCount,
  hasSelection,
}: {
  showWind: boolean;
  windAvailable: boolean;
  showWaves: boolean;
  wavesAvailable: boolean;
  densityMode: boolean;
  flaggedCount: number;
  hasSelection: boolean;
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

  // Vessel icons are visible whenever we're not in the (icon-hiding) density view.
  if (!densityMode) {
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

  if (flaggedCount > 0 || hasSelection) {
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
