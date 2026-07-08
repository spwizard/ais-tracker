/**
 * Incident detail card — a compact popover for a clicked incident, with the
 * eyes-on-alert camera action when cameras are nearby (same as alert toasts).
 */
import { X, Cctv, AlertTriangle, ExternalLink, CheckCircle2, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { incidentTier, type Incident } from "@/types";

const SEV_STYLE: Record<string, string> = {
  serious: "bg-rose-500/15 text-rose-400",
  moderate: "bg-orange-500/15 text-orange-400",
  minor: "bg-amber-500/15 text-amber-400",
};

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function IncidentCard({
  incident,
  hasEyes,
  onEyes,
  onClose,
}: {
  incident: Incident;
  hasEyes: boolean;
  onEyes: () => void;
  onClose: () => void;
}) {
  return (
    <div className="glass pointer-events-auto absolute bottom-20 left-1/2 z-40 w-[320px] -translate-x-1/2 rounded-xl p-3 animate-fade-in">
      <div className="mb-2 flex items-start gap-2">
        <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", SEV_STYLE[incident.severity])}>
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{incident.title}</div>
          <div className="text-[11px] capitalize text-muted-foreground">
            {incident.severity} {incident.category} · {incident.confidence} · {ago(incident.ts)}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {incident.detail && (
        <p className="mb-2 text-xs leading-snug text-foreground/80">{incident.detail}</p>
      )}
      {incident.location && (
        <p className="mb-2 text-[11px] text-muted-foreground">{incident.location}</p>
      )}

      {/* Camera verification — the credibility line */}
      {incident.verification_note && (
        <div
          className={cn(
            "mb-2 flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-snug",
            incidentTier(incident) === "confirmed"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-foreground/5 text-muted-foreground",
          )}
        >
          {incidentTier(incident) === "confirmed" ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          ) : (
            <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>
            {incident.verification_note}
            {incident.verified_camera && (
              <span className="text-muted-foreground"> — via {incident.verified_camera}</span>
            )}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-foreground/10 pt-2">
        {hasEyes && (
          <button
            onClick={onEyes}
            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Cctv className="h-3.5 w-3.5" />
            Watch nearby cameras
          </button>
        )}
        {incident.url && (
          <a
            href={incident.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Source <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
