import {
  Ship,
  Eye,
  Radio,
  Loader2,
  WifiOff,
  Search,
  SlidersHorizontal,
  Activity,
  Layers,
  Hexagon,
  Sparkles,
  Table2,
  Bell,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SourcesIndicator } from "@/panels/SourcesIndicator";
import type { PanelId } from "@/hooks/usePanels";
import type { Theme } from "@/hooks/useTheme";
import type { ConnectionStatus, SourceStatus } from "@/types";

/** Panels that drop from the island as a single shared dropdown surface. */
export type IslandPanel = "search" | "filters" | "alerts";

interface TopBarProps {
  status: ConnectionStatus;
  total: number;
  visible: number;
  sources: SourceStatus[];
  island: IslandPanel | null;
  onToggleIsland: (p: IslandPanel) => void;
  hasAlerts: boolean;
  filtersActive: boolean;
  panelOpen: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  hasSelection: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  dataTab: "vessels" | "alerts" | null;
  onOpenData: (tab: "vessels" | "alerts") => void;
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
  { id: "stats", icon: Activity, label: "Statistics" },
  { id: "layers", icon: Layers, label: "Layers & regions" },
  { id: "zones", icon: Hexagon, label: "Zones & geofences" },
  { id: "detail", icon: Ship, label: "Vessel details" },
  { id: "analyst", icon: Sparkles, label: "AI Analyst" },
];

export function TopBar({
  status,
  total,
  visible,
  sources,
  island,
  onToggleIsland,
  hasAlerts,
  filtersActive,
  panelOpen,
  onTogglePanel,
  hasSelection,
  theme,
  onToggleTheme,
  dataTab,
  onOpenData,
}: TopBarProps) {
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;

  return (
    <header
      data-island-bar
      className="glass pointer-events-auto absolute left-1/2 top-4 z-40 flex h-12 -translate-x-1/2 items-center gap-2 px-2.5 animate-fade-in"
    >
      {/* Brand */}
      <div className="flex items-center gap-2 pl-1">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Eye className="h-4 w-4" />
        </div>
        <div className="hidden leading-tight sm:block">
          <div className="text-sm font-semibold tracking-tight">
            Argus<span className="text-primary">·</span>Eyes
          </div>
          <div className="whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
            land · air · sea
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="h-7" />

      {/* Global search — opens the island search dropdown (⌘K) */}
      <button
        onClick={() => onToggleIsland("search")}
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg pl-2.5 pr-2 transition-colors",
          island === "search"
            ? "bg-foreground/10 text-foreground"
            : "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden text-xs lg:inline">Search…</span>
        <kbd className="hidden rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium lg:inline">
          ⌘K
        </kbd>
      </button>

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
        {/* Filters — island dropdown */}
        <Hint label="Filters" side="bottom">
          <button
            aria-label="Filters"
            onClick={() => onToggleIsland("filters")}
            className={cn(
              "relative grid h-8 w-8 place-items-center rounded-lg transition-colors",
              island === "filters"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {filtersActive && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
            )}
          </button>
        </Hint>

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

        {/* Vessels table */}
        <Hint label="Vessels table" side="bottom">
          <button
            aria-label="Vessels table"
            onClick={() => onOpenData("vessels")}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg transition-colors",
              dataTab === "vessels"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            )}
          >
            <Table2 className="h-4 w-4" />
          </button>
        </Hint>

        {/* Alerts — recent-events island dropdown */}
        <Hint label="Recent alerts" side="bottom">
          <button
            aria-label="Recent alerts"
            onClick={() => onToggleIsland("alerts")}
            className={cn(
              "relative grid h-8 w-8 place-items-center rounded-lg transition-colors",
              island === "alerts"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
            )}
          >
            <Bell className="h-4 w-4" />
            {hasAlerts && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500" />
            )}
          </button>
        </Hint>

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
