import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Cctv,
  Compass,
  RefreshCw,
  Crosshair,
  MapPin,
  Maximize2,
  X,
  Sparkles,
  Loader2,
  LayoutGrid,
} from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { useCameraAnalysis } from "@/hooks/useCameraAnalysis";
import { CameraCreditRow, CameraFreshness, CameraWatermark } from "./CameraCredit";
import { cn } from "@/lib/utils";
import type { Camera, CameraAnalysis } from "@/types";

const CONGESTION: Record<CameraAnalysis["congestion"], { label: string; cls: string }> = {
  clear: { label: "Clear", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  light: { label: "Light", cls: "border-lime-500/40 bg-lime-500/10 text-lime-400" },
  moderate: { label: "Moderate", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  heavy: { label: "Heavy", cls: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
  jam: { label: "Jam", cls: "border-red-500/40 bg-red-500/10 text-red-400" },
};

const TYPES: [keyof CameraAnalysis, string][] = [
  ["cars", "🚗"],
  ["buses", "🚌"],
  ["trucks", "🚚"],
  ["motorcycles", "🏍️"],
  ["cyclists", "🚲"],
  ["pedestrians", "🚶"],
];

interface CameraViewProps {
  chrome: PanelChrome;
  camera: Camera;
  onZoomTo: () => void;
  inWall: boolean;
  onAddToWall: () => void;
}

const REFRESH_MS = 90_000; // TfL refreshes clips every few minutes; Scotland stills every 5–10 (ETag → 304)

export function CameraView({
  chrome,
  camera,
  onZoomTo,
  inWall,
  onAddToWall,
}: CameraViewProps) {
  // Bump a key periodically to re-pull the (in-place-updated) media from S3.
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRefreshKey((k) => k + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Fall back from the clip to the still if the video won't play; reset per camera.
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => setVideoFailed(false), [camera.id]);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [camera.id]);

  const analysis = useCameraAnalysis(camera.id);

  const media = (
    <CameraMedia
      camera={camera}
      refreshKey={refreshKey}
      videoFailed={videoFailed}
      onVideoError={() => setVideoFailed(true)}
    />
  );

  return (
    <>
      <FloatingPanel title={camera.name ?? "Traffic camera"} icon={Cctv} width={360} {...chrome}>
        <div className="space-y-3 p-4">
          {/* Click the media to open a larger (non-fullscreen) view. */}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Enlarge camera"
            className="group relative block aspect-video w-full cursor-zoom-in overflow-hidden rounded-lg border border-foreground/5"
          >
            {media}
            <div className="pointer-events-none absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </div>
          </button>

          {/* Meta + actions */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {camera.view && (
              <span className="flex items-center gap-1">
                <Compass className="h-3.5 w-3.5" />
                Facing {camera.view.toLowerCase()}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Hint label={inWall ? "In camera wall" : "Add to camera wall"} side="top">
                <button
                  aria-label="Add to camera wall"
                  onClick={onAddToWall}
                  disabled={inWall}
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-md transition-colors",
                    inWall
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </Hint>
              <Hint label="Refresh" side="top">
                <button
                  aria-label="Refresh camera"
                  onClick={() => setRefreshKey((k) => k + 1)}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </Hint>
              <Hint label="Zoom to camera" side="top">
                <button
                  aria-label="Zoom to camera"
                  onClick={onZoomTo}
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
              </Hint>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              Position
            </span>
            <span className="font-mono">
              {camera.lat.toFixed(4)}, {camera.lon.toFixed(4)}
            </span>
          </div>

          <CameraCreditRow camera={camera} />

          {/* AI scene analysis (aggregate + anonymous — no plate/individual ID) */}
          {camera.available && (
            <>
              {!analysis.data && !analysis.loading && !analysis.error && (
                <button
                  onClick={analysis.run}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Analyze scene with AI
                </button>
              )}

              {analysis.loading && (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-foreground/5 bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analyzing the scene…
                </div>
              )}

              {analysis.error && (
                <div className="space-y-1.5">
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-400">
                    {analysis.error}
                  </div>
                  <button
                    onClick={analysis.run}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Try again
                  </button>
                </div>
              )}

              {analysis.data && (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-primary" />
                      Scene analysis
                    </span>
                    <span
                      className={cn(
                        "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        CONGESTION[analysis.data.congestion].cls,
                      )}
                    >
                      {CONGESTION[analysis.data.congestion].label}
                    </span>
                  </div>
                  <p className="text-xs leading-snug text-foreground/90">
                    {analysis.data.summary}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {TYPES.filter(([k]) => (analysis.data![k] as number) > 0).map(
                      ([k, emoji]) => (
                        <span
                          key={k}
                          className="flex items-center gap-1 rounded-md bg-foreground/5 px-1.5 py-0.5 text-[11px] tabular-nums"
                          title={k}
                        >
                          <span>{emoji}</span>
                          {analysis.data![k] as number}
                        </span>
                      ),
                    )}
                    {TYPES.every(([k]) => (analysis.data![k] as number) === 0) && (
                      <span className="text-[11px] text-muted-foreground">
                        No road users detected
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
                    <Sparkles className="h-2.5 w-2.5" />
                    Claude vision · aggregate only, no identification
                    <button
                      onClick={analysis.run}
                      className="ml-auto text-primary/80 hover:underline"
                    >
                      Re-analyze
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </FloatingPanel>

      {/* Enlarged view — a centered, dimmed modal (not fullscreen). */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          aria-describedby={undefined}
          className="glass max-w-[900px] overflow-hidden rounded-xl p-0"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
              <Cctv className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">{camera.name ?? "Traffic camera"}</span>
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-1">
              {camera.view && (
                <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Compass className="h-3.5 w-3.5" />
                  Facing {camera.view.toLowerCase()}
                </span>
              )}
              <button
                aria-label="Refresh camera"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                aria-label="Close"
                onClick={() => setExpanded(false)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="aspect-video w-full bg-black">{media}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The live media surface (clip → still fallback → offline), shared by the panel
 *  and the enlarged dialog so both stay perfectly in sync. */
function CameraMedia({
  camera,
  refreshKey,
  videoFailed,
  onVideoError,
}: {
  camera: Camera;
  refreshKey: number;
  videoFailed: boolean;
  onVideoError: () => void;
}): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bust = (url: string) =>
    `${url}${url.includes("?") ? "&" : "?"}_=${refreshKey}`;
  const canVideo = camera.available && !!camera.video && !videoFailed;

  // Point the (stable) <video> at the current clip via a ref rather than
  // remounting it on every refresh — remounting churns decoders and leaks.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !canVideo || !camera.video) return;
    v.src = bust(camera.video);
    v.load();
    v.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.id, camera.video, refreshKey, canVideo]);

  // Release the media on unmount — otherwise Chrome keeps the (large) video
  // decode buffers alive and closing the panel never reclaims the memory.
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v) return;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-black">
      {!camera.available ? (
        <div className="grid h-full place-items-center text-[11px] text-muted-foreground">
          Camera offline
        </div>
      ) : canVideo ? (
        <video
          ref={videoRef}
          poster={camera.image}
          preload="metadata"
          muted
          loop
          playsInline
          onError={onVideoError}
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={bust(camera.image)}
          alt={camera.name ?? "Traffic camera"}
          className="h-full w-full object-cover"
        />
      )}

      {camera.available && <CameraFreshness camera={camera} />}
      <CameraWatermark camera={camera} />
    </div>
  );
}
