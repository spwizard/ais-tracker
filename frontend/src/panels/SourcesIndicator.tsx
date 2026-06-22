import { Antenna } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SourceStatus } from "@/types";

const SOURCE_LABELS: Record<string, string> = {
  aisstream: "AISStream · UK/Channel",
  digitraffic: "Digitraffic · Baltic",
  kystverket: "Kystverket · Norway",
};

/** A source counts as "live" only when actually receiving data — an open but
 *  silent socket (connected, not receiving) is stale, shown amber not green. */
function isLive(s: SourceStatus): boolean {
  return s.receiving ?? s.connected; // tolerate older payloads without `receiving`
}

/** Compact multi-source health pill with a per-source breakdown on hover. */
function sourceDotClass(s: SourceStatus): string {
  if (s.configured === false) return "bg-amber-400";
  if (isLive(s)) return "bg-emerald-400";
  if (s.connected) return "bg-amber-400"; // connected but no data flowing (stale)
  return "bg-rose-500";
}

function sourceDetail(s: SourceStatus): string {
  if (s.configured === false) return "API key not set";
  if (isLive(s)) return "Live";
  if (s.connected) return "Connected · no data";
  return "Disconnected";
}

export function SourcesIndicator({ sources }: { sources: SourceStatus[] }) {
  if (sources.length === 0) return null;
  const up = sources.filter(isLive).length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Live sources"
          className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-foreground/10"
        >
          <Antenna className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium tabular-nums">{up}</span>
          <div className="flex gap-0.5">
            {sources.map((s) => (
              <span
                key={s.name}
                className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(s))}
              />
            ))}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-56 p-0">
        <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {up} of {sources.length} live sources
        </div>
        <div className="space-y-0.5 px-1.5 pb-2">
          {sources.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-2 rounded-md px-1.5 py-1"
            >
              <span className="relative flex h-2 w-2">
                {isLive(s) && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                )}
                <span
                  className={cn("inline-flex h-2 w-2 rounded-full", sourceDotClass(s))}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">
                  {SOURCE_LABELS[s.name] ?? s.name}
                </div>
                {!isLive(s) && (
                  <div
                    className={cn(
                      "text-[10px]",
                      s.connected ? "text-amber-400/90" : "text-rose-400/90",
                    )}
                  >
                    {sourceDetail(s)}
                  </div>
                )}
              </div>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {s.messages_seen.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
