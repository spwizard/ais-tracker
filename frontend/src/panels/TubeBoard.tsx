/**
 * Live tube departure board — the platform Departures screen for any station,
 * built from TfL StopPoint arrivals, line-coloured to match the map.
 */
import { RadioTower } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { tubeColor } from "@/map/tubeLayers";
import type { TubeBoard as Board } from "@/hooks/useTubeBoard";

function mins(tts: number | null): string {
  if (tts == null) return "";
  return tts < 60 ? "due" : `${Math.round(tts / 60)} min`;
}

export function TubeBoard({
  chrome,
  stationName,
  board,
}: {
  chrome: PanelChrome;
  stationName: string;
  board: Board | null;
}) {
  return (
    <FloatingPanel title="Tube departures" icon={RadioTower} width={340} {...chrome}>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight">
            {board?.station ?? stationName}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">live</span>
        </div>

        {board == null ? (
          <div className="py-8 text-center text-xs text-muted-foreground">Loading board…</div>
        ) : board.services.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No departures right now.</div>
        ) : (
          <div className="space-y-0.5">
            {board.services.map((s, i) => {
              const c = s.line ? tubeColor(s.line) : [148, 163, 184];
              return (
                <div key={i} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
                    title={s.line_name ?? ""}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm leading-tight">{s.to}</span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      {s.line_name}{s.platform ? ` · ${s.platform}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground/90">
                    {mins(s.tts)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
