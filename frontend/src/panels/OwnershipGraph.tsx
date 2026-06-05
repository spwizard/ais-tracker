import { useEffect, useMemo } from "react";
import { X, Loader2, Network } from "lucide-react";
import { useNetwork } from "@/hooks/useNetwork";
import { countryFromIso3 } from "@/lib/flags";
import type { NetworkNode } from "@/types";
import { cn } from "@/lib/utils";

const W = 680;
const H = 600;
const CX = W / 2;
const CY = H / 2;
const R_COMPANY = 128;
const R_VESSEL = 238;

interface Pt {
  x: number;
  y: number;
}

/** Modal: the ownership network around one vessel — owner/operator companies and
 *  the sister vessels that share them. Sanctioned nodes are flagged in red. */
export function OwnershipGraph({
  mmsi,
  vesselName,
  liveMmsis,
  onClose,
  onSelectVessel,
}: {
  mmsi: number;
  vesselName: string;
  liveMmsis: Set<number>;
  onClose: () => void;
  onSelectVessel: (mmsi: number) => void;
}) {
  const { loading, data } = useNetwork(mmsi);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const layout = useMemo(() => {
    if (!data) return null;
    const companies = data.nodes.filter((n) => n.type === "company");
    const n = Math.max(companies.length, 1);
    const compAngle = new Map<string, number>();
    companies.forEach((c, i) =>
      compAngle.set(c.id, (i * 2 * Math.PI) / n - Math.PI / 2),
    );

    const sistersByComp = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.role === "fleet") {
        const arr = sistersByComp.get(e.source) ?? [];
        arr.push(e.target);
        sistersByComp.set(e.source, arr);
      }
    }

    const pos = new Map<string, Pt>();
    pos.set(data.subject_id, { x: CX, y: CY });
    for (const c of companies) {
      const a = compAngle.get(c.id)!;
      pos.set(c.id, { x: CX + R_COMPANY * Math.cos(a), y: CY + R_COMPANY * Math.sin(a) });
    }
    const band = ((2 * Math.PI) / n) * 0.82;
    for (const c of companies) {
      const a0 = compAngle.get(c.id)!;
      const sis = sistersByComp.get(c.id) ?? [];
      const k = sis.length;
      sis.forEach((vid, j) => {
        const a = k === 1 ? a0 : a0 - band / 2 + (band * j) / (k - 1);
        pos.set(vid, { x: CX + R_VESSEL * Math.cos(a), y: CY + R_VESSEL * Math.sin(a) });
      });
    }
    const byId = new Map(data.nodes.map((nd) => [nd.id, nd]));
    return { pos, byId, edges: data.edges };
  }, [data]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Network className="h-4 w-4 text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">Ownership network</div>
            <div className="truncate text-xs text-muted-foreground">{vesselName}</div>
          </div>
          <button
            onClick={onClose}
            className="ml-auto grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative min-h-[360px] flex-1 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Building network…
              </span>
            </div>
          )}
          {!loading && !data && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
              No ownership record for this vessel.
            </div>
          )}
          {layout && (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
              {/* edges */}
              {layout.edges.map((e, i) => {
                const a = layout.pos.get(e.source);
                const b = layout.pos.get(e.target);
                if (!a || !b) return null;
                const fleet = e.role === "fleet";
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="currentColor"
                    className={fleet ? "text-foreground/10" : "text-primary/30"}
                    strokeWidth={fleet ? 1 : 1.5}
                  />
                );
              })}
              {/* nodes */}
              {[...layout.byId.values()].map((node) => {
                const p = layout.pos.get(node.id);
                if (!p) return null;
                return node.type === "company" ? (
                  <CompanyChip key={node.id} node={node} p={p} />
                ) : (
                  <VesselNode
                    key={node.id}
                    node={node}
                    p={p}
                    live={node.mmsi != null && liveMmsis.has(node.mmsi)}
                    onSelect={() => {
                      if (node.mmsi != null && liveMmsis.has(node.mmsi)) {
                        onSelectVessel(node.mmsi);
                        onClose();
                      }
                    }}
                  />
                );
              })}
            </svg>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 px-4 py-2.5 text-[11px] text-muted-foreground">
          <Legend className="bg-primary" label="This vessel" />
          <Legend className="bg-slate-400" label="Owner / operator" square />
          <Legend className="bg-foreground/40" label="Sister vessel" />
          <Legend className="bg-rose-500" label="Sanctioned" />
          <span className="ml-auto text-muted-foreground/50">
            click a live (glowing) vessel to inspect it
          </span>
        </div>
      </div>
    </div>
  );
}

function CompanyChip({ node, p }: { node: NetworkNode; p: Pt }) {
  const label = node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
  const w = label.length * 5.6 + 16;
  const sanctioned = node.sanctioned;
  return (
    <g transform={`translate(${p.x}, ${p.y})`}>
      <rect
        x={-w / 2}
        y={-11}
        width={w}
        height={22}
        rx={5}
        className={cn(
          "stroke-[1.5]",
          sanctioned ? "fill-rose-500/20 stroke-rose-500" : "fill-slate-500/20 stroke-slate-400/60",
        )}
      />
      <text
        textAnchor="middle"
        dy={3.5}
        className={cn("text-[10px] font-medium", sanctioned ? "fill-rose-300" : "fill-foreground")}
      >
        {label}
      </text>
      <title>
        {node.label}
        {node.roles?.length ? ` — ${node.roles.join(", ")}` : ""}
        {sanctioned ? " (SANCTIONED)" : ""}
      </title>
    </g>
  );
}

function VesselNode({
  node,
  p,
  live,
  onSelect,
}: {
  node: NetworkNode;
  p: Pt;
  live: boolean;
  onSelect: () => void;
}) {
  const subject = node.subject;
  const left = p.x < CX;
  const flag = countryFromIso3(node.flag)?.flag ?? "";
  const label = node.label.length > 14 ? node.label.slice(0, 13) + "…" : node.label;
  const fill = node.sanctioned
    ? "fill-rose-500"
    : subject
      ? "fill-primary"
      : "fill-foreground/50";

  return (
    <g
      transform={`translate(${p.x}, ${p.y})`}
      onClick={onSelect}
      className={live ? "cursor-pointer" : undefined}
    >
      {(live || subject) && (
        <circle r={subject ? 11 : 8} className={cn(subject ? "fill-primary/25" : "fill-primary/20")} />
      )}
      <circle
        r={subject ? 7 : node.sanctioned ? 5.5 : 4.5}
        className={cn(fill, node.sanctioned && "stroke-rose-300 stroke-1")}
      />
      {!subject && (
        <text
          x={left ? -9 : 9}
          dy={3}
          textAnchor={left ? "end" : "start"}
          className={cn(
            "text-[8.5px]",
            node.sanctioned ? "fill-rose-300" : live ? "fill-foreground" : "fill-muted-foreground",
          )}
        >
          {flag} {label}
        </text>
      )}
      {subject && (
        <text dy={22} textAnchor="middle" className="fill-foreground text-[11px] font-semibold">
          {flag} {node.label.length > 18 ? node.label.slice(0, 17) + "…" : node.label}
        </text>
      )}
      <title>
        {node.label}
        {node.mmsi ? ` · MMSI ${node.mmsi}` : ""}
        {node.sanctioned ? " (SANCTIONED)" : ""}
        {live && !subject ? " · live — click to inspect" : ""}
      </title>
    </g>
  );
}

function Legend({
  className,
  label,
  square,
}: {
  className: string;
  label: string;
  square?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5", square ? "rounded-[2px]" : "rounded-full", className)} />
      {label}
    </span>
  );
}
