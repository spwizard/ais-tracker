import {
  Ship,
  Radio,
  Loader2,
  WifiOff,
  SlidersHorizontal,
  Activity,
  Layers,
  Hexagon,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/filters";
import { SourcesIndicator } from "@/panels/SourcesIndicator";
import type { PanelId } from "@/hooks/usePanels";
import type { Theme } from "@/hooks/useTheme";
import type { ConnectionStatus, SourceStatus } from "@/types";

interface TopBarProps {
  status: ConnectionStatus;
  total: number;
  visible: number;
  sources: SourceStatus[];
  statusFilter: StatusFilter;
  onStatusFilter: (s: StatusFilter) => void;
  panelOpen: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  hasSelection: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; dot: string; icon: LucideIcon }
> = {
  open: { label: "Live", dot: "bg-emerald-400", icon: Radio },
  connecting: { label: "Connecting", dot: "bg-amber-400", icon: Loader2 },
  closed: { label: "Offline", dot: "bg-rose-500", icon: WifiOff },
};

const DOCK: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: "filters", icon: SlidersHorizontal, label: "Filters" },
  { id: "stats", icon: Activity, label: "Statistics" },
  { id: "layers", icon: Layers, label: "Layers & regions" },
  { id: "zones", icon: Hexagon, label: "Zones & geofences" },
  { id: "detail", icon: Ship, label: "Vessel details" },
];

export function TopBar({
  status,
  total,
  visible,
  sources,
  statusFilter,
  onStatusFilter,
  panelOpen,
  onTogglePanel,
  hasSelection,
  theme,
  onToggleTheme,
}: TopBarProps) {
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;

  return (
    <header className="glass pointer-events-auto absolute left-1/2 top-4 z-40 flex h-12 -translate-x-1/2 items-center gap-2 px-2.5 animate-fade-in">
      {/* Brand */}
      <div className="flex items-center gap-2 pl-1">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Ship className="h-4 w-4" />
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-sm font-semibold tracking-tight">
            Maritime<span className="text-primary">·</span>Live
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="h-7" />

      {/* Segmented status filter */}
      <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.key}
            onClick={() => onStatusFilter(s.key)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === s.key
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-7" />

      {/* Connection + counts */}
      <div className="flex items-center gap-2 px-1">
        <span className="relative flex h-2 w-2">
          {status === "open" && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span className={cn("inline-flex h-2 w-2 rounded-full", meta.dot)} />
        </span>
        <span className="hidden items-center gap-1 text-xs font-medium text-muted-foreground md:flex">
          <StatusIcon
            className={cn("h-3 w-3", status === "connecting" && "animate-spin")}
          />
          {meta.label}
        </span>
        <span className="text-xs tabular-nums">
          <span className="font-semibold text-foreground">
            {visible.toLocaleString()}
          </span>
          <span className="text-muted-foreground">/{total.toLocaleString()}</span>
        </span>
      </div>

      <Separator orientation="vertical" className="hidden h-7 lg:block" />

      {/* Live-source health */}
      <div className="hidden lg:block">
        <SourcesIndicator sources={sources} />
      </div>

      <Separator orientation="vertical" className="h-7" />

      {/* Panel dock — reopen / toggle floating panels */}
      <div className="flex items-center gap-0.5 pr-0.5">
        {DOCK.map((d) => {
          const disabled = d.id === "detail" && !hasSelection;
          const active = panelOpen[d.id] && !disabled;
          const hint = disabled
            ? "Vessel details — select a vessel first"
            : `${active ? "Hide" : "Show"} ${d.label.toLowerCase()}`;
          return (
            <Hint key={d.id} label={hint} side="bottom">
              {/* Keep pointer events when disabled so the tooltip still shows. */}
              <button
                aria-label={d.label}
                aria-disabled={disabled}
                onClick={() => !disabled && onTogglePanel(d.id)}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg transition-colors",
                  disabled
                    ? "cursor-not-allowed text-muted-foreground/30"
                    : active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                )}
              >
                <d.icon className="h-4 w-4" />
              </button>
            </Hint>
          );
        })}

        <Separator orientation="vertical" className="mx-0.5 h-7" />

        <Hint label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} side="bottom">
          <button
            aria-label="Toggle theme"
            onClick={onToggleTheme}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </Hint>
      </div>
    </header>
  );
}
