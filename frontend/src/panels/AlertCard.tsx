import { AlertTriangle, X, ChevronLeft, ChevronRight, Ship, Clock, MapPin } from "lucide-react";
import type { Alert } from "@/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = {
  rendezvous: "Rendezvous",
  spoof: "Position jump / spoof",
  enter: "Zone entry",
  exit: "Zone exit",
  dwell: "Loitering",
  speed: "Speeding",
  dark: "Went dark",
};

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Human one-liner describing what the alert actually was. */
function describe(a: Alert): string {
  const d = a.detail ?? {};
  if (a.kind === "rendezvous") {
    const other = a.name_b ?? (a.mmsi_b != null ? `MMSI ${a.mmsi_b}` : "another vessel");
    return d.dist_nm != null ? `Met ${other} · ${d.dist_nm} nm apart` : `Met ${other}`;
  }
  if (a.kind === "spoof") {
    return d.jump_nm != null
      ? `Jumped ${d.jump_nm} nm in ${d.gap_sec ?? "?"}s`
      : "Implausible position jump";
  }
  // geofence events
  const verb: Record<string, string> = {
    enter: "Entered",
    exit: "Left",
    dwell: "Loitering in",
    speed: "Speeding in",
    dark: "Went dark in",
  };
  const zone = a.fence_name ?? "a zone";
  return `${verb[a.kind] ?? a.kind} ${zone}`;
}

/** Floating card for an alert clicked in the replay view. When several alerts sit
 *  on the same spot (e.g. one geofence firing repeatedly), pages through them. */
export function AlertCard({
  alerts,
  index,
  onIndex,
  onSelectVessel,
  onClose,
}: {
  alerts: Alert[];
  index: number;
  onIndex: (i: number) => void;
  onSelectVessel: (mmsi: number) => void;
  onClose: () => void;
}) {
  const a = alerts[index];
  if (!a) return null;
  const title = a.title ?? KIND_LABEL[a.kind] ?? a.kind;
  const many = alerts.length > 1;

  const VesselRow = ({ mmsi, name }: { mmsi: number | null; name: string | null }) =>
    mmsi == null ? null : (
      <button
        onClick={() => onSelectVessel(mmsi)}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-foreground/10"
        title="Show this vessel's route"
      >
        <Ship className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium text-foreground/90">{name ?? `MMSI ${mmsi}`}</span>
        <span className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground">{mmsi}</span>
      </button>
    );

  return (
    <div className="glass pointer-events-auto absolute bottom-20 left-1/2 z-40 w-[300px] -translate-x-1/2 rounded-xl p-3 animate-fade-in">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#facc15]/15">
          <AlertTriangle className="h-3.5 w-3.5 text-[#facc15]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          <div className="text-[11px] capitalize text-muted-foreground">{a.category} alert</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="mb-2 text-xs leading-snug text-foreground/80">{describe(a)}</p>

      <div className="space-y-0.5">
        <VesselRow mmsi={a.mmsi} name={a.name} />
        {a.kind === "rendezvous" && <VesselRow mmsi={a.mmsi_b} name={a.name_b} />}
      </div>

      <div className="mt-2 flex items-center gap-1.5 border-t border-foreground/10 pt-2 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" />
        <span className="tabular-nums">{fmtTime(a.ts)}</span>
        {a.lat != null && a.lon != null && (
          <>
            <MapPin className="ml-1 h-3 w-3 shrink-0" />
            <span className="tabular-nums">
              {a.lat.toFixed(3)}, {a.lon.toFixed(3)}
            </span>
          </>
        )}
      </div>

      {many && (
        <div className="mt-2 flex items-center justify-between border-t border-foreground/10 pt-2">
          <button
            onClick={() => onIndex((index - 1 + alerts.length) % alerts.length)}
            className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            aria-label="Previous alert"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {index + 1} of {alerts.length} here
          </span>
          <button
            onClick={() => onIndex((index + 1) % alerts.length)}
            className={cn(
              "grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
            )}
            aria-label="Next alert"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
