import { Play, Pause, Radio, History, Ship } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrailMode, ColorMode } from "@/map/replayLayers";

const SPEEDS = [1, 10, 60, 300];
const COLOR_MODES: { key: ColorMode; label: string }[] = [
  { key: "speed", label: "Spd" },
  { key: "type", label: "Type" },
  { key: "mono", label: "Mono" },
];

function fmtClock(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSpeed(s: number): string {
  return s >= 60 ? `${s / 60}m/s` : `${s}×`;
}

/** Scrubber for vessel-movement replay. Drives the map's replay clock via
 *  `onSeek` (imperative seek on the MapHandle) and reflects the live scrub time
 *  reported back through `currentTime`. Modeled on the density timeline. */
export function ReplayTimeline({
  range,
  currentTime,
  playing,
  onTogglePlaying,
  speed,
  onSpeed,
  trailMode,
  onTrailMode,
  colorMode,
  onColorMode,
  movingOnly,
  onMovingOnly,
  onSeek,
  onExit,
  loading,
  trackCount,
}: {
  range: { start: number; end: number };
  currentTime: number;
  playing: boolean;
  onTogglePlaying: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  trailMode: TrailMode;
  onTrailMode: (m: TrailMode) => void;
  colorMode: ColorMode;
  onColorMode: (m: ColorMode) => void;
  movingOnly: boolean;
  onMovingOnly: (v: boolean) => void;
  onSeek: (t: number) => void;
  onExit: () => void;
  loading?: boolean;
  trackCount?: number;
}) {
  const t = Math.min(range.end, Math.max(range.start, currentTime));

  return (
    <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-40 flex w-[min(900px,96vw)] -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-2">
      <button
        onClick={onExit}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        title="Back to live"
      >
        <Radio className="h-3.5 w-3.5" />
        Live
      </button>

      <button
        onClick={onTogglePlaying}
        aria-label={playing ? "Pause" : "Play"}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>

      <input
        type="range"
        min={range.start}
        max={range.end}
        step={1}
        value={t}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-primary"
      />

      <span className="w-[104px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {fmtClock(t)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-foreground/5 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors",
              s === speed
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {fmtSpeed(s)}
          </button>
        ))}
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5 rounded-md bg-foreground/5 p-0.5"
        title="Full = keep the whole route on screen; Comet = a fading tail"
      >
        {(["full", "comet"] as TrailMode[]).map((m) => (
          <button
            key={m}
            onClick={() => onTrailMode(m)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium capitalize transition-colors",
              m === trailMode
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5 rounded-md bg-foreground/5 p-0.5"
        title="Colour routes by speed, ship type, or a single tone"
      >
        {COLOR_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => onColorMode(m.key)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              m.key === colorMode
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button
        onClick={() => onMovingOnly(!movingOnly)}
        title="Show only vessels that are under way"
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors",
          movingOnly
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Ship className="h-3.5 w-3.5" />
      </button>

      <span className="flex w-[46px] shrink-0 items-center justify-end gap-1 text-[10px] text-muted-foreground/70">
        <History className="h-3 w-3" />
        {loading ? "…" : (trackCount ?? 0)}
      </span>
    </div>
  );
}
