import { useEffect, useRef, useState } from "react";
import { Play, Pause, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Floating scrubber over the historical traffic-density buckets. `onSelect`
 *  gets a bucket epoch-second (view that hour's heatmap) or null (back to live). */
export function DensityTimeline({
  buckets,
  onSelect,
}: {
  buckets: number[];
  onSelect: (ts: number | null) => void;
}) {
  const [idx, setIdx] = useState<number | null>(null); // null = live
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const select = (i: number | null) => {
    setIdx(i);
    onSelect(i == null ? null : buckets[i]);
  };

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setIdx((cur) => {
        const next = cur == null ? 0 : cur + 1;
        if (next >= buckets.length) {
          onSelect(null);
          setPlaying(false);
          return null;
        }
        onSelect(buckets[next]);
        return next;
      });
    }, 1200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, buckets, onSelect]);

  if (buckets.length === 0) return null;
  const live = idx == null;

  return (
    <div className="glass pointer-events-auto absolute bottom-4 left-1/2 z-40 flex w-[min(560px,90vw)] -translate-x-1/2 items-center gap-2.5 rounded-xl px-3 py-2">
      <button
        onClick={() => {
          setPlaying(false);
          select(null);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
          live
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Radio className="h-3.5 w-3.5" />
        Live
      </button>
      <button
        onClick={() => setPlaying((p) => !p)}
        disabled={buckets.length < 2}
        aria-label={playing ? "Pause" : "Play"}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-30"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <input
        type="range"
        min={0}
        max={buckets.length - 1}
        value={idx ?? buckets.length - 1}
        onChange={(e) => {
          setPlaying(false);
          select(Number(e.target.value));
        }}
        className="h-1 flex-1 cursor-pointer accent-primary"
      />
      <span className="w-[88px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {live ? "Live" : fmt(buckets[idx])}
      </span>
    </div>
  );
}
