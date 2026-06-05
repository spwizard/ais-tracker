import { useEffect, useState } from "react";
import {
  Ship,
  Navigation2,
  Gauge,
  Compass,
  Ruler,
  MapPin,
  Anchor,
  Route,
  Eye,
  EyeOff,
  Crosshair,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Hint } from "@/components/ui/tooltip";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { NAV_STATUS, colorHexFor, groupKeyFor } from "@/lib/shipTypes";
import { SHIP_TYPE_GROUPS } from "@/lib/shipTypes";
import { mmsiCountry, countryFromIso3 } from "@/lib/flags";
import { useFlag } from "@/hooks/useFlags";
import { useOwnership } from "@/hooks/useOwnership";
import { useRisk } from "@/hooks/useRisk";
import { useBriefing } from "@/hooks/useBriefing";
import {
  Building2,
  ShieldAlert,
  Sparkles,
  Loader2,
  Network,
  Globe,
  ExternalLink,
} from "lucide-react";
import type {
  Briefing,
  BriefingResponse,
  EvidenceItem,
  RiskAssessment,
  RiskLevel,
} from "@/types";
import type { TrailPoint } from "@/hooks/useVesselTrail";
import { cn } from "@/lib/utils";
import type { Ownership, TrackedVessel } from "@/types";

interface VesselDetailProps {
  chrome: PanelChrome;
  vessel: TrackedVessel;
  track: TrailPoint[]; // merged backend history + live positions
  showOnMap: boolean;
  onToggleShowOnMap: () => void;
  onZoomToTrack: () => void;
  onOpenNetwork: (mmsi: number) => void;
}

type Tab = "overview" | "risk" | "ownership";

const GROUP_LABEL = new Map(SHIP_TYPE_GROUPS.map((g) => [g.key, g.label]));

