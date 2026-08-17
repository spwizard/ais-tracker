/**
 * Operator credit for camera imagery — a licence condition for both feeds.
 * TfL only asks for a text credit; Traffic Scotland requires their logo plus a
 * link to traffic.gov.scot wherever a frame is shown, so the panel shows a
 * linked logo row and the media itself carries a small watermark.
 */
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Camera } from "@/types";
import { cn } from "@/lib/utils";

const SCOT_LOGO = "/traffic-scotland-logo.png";

/** Watermark inside the media surface (no links — the surface is a button). */
export function CameraWatermark({ camera, className }: { camera: Camera; className?: string }) {
  const [logoOk, setLogoOk] = useState(true);
  if (camera.provider === "scot" && logoOk) {
    return (
      <img
        src={SCOT_LOGO}
        alt="Traffic Scotland"
        onError={() => setLogoOk(false)}
        className={cn(
          "pointer-events-none absolute bottom-1 right-1.5 h-4 w-auto opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]",
          className,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-1 right-2 text-[9px] text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]",
        className,
      )}
    >
      {camera.attribution?.name ?? "Traffic camera"}
    </div>
  );
}

/** Linked credit line for the panel — "Images: <logo/name> ↗". */
export function CameraCreditRow({ camera }: { camera: Camera }) {
  const [logoOk, setLogoOk] = useState(true);
  const a = camera.attribution;
  if (!a) return null;
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <span>Images</span>
      {camera.provider === "scot" && logoOk ? (
        <img
          src={SCOT_LOGO}
          alt="Traffic Scotland"
          onError={() => setLogoOk(false)}
          className="h-3.5 w-auto"
        />
      ) : (
        <span className="font-medium">{a.name}</span>
      )}
      <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

/** "Live" pulse for clip feeds; a frame-age stamp for slow stills. */
export function CameraFreshness({
  camera,
  size = "md",
}: {
  camera: Camera;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  const base = cn(
    "pointer-events-none absolute flex items-center rounded-full bg-black/55 font-semibold uppercase tracking-wide text-white backdrop-blur-sm",
    sm ? "left-1.5 top-1.5 gap-1 px-1.5 py-0.5 text-[9px]" : "left-2 top-2 gap-1.5 px-2 py-0.5 text-[10px]",
  );
  if (camera.provider === "scot") {
    const age = frameAge(camera.updated);
    return (
      <div className={base}>
        <span className={cn("rounded-full bg-emerald-400", sm ? "h-1 w-1" : "h-1.5 w-1.5")} />
        {age ? `Still · ${age}` : "Still"}
      </div>
    );
  }
  return (
    <div className={base}>
      <span className={cn("relative flex", sm ? "h-1 w-1" : "h-1.5 w-1.5")}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className={cn("relative inline-flex rounded-full bg-red-500", sm ? "h-1 w-1" : "h-1.5 w-1.5")} />
      </span>
      Live
    </div>
  );
}

/** "just now" / "4 min" / "1 h" — how old the current still is. */
export function frameAge(updated: number | null | undefined): string | null {
  if (!updated) return null;
  const secs = Math.max(0, Date.now() / 1000 - updated);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  return `${Math.round(secs / 3600)} h`;
}
