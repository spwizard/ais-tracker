/**
 * The ferry rail — routes ranked worst-first (server-sorted), each with its
 * service status. Click one to fly to it and read the disruption notice.
 * Master–detail in one panel, mirroring the Wildfires rail.
 */
import { Ship, Anchor, ChevronRight, ChevronLeft, TriangleAlert } from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { cn } from "@/lib/utils";
import type { FerryRoute } from "@/types";

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  disruptions: { label: "disrupted", cls: "border-rose-500/40 text-rose-400", dot: "bg-rose-400" },
  be_aware: { label: "be aware", cls: "border-amber-500/40 text-amber-400", dot: "bg-amber-400" },
  normal: { label: "sailing", cls: "border-emerald-500/40 text-emerald-400", dot: "bg-emerald-400" },
};

function ago(ts: number): string {
  const m = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

function FerryDetail({ route, onBack }: { route: FerryRoute; onBack: () => void }) {
  const st = STATUS[route.status] ?? STATUS.normal;
  return (
    <div className="flex flex-col gap-3 p-2.5">
      <button
        onClick={onBack}
        className="flex items-center gap-1 self-start rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All routes
      </button>

      <div>
        <div className="text-[16px] font-bold leading-tight text-balance">{route.name}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{route.operator}</span>
          <span
            className={cn("rounded border px-1.5 py-0 text-[10px] font-medium", st.cls)}
          >
            {st.label}
          </span>
        </div>
      </div>

      {route.status !== "normal" && (route.title || route.detail) ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/25 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-3">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide">
            <TriangleAlert className="h-4 w-4 text-amber-400" />
            {route.title ?? "Service notice"}
          </div>
          {route.detail && (
            <p className="whitespace-pre-line text-[12.5px] leading-snug text-foreground/85">
              {route.detail}
            </p>
          )}
        </div>
      ) : route.detail ? (
        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Latest update
          </div>
          <p className="whitespace-pre-line text-[12.5px] leading-snug text-foreground/85">{route.detail}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-foreground/10 bg-foreground/[0.04] p-3 text-[12px] text-muted-foreground">
          Sailing normally — no service notices.
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">Calls at</div>
        {route.ports.map((p) => (
          <div key={p.name} className="flex items-center gap-2 text-[12.5px]">
            <Anchor className="h-3 w-3 text-sky-400/70" />
            {p.name}
          </div>
        ))}
      </div>

      <div className="border-t border-foreground/10 pt-2 text-[10px] text-muted-foreground/60">
        {route.operator} service status · updated {ago(route.updated)}
      </div>
    </div>
  );
}

export function FerriesPanel({
  chrome,
  routes,
  selected,
  onSelect,
  onBack,
}: {
  chrome: PanelChrome;
  routes: FerryRoute[];
  selected: FerryRoute | null;
  onSelect: (r: FerryRoute) => void;
  onBack: () => void;
}) {
  const disrupted = routes.filter((r) => r.status !== "normal").length;

  if (selected) {
    return (
      <FloatingPanel title="Ferries" icon={Ship} width={320} {...chrome}>
        <FerryDetail route={selected} onBack={onBack} />
      </FloatingPanel>
    );
  }

  return (
    <FloatingPanel title="Ferries" icon={Ship} width={320} {...chrome}>
      <div className="p-1.5">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            CalMac · NorthLink · live
          </span>
          <span className="text-[11px] text-muted-foreground">
            {routes.length} routes
            {disrupted > 0 && <span className="text-amber-400"> · {disrupted} affected</span>}
          </span>
        </div>

        {routes.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            Ferry status loading…
          </div>
        ) : (
          <div className="lg:max-h-[58vh] lg:overflow-y-auto">
            {routes.map((r) => {
              const st = STATUS[r.status] ?? STATUS.normal;
              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/5"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", st.dot)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{r.name}</span>
                    <span className="text-[10.5px] text-muted-foreground">{r.operator}</span>
                  </span>
                  <span className={cn("shrink-0 rounded border px-1 py-0 text-[9px] font-medium", st.cls)}>
                    {st.label}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