export function VesselDetail({
  chrome,
  vessel: v,
  track,
  showOnMap,
  onToggleShowOnMap,
  onZoomToTrack,
  onOpenNetwork,
}: VesselDetailProps) {
  const color = colorHexFor(v.ship_type);
  const groupLabel = GROUP_LABEL.get(groupKeyFor(v.ship_type)) ?? "Unknown";
  const country = mmsiCountry(v.mmsi);
  const ownershipOn = useFlag("ownership");
  const ownership = useOwnership(v.mmsi, ownershipOn);
  const riskOn = useFlag("risk_engine");
  const risk = useRisk(v.mmsi, riskOn);
  const briefingOn = useFlag("llm_briefing");
  const briefing = useBriefing(v.mmsi);

  const [tab, setTab] = useState<Tab>("overview");
  // Reset to Overview whenever a different vessel is selected.
  useEffect(() => setTab("overview"), [v.mmsi]);

  // Tick once a second so the "updated … ago" timer counts up live.
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, now - v.ts);

  const hasTrack = track.length >= 2;
  const hasRisk = !!risk && risk.score > 0;
  const tabs: Tab[] = ["overview"];
  if (riskOn) tabs.push("risk");
  if (ownershipOn) tabs.push("ownership");

  return (
    <FloatingPanel
      title={v.name ?? `MMSI ${v.mmsi}`}
      icon={Ship}
      width={420}
      {...chrome}
    >
      <div className="space-y-3 p-4">
        {/* Identity */}
        <div className="flex items-center gap-2.5">
          <span
            className="h-3 w-3 shrink-0 rounded-full ring-2 ring-foreground/10"
            style={{ background: color }}
          />
          {country && (
            <span className="text-base leading-none" title={country.name}>
              {country.flag}
            </span>
          )}
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            <span className="font-mono">{v.mmsi}</span>
            {v.imo && <span> · IMO {v.imo}</span>}
            {v.callsign && <span> · {v.callsign}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge style={{ color, backgroundColor: `${color}22` }}>{groupLabel}</Badge>
          {v.nav_status != null && (
            <Badge variant="muted">{NAV_STATUS[v.nav_status] ?? "—"}</Badge>
          )}
          {hasRisk && (
            <button
              onClick={() => setTab("risk")}
              className={cn(
                "ml-auto flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                RISK_STYLE[risk!.level].ring,
                RISK_STYLE[risk!.level].text,
              )}
            >
              <ShieldAlert className="h-3 w-3" />
              {risk!.level} {risk!.score}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-3 border-b border-border/50 text-xs">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 pb-1.5 capitalize transition-colors",
                tab === t
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              {t === "risk" && hasRisk && (
                <span className={cn("h-1.5 w-1.5 rounded-full", RISK_STYLE[risk!.level].dot)} />
              )}
            </button>
          ))}
        </div>

        {/* Panels */}
        {tab === "overview" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Route className="h-3 w-3" />
                  Recent track
                </span>
                <div className="flex items-center gap-1">
                  {hasTrack && (
                    <span className="tabular-nums text-muted-foreground/70">
                      {track.length} pts
                    </span>
                  )}
                  <Hint
                    label={showOnMap ? "Hide track on map" : "Show track on map"}
                    side="top"
                  >
                    <button
                      aria-label="Toggle track on map"
                      disabled={!hasTrack}
                      onClick={onToggleShowOnMap}
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-md transition-colors",
                        !hasTrack
                          ? "cursor-not-allowed text-muted-foreground/30"
                          : showOnMap
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                      )}
                    >
                      {showOnMap ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </Hint>
                  <Hint label="Zoom to track" side="top">
                    <button
                      aria-label="Zoom to track"
                      disabled={!hasTrack}
                      onClick={onZoomToTrack}
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-md transition-colors",
                        !hasTrack
                          ? "cursor-not-allowed text-muted-foreground/30"
                          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                      )}
                    >
                      <Crosshair className="h-3.5 w-3.5" />
                    </button>
                  </Hint>
                </div>
              </div>
              <MiniTrack trail={track} color={color} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field icon={<Gauge />} label="Speed" value={fmt(v.sog, "kn")} />
              <Field icon={<Compass />} label="Course" value={fmt(v.cog, "°", 0)} />
              <Field icon={<Navigation2 />} label="Heading" value={fmt(v.heading, "°", 0)} />
              <Field icon={<Ruler />} label="Draught" value={fmt(v.draught, "m")} />
              <Field
                icon={<Ruler />}
                label="Size"
                value={v.length ? `${v.length}×${v.width ?? "?"} m` : "—"}
              />
              <Field icon={<Anchor />} label="Updated" value={fmtAge(ageSec)} />
            </div>

            {v.destination && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Destination</span>
                <span className="ml-auto truncate font-medium">{v.destination}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Position</span>
              <span className="font-mono">
                {v.lat?.toFixed(4)}, {v.lon?.toFixed(4)}
              </span>
            </div>
          </div>
        )}

        {tab === "risk" && (
          <div className="space-y-3">
            {hasRisk ? (
              <RiskBanner risk={risk!} />
            ) : (
              <p className="rounded-lg border border-border/50 px-3 py-2.5 text-xs text-muted-foreground">
                No deterministic risk signals from sanctions, ownership or behavior.
              </p>
            )}
            {briefingOn && (
              <BriefingSection
                loading={briefing.loading}
                error={briefing.error}
                data={briefing.data}
                onGenerate={briefing.generate}
              />
            )}
          </div>
        )}

        {tab === "ownership" && (
          <div className="space-y-3">
            {ownership ? (
              <>
                <OwnershipSection o={ownership} />
                <button
                  onClick={() => onOpenNetwork(v.mmsi)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-foreground/5 px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/10"
                >
                  <Network className="h-3.5 w-3.5 text-primary" />
                  View ownership network
                </button>
              </>
            ) : (
              <p className="rounded-lg border border-border/50 px-3 py-2.5 text-xs text-muted-foreground">
                No Lloyd's ownership record matched for this vessel.
              </p>
            )}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}

/** Claude-generated, cited risk briefing. */
function BriefingSection({
  loading,
  error,
  data,
  onGenerate,
}: {
  loading: boolean;
  error: string | null;
  data: BriefingResponse | null;
  onGenerate: (web: boolean) => void;
}) {
  const [web, setWeb] = useState(false);
  return (
    <>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          AI risk briefing
          <span className="ml-auto normal-case tracking-normal text-muted-foreground/50">
            Claude
          </span>
        </div>

        {!data &&
          (loading ? (
            <BriefingProgress web={web} />
          ) : (
            <div className="space-y-1.5">
              <button
                onClick={() => onGenerate(web)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate briefing
              </button>
              <label className="flex cursor-pointer items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={web}
                  onChange={(e) => setWeb(e.target.checked)}
                  className="h-3 w-3 accent-primary"
                />
                <Globe className="h-3 w-3" />
                Search the open web
                <span className="ml-auto text-muted-foreground/50">slower · costs more</span>
              </label>
            </div>
          ))}

        {error && (
          <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-400">
            {error}
          </p>
        )}

        {data && (
          <BriefingCard
            briefing={data.briefing}
            evidence={data.evidence}
            sources={data.sources ?? []}
            cost={data.cost}
          />
        )}
      </div>
    </>
  );
}

/** Live progress while the briefing runs. */
function BriefingProgress({ web }: { web: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const stage =
    web && elapsed < 25 ? "Searching the web…" : "Synthesizing briefing…";
  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span>{stage}</span>
      <span className="ml-auto tabular-nums text-primary/60">
        {mm}:{ss}
      </span>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function BriefingCard({
  briefing,
  evidence,
  sources,
  cost,
}: {
  briefing: Briefing;
  evidence: EvidenceItem[];
  sources: { title: string; url: string }[];
  cost?: { usd: number; tokens: number; searches: number };
}) {
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const s = RISK_STYLE[briefing.risk_level];
  const openSource = briefing.open_source ?? [];
  return (
    <div className={cn("space-y-2.5 rounded-lg border p-2.5", s.ring)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">
          <span className={s.text}>{briefing.risk_level}</span> risk
        </span>
      </div>
      <p className="text-xs leading-relaxed">{briefing.summary}</p>

      {briefing.findings.length > 0 && (
        <ul className="space-y-1.5">
          {briefing.findings.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  RISK_STYLE[f.severity].dot,
                )}
              />
              <span className="min-w-0">
                {f.title}
                {f.confidence === "suspicious" && (
                  <span className="ml-1 text-muted-foreground/60">(suspected)</span>
                )}{" "}
                {f.evidence_ids.map((id) => (
                  <span
                    key={id}
                    title={evById.get(id)?.summary ?? id}
                    className="ml-0.5 cursor-help rounded bg-foreground/10 px-1 font-mono text-[9px] text-muted-foreground"
                  >
                    {id}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {briefing.recommended_actions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Recommended
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-[11px] leading-snug text-muted-foreground">
            {briefing.recommended_actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {openSource.length > 0 && (
        <div className="space-y-1 rounded-md border border-border/50 bg-foreground/[0.03] p-2">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Globe className="h-3 w-3" />
            Open-source
            <span className="ml-auto normal-case tracking-normal text-amber-400/70">
              unverified
            </span>
          </div>
          <ul className="space-y-1">
            {openSource.map((o, i) => (
              <li key={i} className="text-[11px] leading-snug">
                {o.claim}
                <a
                  href={o.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-0.5 align-baseline text-primary/80 hover:text-primary hover:underline"
                >
                  {hostOf(o.source_url)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
                {o.as_of && o.as_of !== "unknown" && (
                  <span className="ml-1 text-muted-foreground/50">· {o.as_of}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {briefing.caveats.length > 0 && (
        <p className="text-[10px] leading-snug text-muted-foreground/60">
          {briefing.caveats.join(" · ")}
        </p>
      )}

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/50">
        <span>AI-generated · verify before acting</span>
        {cost && (
          <span
            title={`${cost.tokens.toLocaleString()} tokens · ${cost.searches} web searches · ${sources.length} sources`}
            className="tabular-nums"
          >
            ~${cost.usd.toFixed(4)}
          </span>
        )}
      </div>
    </div>
  );
}

const RISK_STYLE: Record<RiskLevel, { ring: string; text: string; dot: string }> = {
  low: { ring: "border-emerald-500/30 bg-emerald-500/5", text: "text-emerald-400", dot: "bg-emerald-400" },
  medium: { ring: "border-amber-500/30 bg-amber-500/5", text: "text-amber-400", dot: "bg-amber-400" },
  high: { ring: "border-orange-500/40 bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-400" },
  critical: { ring: "border-rose-500/50 bg-rose-500/10", text: "text-rose-400", dot: "bg-rose-400" },
};

/** Composite, cited risk assessment (sanctions + ownership + behaviour). */
function RiskBanner({ risk }: { risk: RiskAssessment }) {
  const s = RISK_STYLE[risk.level];
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-2.5", s.ring)}>
      <div className="flex items-center gap-2">
        <ShieldAlert className={cn("h-4 w-4", s.text)} />
        <span className="text-xs font-semibold uppercase tracking-wide">
          <span className={s.text}>{risk.level}</span> risk
        </span>
        <span className={cn("ml-auto text-sm font-bold tabular-nums", s.text)}>
          {risk.score}
          <span className="text-[10px] font-normal text-muted-foreground">/100</span>
        </span>
      </div>
      <ul className="space-y-0.5">
        {risk.reasons.map((r) => (
          <li key={r.code} className="flex items-start gap-1.5 text-[11px] leading-snug">
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                RISK_STYLE[r.severity].dot,
              )}
            />
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lloyd's ownership chain + particulars. Country codes are ISO-3 (the
 *  control ≠ domicile ≠ registration spread is itself a risk signal). */
function OwnershipSection({ o }: { o: Ownership }) {
  const rows = [
    { label: "Beneficial owner", name: o.beneficial_owner, iso3: o.beneficial_owner_control ?? o.beneficial_owner_domicile },
    { label: "Registered owner", name: o.reg_owner, iso3: o.reg_owner_domicile },
    { label: "Operator", name: o.operator, iso3: o.operator_domicile },
    { label: "Manager", name: o.manager, iso3: o.manager_domicile },
  ].filter((r) => r.name);

  const flag = countryFromIso3(o.flag);
  const chips = [
    flag && `${flag.flag} ${flag.name}`,
    o.ship_type,
    o.gross_tonnage ? `${o.gross_tonnage.toLocaleString()} GT` : null,
    o.port_of_registry,
    o.ex_name ? `ex ${o.ex_name}` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Building2 className="h-3 w-3" />
          Ownership
          <span className="ml-auto normal-case tracking-normal text-muted-foreground/50">
            Lloyd's
          </span>
        </div>

        <div className="space-y-1.5">
          {rows.map((r) => {
            const c = countryFromIso3(r.iso3);
            return (
              <div key={r.label} className="flex items-center gap-2">
                <span className="text-sm leading-none" title={c?.name}>
                  {c?.flag ?? "🏳️"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{r.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.label}
                    {c && ` · ${c.name}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((c, i) => (
              <span
                key={i}
                className="rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-foreground/5 bg-foreground/5 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground [&_svg]:h-3 [&_svg]:w-3">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Tiny SVG sparkline of the vessel's recent path. */
function MiniTrack({
  trail,
  color,
}: {
  trail: TrailPoint[];
  color: string;
}) {
  if (trail.length < 2) {
    return (
      <div className="grid h-16 place-items-center rounded-lg border border-foreground/5 bg-foreground/5 text-[11px] text-muted-foreground">
        No recent track yet
      </div>
    );
  }
  const W = 288;
  const H = 64;
  const pad = 8;
  const lons = trail.map((p) => p[0]);
  const lats = trail.map((p) => p[1]);
  const minX = Math.min(...lons);
  const maxX = Math.max(...lons);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const sx = (x: number) => pad + ((x - minX) / spanX) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - minY) / spanY) * (H - 2 * pad);
  const d = trail.map((p, i) => `${i ? "L" : "M"}${sx(p[0])},${sy(p[1])}`).join(" ");
  const first = trail[0];
  const last = trail[trail.length - 1];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      className="rounded-lg border border-foreground/5 bg-foreground/5"
    >
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
      {/* hollow marker = start of track; filled marker = current position */}
      <circle
        cx={sx(first[0])}
        cy={sy(first[1])}
        r={3}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={0.85}
      />
      <circle cx={sx(last[0])} cy={sy(last[1])} r={3} fill={color} />
    </svg>
  );
}

function fmt(n: number | null, unit: string, digits = 1): string {
  if (n == null) return "—";
  return `${n.toFixed(digits)}${unit}`;
}

/** Compact "time since last report", e.g. 42s · 3m 05s · 1h 12m. */
function fmtAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m ago`;
}
