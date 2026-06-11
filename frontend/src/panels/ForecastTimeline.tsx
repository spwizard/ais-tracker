import { useEffect, useRef, useState } from "react";
import { Play, Pause, Radio, CloudSun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForecastStep } from "@/types";

function fmtValid(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Scrubber over the GFS forecast hours. Drives the wind + wave layers together.
 *  `value` is the selected forecast hour; `onChange` gets a step's hour. */
export function ForecastTimeline({
  steps,
  value,
  onChange,
  raised,
}: {
  steps: ForecastStep[];
  value: number;
  onChange: (hour: number) => void;
  raised: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const idx = Math.max(
    0,
    steps.findIndex((s) => s.step === value),
  );
  const live = value === 0;

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      const cur = steps.findIndex((s) => s.step === value);
      const next = cur + 1 >= steps.length ? 0 : cur + 1;
      onChange(steps[next].step);
    }, 1100);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, steps, value, onChange]);

  if (steps.length < 2) return null;
  const cur = steps[idx];

  return (
    <div
      className={cn(
        "glass pointer-events-auto absolute left-1/2 z-40 flex w-[min(580px,92vw)] -translate-x-1/2 items-center gap-2.5 rounded-xl px-3 py-2",
        raised ? "bottom-[4.75rem]" : "bottom-4",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-primary/90">
        <CloudSun className="h-4 w-4" />
        Forecast
      </span>
      <button
        onClick={() => {
          setPlaying(false);
          onChange(0);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
          live
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Radio className="h-3.5 w-3.5" />
        Now
      </button>
      <button
        onClick={() => setPlaying((p) => !p)}
        aria-label={playing ? "Pause" : "Play"}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={steps.length - 1}
        value={idx}
        onChange={(e) => {
          setPlaying(false);
          onChange(steps[Number(e.target.value)].step);
        }}
        className="h-1 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-[112px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {live ? "Now" : `+${cur.step}h`}
        <span className="ml-1 text-foreground/70">{fmtValid(cur.valid)}</span>
      </span>
    </div>
  );
}
