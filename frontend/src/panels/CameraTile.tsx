import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { compassLabel } from "@/lib/compass";
import { cn } from "@/lib/utils";
import type { Camera } from "@/types";

const STAGGER_MS = 150; // offset each tile's first load so decoders don't spike
const LIVE_REFRESH_MS = 150_000; // periodically re-pull the clip for freshness
const STILL_REFRESH_MS = 20_000;

/**
 * One managed tile in the Camera Wall. Follows the jamcams.co.uk pattern so a
 * 12-up grid doesn't degrade performance:
 *   - <video preload="metadata"> with the src set lazily
 *   - an IntersectionObserver plays a tile only while it's visible and pauses it
 *     when scrolled out
 *   - the first load is staggered per tile, and the media is fully released
 *     (pause + clear src + load) on hide/unmount
 * "Stills" mode swaps to an auto-refreshing JPEG — near-zero decode cost.
 */
export function CameraTile({
  camera,
  mode,
  index,
  isNext = false,
  onRemove,
  onFocus,
}: {
  camera: Camera;
  mode: "live" | "stills";
  index: number;
  isNext?: boolean;
  onRemove: () => void;
  onFocus: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stillKey, setStillKey] = useState(0);

  useEffect(() => {
    if (mode !== "live" || !camera.available || !camera.video) return;
    const v = videoRef.current;
    const wrap = wrapRef.current;
    if (!v || !wrap) return;

    let visible = true;
    const reload = () => {
      v.src = `${camera.video}?_=${Date.now()}`;
      v.load();
      if (visible) v.play().catch(() => {});
    };
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e?.isIntersecting ?? true;
        if (!visible) v.pause();
        else if (v.src) v.play().catch(() => {});
        else reload();
      },
      { threshold: 0.1 },
    );
    io.observe(wrap);
    const start = setTimeout(reload, index * STAGGER_MS);
    const refresh = setInterval(reload, LIVE_REFRESH_MS + index * 4000);

    return () => {
      clearTimeout(start);
      clearInterval(refresh);
      io.disconnect();
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    // `index` is only for stagger timing (captured on mount) — it must NOT be a
    // dependency, or reordering the wall (e.g. bus-follow) reloads the video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, camera.id, camera.video, camera.available]);

  useEffect(() => {
    if (mode !== "stills") return;
    const id = setInterval(
      () => setStillKey((k) => k + 1),
      STILL_REFRESH_MS + index * 1500,
    );
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div
      ref={wrapRef}
      className={cn(
        "group relative h-full w-full overflow-hidden rounded-lg border bg-black",
        isNext ? "border-cyan-400 ring-2 ring-cyan-400/60" : "border-foreground/10",
      )}
    >
      {!camera.available ? (
        <div className="grid h-full place-items-center text-[10px] text-muted-foreground">
          Offline
        </div>
      ) : mode === "live" ? (
        <video
          ref={videoRef}
          poster={camera.image}
          preload="metadata"
          muted
          loop
          playsInline
          onClick={onFocus}
          className="h-full w-full cursor-zoom-in object-cover"
        />
      ) : (
        <img
          src={`${camera.image}?_=${stillKey}`}
          alt={camera.name ?? "Traffic camera"}
          onClick={onFocus}
          className="h-full w-full cursor-zoom-in object-cover"
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1 pt-4 text-[10px] font-medium text-white">
        <span className="min-w-0 flex-1 truncate">{camera.name ?? "Camera"}</span>
        {compassLabel(camera.view) && (
          <span className="shrink-0 rounded bg-white/20 px-1 text-[9px] font-semibold">
            {compassLabel(camera.view)}
          </span>
        )}
      </div>

      {camera.available && mode === "live" && (
        <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          <span className="relative flex h-1 w-1">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex h-1 w-1 rounded-full bg-red-500" />
          </span>
          Live
        </div>
      )}

      {isNext && (
        <div className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 animate-pulse rounded-full bg-cyan-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black shadow">
          Next
        </div>
      )}

      <button
        onClick={onRemove}
        aria-label="Remove from wall"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/70 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
