import { useState } from "react";
import { Ship, Bell, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { VesselsTable } from "./VesselsTable";
import { AlertsTable } from "./AlertsTable";
import { useAlerts } from "@/hooks/useAlerts";
import type { Alert, TrackedVessel } from "@/types";

export type DataTab = "vessels" | "alerts";

interface Props {
  open: boolean;
  tab: DataTab;
  onTab: (t: DataTab) => void;
  onClose: () => void;
  minimized: boolean;
  onSetMinimized: (v: boolean) => void;
  vessels: TrackedVessel[];
  flagged: Set<number>;
  selectedMmsi: number | null;
  onHoverVessel: (mmsi: number | null) => void;
  onSelectVessel: (mmsi: number) => void;
  onSelectAlert: (a: Alert) => void;
}

export function DataSheet({
  open,
  tab,
  onTab,
  onClose,
  minimized,
  onSetMinimized,
  vessels,
  flagged,
  selectedMmsi,
  onHoverVessel,
  onSelectVessel,
  onSelectAlert,
}: Props) {
  const [search, setSearch] = useState("");
  const alertsState = useAlerts(open && tab === "alerts", { search });

  if (!open) return null;

  const count =
    tab === "vessels"
      ? `${vessels.length.toLocaleString()} vessels`
      : `${alertsState.total.toLocaleString()} alerts`;

  const TabBtn = ({ id, icon: Icon, label }: { id: DataTab; icon: typeof Ship; label: string }) => (
    <button
      onClick={() => onTab(id)}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
        tab === id
          ? "bg-primary text-primary-foreground shadow"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <>
      {/* Subtle, non-interactive dim so the data takes focus but the map stays
          alive and hover-highlights still read. */}
      <div className="pointer-events-none absolute inset-0 z-30 bg-background/25 transition-opacity" />

      <div
        className={cn(
          "glass pointer-events-auto absolute inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-foreground/10 shadow-2xl animate-fade-in",
          minimized ? "h-12" : "h-[58vh]",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-foreground/5 px-3 py-2">
          <div className="flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5">
            <TabBtn id="vessels" icon={Ship} label="Vessels" />
            <TabBtn id="alerts" icon={Bell} label="Alerts" />
          </div>

          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "vessels" ? "Search vessels…" : "Search alerts…"}
              className="h-9 pl-8 pr-8"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear"
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
            {count}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <Hint label={minimized ? "Expand" : "Minimize"} side="top">
              <button
                onClick={() => onSetMinimized(!minimized)}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label={minimized ? "Expand" : "Minimize"}
              >
                {minimized ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            </Hint>
            <Hint label="Close" side="top">
              <button
                onClick={onClose}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Hint>
          </div>
        </div>

        {/* Body */}
        {!minimized && (
          <div className="min-h-0 flex-1 px-1">
            {tab === "vessels" ? (
              <VesselsTable
                vessels={vessels}
                flagged={flagged}
                search={search}
                selectedMmsi={selectedMmsi}
                onHover={onHoverVessel}
                onSelect={onSelectVessel}
              />
            ) : (
              <AlertsTable
                alerts={alertsState.alerts}
                total={alertsState.total}
                loading={alertsState.loading}
                hasMore={alertsState.hasMore}
                onLoadMore={alertsState.loadMore}
                onSelect={onSelectAlert}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
