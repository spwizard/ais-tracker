import {
  Hexagon,
  Eye,
  EyeOff,
  Crosshair,
  Trash2,
  LogIn,
  LogOut,
  Timer,
  Gauge,
  WifiOff,
} from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { Hint } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  FENCE_CATEGORIES,
  type Geofence,
  type FenceTrigger,
  type TriggerKind,
} from "@/geofence/types";
import type { GeofenceEvent } from "@/types";

const CATEGORY_LABEL = new Map(FENCE_CATEGORIES.map((c) => [c.key, c.label]));

const EVENT_META = {
  enter: { icon: LogIn, color: "text-emerald-400", verb: "entered" },
  exit: { icon: LogOut, color: "text-amber-400", verb: "left" },
  dwell: { icon: Timer, color: "text-sky-400", verb: "dwelling in" },
  speed: { icon: Gauge, color: "text-violet-400", verb: "speeding in" },
  dark: { icon: WifiOff, color: "text-rose-400", verb: "went dark in" },
} as const;

function agoLabel(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

interface ZonesPanelProps {
  chrome: PanelChrome;
  fences: Geofence[];
  counts: Record<string, number>;
  selectedId: string | null;
  events: GeofenceEvent[];
  onSelect: (id: string) => void;
  onSetVisible: (id: string, v: boolean) => void;
  onRename: (id: string, name: string) => void;
  onSetTriggers: (id: string, triggers: FenceTrigger[]) => void;
  onZoom: (id: string) => void;
  onRemove: (id: string) => void;
  onEventClick: (e: GeofenceEvent) => void;
}

export function ZonesPanel({
  chrome,
  fences,
  counts,
  selectedId,
  events,
  onSelect,
  onSetVisible,
  onRename,
  onSetTriggers,
  onZoom,
  onRemove,
  onEventClick,
}: ZonesPanelProps) {
  return (
    <FloatingPanel title="Zones & geofences" icon={Hexagon} width={288} {...chrome}>
      <div className="p-2">
        {fences.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground">
            No zones yet.
            <br />
            Use the <span className="text-foreground">Draw</span> tools at the bottom
            to add a geofence.
          </p>
        ) : (
          <ul className="space-y-1">
            {fences.map((f) => {
              const n = counts[f.id] ?? 0;
              const selected = f.id === selectedId;
              return (
                <li
                  key={f.id}
                  className={cn(
                    "rounded-lg transition-colors",
                    selected ? "bg-foreground/10" : "hover:bg-foreground/5",
                  )}
                >
                  <div
                    onClick={() => onSelect(f.id)}
                    className="group flex cursor-pointer items-center gap-2 px-2 py-1.5"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-foreground/20"
                      style={{ background: f.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        value={f.name}
                        onChange={(e) => onRename(f.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full truncate border-0 bg-transparent p-0 text-sm font-medium outline-none focus:text-primary"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        {CATEGORY_LABEL.get(f.category)} · {f.shape}
                      </div>
                    </div>

                    {n > 0 && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                        style={{ background: `${f.color}22`, color: f.color }}
                      >
                        {n} inside
                      </span>
                    )}

                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <RowBtn
                        label={f.visible ? "Hide" : "Show"}
                        onClick={() => onSetVisible(f.id, !f.visible)}
                      >
                        {f.visible ? (
                          <Eye className="h-3.5 w-3.5" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                      </RowBtn>
                      <RowBtn label="Zoom to zone" onClick={() => onZoom(f.id)}>
                        <Crosshair className="h-3.5 w-3.5" />
                      </RowBtn>
                      <RowBtn label="Delete" danger onClick={() => onRemove(f.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </RowBtn>
                    </div>
                  </div>

                  {selected && (
                    <TriggerConfig fence={f} onSetTriggers={onSetTriggers} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Live event feed (backend enter/exit/dwell) */}
      {events.length > 0 && (
        <div className="border-t border-foreground/5">
          <div className="px-3 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent events
          </div>
          <ul className="panel-scroll max-h-40 space-y-0.5 overflow-y-auto p-1.5">
            {events.slice(0, 25).map((e, i) => {
              const m = EVENT_META[e.event];
              const Icon = m.icon;
              return (
                <li
                  key={`${e.ts}-${e.mmsi}-${e.fence_id}-${i}`}
                  onClick={() => onEventClick(e)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-foreground/5"
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", m.color)} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{e.name ?? e.mmsi}</span>{" "}
                    <span className="text-muted-foreground">{m.verb}</span>{" "}
                    <span style={{ color: e.color }}>{e.fence_name}</span>
                  </span>
                  <time className="shrink-0 tabular-nums text-muted-foreground/70">
                    {agoLabel(e.ts)}
                  </time>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </FloatingPanel>
  );
}

// --- per-fence trigger configuration ----------------------------------------

const TRIGGERS: { kind: TriggerKind; label: string }[] = [
  { kind: "enter", label: "Entry alert" },
  { kind: "exit", label: "Exit alert" },
  { kind: "dwell", label: "Dwell alert" },
  { kind: "speed", label: "Speed alert" },
  { kind: "dark", label: "AIS-dark alert" },
];

const TRIGGER_DEFAULTS: Record<string, Partial<FenceTrigger>> = {
  dwell: { dwellSec: 600 },
  speed: { speedOp: "over", speedKn: 10 },
  dark: { darkSec: 180 },
};

function TriggerConfig({
  fence,
  onSetTriggers,
}: {
  fence: Geofence;
  onSetTriggers: (id: string, triggers: FenceTrigger[]) => void;
}) {
  const trig = (k: TriggerKind) => fence.triggers.find((t) => t.on === k);
  const has = (k: TriggerKind) => fence.triggers.some((t) => t.on === k);

  const toggle = (k: TriggerKind) => {
    const next = has(k)
      ? fence.triggers.filter((t) => t.on !== k)
      : [...fence.triggers, { on: k, ...TRIGGER_DEFAULTS[k] }];
    onSetTriggers(fence.id, next);
  };

  const patch = (k: TriggerKind, p: Partial<FenceTrigger>) =>
    onSetTriggers(
      fence.id,
      fence.triggers.map((t) => (t.on === k ? { ...t, ...p } : t)),
    );

  const speed = trig("speed");
  const dark = trig("dark");

  return (
    <div className="space-y-1.5 border-t border-foreground/5 px-3 py-2">
      {TRIGGERS.map((t) => (
        <div key={t.kind}>
          <label className="flex cursor-pointer items-center justify-between">
            <span className="text-xs text-muted-foreground">{t.label}</span>
            <Switch checked={has(t.kind)} onCheckedChange={() => toggle(t.kind)} />
          </label>

          {t.kind === "dwell" && has("dwell") && (
            <Sub>
              <span>after</span>
              <Input
                type="number"
                min={1}
                value={Math.round((trig("dwell")?.dwellSec ?? 600) / 60)}
                onChange={(e) => patch("dwell", { dwellSec: Math.max(1, Number(e.target.value)) * 60 })}
                className="h-7 w-16 text-xs"
              />
              <span>minutes</span>
            </Sub>
          )}

          {t.kind === "speed" && speed && (
            <Sub>
              <div className="flex overflow-hidden rounded-md border border-foreground/10">
                {(["over", "under"] as const).map((op) => (
                  <button
                    key={op}
                    onClick={() => patch("speed", { speedOp: op })}
                    className={cn(
                      "px-2 py-0.5 text-[11px] capitalize transition-colors",
                      (speed.speedOp ?? "over") === op
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-foreground/10",
                    )}
                  >
                    {op}
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={speed.speedKn ?? 10}
                onChange={(e) => patch("speed", { speedKn: Math.max(0, Number(e.target.value)) })}
                className="h-7 w-16 text-xs"
              />
              <span>kn</span>
            </Sub>
          )}

          {t.kind === "dark" && dark && (
            <Sub>
              <span>silent for</span>
              <Input
                type="number"
                min={1}
                value={Math.round((dark.darkSec ?? 180) / 60)}
                onChange={(e) => patch("dark", { darkSec: Math.max(1, Number(e.target.value)) * 60 })}
                className="h-7 w-16 text-xs"
              />
              <span>min</span>
            </Sub>
          )}
        </div>
      ))}
    </div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function RowBtn({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="top">
      <button
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10",
          danger ? "hover:text-rose-400" : "hover:text-foreground",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}
