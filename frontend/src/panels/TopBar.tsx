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
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RegionPicker } from "@/panels/RegionPicker";
import type { RegionId } from "@/lib/regions";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SourcesIndicator } from "@/panels/SourcesIndicator";
import { Sheet } from "@/components/Sheet";
import { useViewport } from "@/hooks/useViewport";
import type { PanelId } from "@/hooks/usePanels";
import type { Theme } from "@/hooks/useTheme";
import type { ConnectionStatus, SourceStatus } from "@/types";

/** Panels that drop from the island as a single shared dropdown surface. */
export type IslandPanel = "search" | "filters" | "alerts";

interface TopBarProps {
  status: ConnectionStatus;
  regionId: RegionId | null;
  onEnterRegion: (id: RegionId) => void;
  total: number;
  visible: number;
  viewers: number; // people watching live right now (connected WS clients)
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

// The dock is deliberately short — Eyes and the Analyst are the two things
// you reach for constantly; the rest sit one click away under "More" so the
// bar reads calm. (Mobile lists everything in its menu sheet.)
const DOCK: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: "layers", icon: Layers, label: "Eyes" },
  { id: "analyst", icon: Sparkles, label: "AI Analyst" },
];
const MORE: { id: PanelId; icon: LucideIcon; label: string }[] = [
  { id: "stats", icon: Activity, label: "Statistics" },
  { id: "zones", icon: Hexagon, label: "Zones & geofences" },
  { id: "detail", icon: Ship, label: "Vessel details" },
];

/** One tappable row in the mobile menu sheet. */
function MenuRow({
  icon: Icon, label, active, disabled, dot, onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/30"
          : active
            ? "bg-primary/15 text-primary"
            : "text-foreground/90 hover:bg-foreground/5",
      )}
    >
      <span className="relative">
        <Icon className="h-[18px] w-[18px]" />
        {dot && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
      </span>
      {label}
      {active && <span className="ml-auto text-[10px] uppercase tracking-wider text-primary/70">on</span>}
    </button>
  );
}

export function TopBar({
  status,
  regionId,
  onEnterRegion,
  total,
  visible,
  viewers,
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
  const { sheetLayout } = useViewport();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen]);

  // ---- Mobile / iPad-portrait: a compact bar + a menu sheet -----------------
  // The desktop bar is a wide fixed pill that overflows a phone; here the brand
  // + live count stay inline and everything else moves into a tap-through menu.
  if (sheetLayout) {
    const run = (fn: () => void) => () => {
      fn();
      setMenuOpen(false);
    };
    return (
      <>
        <header
          data-island-bar
          className="glass pointer-events-auto absolute inset-x-2 top-2 z-40 flex h-12 items-center gap-2 px-3 animate-fade-in"
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
            <Eye className="h-4 w-4" />
          </div>
          <RegionPicker regionId={regionId} onEnterRegion={onEnterRegion} compact sheet />
          <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
          <span className="text-xs tabular-nums">
            <span className="font-semibold text-foreground">{visible.toLocaleString()}</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              aria-label="Search"
              onClick={() => onToggleIsland("search")}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              aria-label="Menu"
              onClick={() => setMenuOpen(true)}
              className="relative grid h-9 w-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <Layers className="h-5 w-5" />
              {(hasAlerts || filtersActive) && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </div>
        </header>

        {menuOpen && (
          <Sheet title="Menu" icon={Layers} onClose={() => setMenuOpen(false)}>
            <div className="flex flex-col gap-0.5 p-2">
              <MenuRow icon={SlidersHorizontal} label="Filters" active={island === "filters"} dot={filtersActive} onClick={run(() => onToggleIsland("filters"))} />
              {[...DOCK, ...MORE].map((d) => {
                const disabled = d.id === "detail" && !hasSelection;
                return (
                  <MenuRow
                    key={d.id}
                    icon={d.icon}
                    label={d.label}
                    active={panelOpen[d.id] && !disabled}
                    disabled={disabled}
                    onClick={run(() => !disabled && onTogglePanel(d.id))}
                  />
                );
              })}
              <MenuRow icon={Table2} label="Vessels table" active={dataTab === "vessels"} onClick={run(() => onOpenData("vessels"))} />
              <MenuRow icon={Bell} label="Recent alerts" active={island === "alerts"} dot={hasAlerts} onClick={run(() => onToggleIsland("alerts"))} />
              <div className="my-1 h-px bg-foreground/10" />
              <MenuRow
                icon={theme === "dark" ? Sun : Moon}
                label={`${theme === "dark" ? "Light" : "Dark"} mode`}
                onClick={() => onToggleTheme()}
              />
            </div>
          </Sheet>
        )}
      </>
    );
  }

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

      {/* Place — the front door. The only control here that flies the map. */}
      <RegionPicker regionId={regionId} onEnterRegion={onEnterRegion} />

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
        {viewers > 0 && (
          <Hint label={`${viewers} watching live right now`} side="bottom">
            <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
              <Eye className="h-3 w-3" />
              {viewers}
            </span>
          </Hint>
        )}
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

        {/* More — filters, statistics, zones, vessel details, vessels table */}
        <div ref={moreRef} className="relative">
          <Hint label="More tools" side="bottom">
            <button
              aria-label="More tools"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}
              className={cn(
                "relative grid h-8 w-8 place-items-center rounded-lg transition-colors",
                moreOpen || MORE.some((m) => panelOpen[m.id]) || dataTab === "vessels" || filtersActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
              {filtersActive && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          </Hint>
          {moreOpen && (
            <div className="glass absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-xl border border-border/60 p-1 shadow-2xl animate-fade-in">
              <MenuRow
                icon={SlidersHorizontal}
                label="Filters"
                active={island === "filters"}
                dot={filtersActive}
                onClick={() => {
                  setMoreOpen(false);
                  onToggleIsland("filters");
                }}
              />
              {MORE.map((d) => {
                const disabled = d.id === "detail" && !hasSelection;
                return (
                  <MenuRow
                    key={d.id}
                    icon={d.icon}
                    label={d.label}
                    active={panelOpen[d.id] && !disabled}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setMoreOpen(false);
                      onTogglePanel(d.id);
                    }}
                  />
                );
              })}
              <MenuRow
                icon={Table2}
                label="Vessels table"
                active={dataTab === "vessels"}
                onClick={() => {
                  setMoreOpen(false);
                  onOpenData("vessels");
                }}
              />
            </div>
          )}
        </div>

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
