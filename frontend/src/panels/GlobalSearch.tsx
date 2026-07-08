import { useMemo, useState } from "react";
import { Ship, MapPin, Hexagon, ShieldAlert, Activity, Radio, Clock, ArrowRight, TrainFront, Cctv } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSearch } from "@/hooks/useSearch";
import { colorHexFor } from "@/lib/shipTypes";
import { cn } from "@/lib/utils";
import type {
  Alert,
  SearchCategory,
  SearchIntel,
  SearchPlace,
  SearchLocation,
  SearchVessel,
} from "@/types";

type Tab = "all" | SearchCategory;
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "places", label: "Places" },
  { key: "vessels", label: "Vessels" },
  { key: "events", label: "Events" },
  { key: "intelligence", label: "Intelligence" },
  { key: "locations", label: "Locations" },
];

const RECENT_KEY = "ais.recentSearches";
function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, 6);
  } catch {
    return [];
  }
}
function pushRecent(q: string) {
  const next = [q, ...readRecent().filter((r) => r !== q)].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

/** Highlight the matched substring of `text` against `q`. */
function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="rounded bg-primary/25 text-foreground">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  );
}

export interface GlobalSearchProps {
  onClose: () => void;
  onSelectVessel: (v: SearchVessel) => void;
  onSelectAlert: (a: Alert) => void;
  onJumpLocation: (loc: SearchLocation) => void;
  onSelectIntel: (intel: SearchIntel) => void;
  onSelectPlace: (place: SearchPlace) => void;
  /** Whether an event's vessel is still transmitting. Rows for vessels that
   *  left coverage get a "not live" tag — clicking them zooms to where the
   *  event happened but cannot highlight the vessel. */
  isLive?: (mmsi: number | null) => boolean;
}

export function GlobalSearchContent({
  onClose,
  onSelectVessel,
  onSelectAlert,
  onJumpLocation,
  onSelectIntel,
  onSelectPlace,
  isLive,
}: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const { results, loading } = useSearch(query, tab === "all" ? null : tab);
  // Read once on mount — the component mounts fresh each time the panel opens.
  const recent = useMemo(() => readRecent(), []);

  const act = (fn: () => void) => {
    if (query.trim().length >= 2) pushRecent(query.trim());
    fn();
    onClose();
  };

  const { counts } = results;
  const totalResults =
    counts.vessels + counts.events + counts.locations + counts.intelligence + counts.places;
  const showGroup = (cat: SearchCategory) => tab === "all" || tab === cat;

  const SeeMore = ({ cat, total, shown }: { cat: SearchCategory; total: number; shown: number }) =>
    tab === "all" && total > shown ? (
      <button
        onClick={() => setTab(cat)}
        className="float-right -mt-[18px] mr-2 text-[11px] font-medium text-primary hover:underline"
      >
        See all {total}
      </button>
    ) : null;

  return (
    <Command
      shouldFilter={false}
      className="flex min-h-0 flex-col overflow-hidden [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
    >
        <CommandInput
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search vessels, events, places…"
        />

      {query.trim().length >= 2 && (
        <div className="border-b border-border/50 px-2.5 py-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList>
              {TABS.map((t) => {
                const n = t.key === "all" ? totalResults : counts[t.key];
                return (
                  <TabsTrigger key={t.key} value={t.key}>
                    {t.label}
                    {n > 0 && (
                      <span className="ml-1 text-[10px] tabular-nums opacity-60">{n}</span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>
      )}

      <CommandList>
        {query.trim().length < 2 ? (
          <RecentSearches recent={recent} onPick={setQuery} />
        ) : (
          <>
            {!loading && totalResults === 0 && <CommandEmpty>No results for “{query}”.</CommandEmpty>}

            {showGroup("places") && results.places.length > 0 && (
              <CommandGroup heading="Places">
                <SeeMore cat="places" total={counts.places} shown={results.places.length} />
                {results.places.map((p) => (
                  <PlaceRow key={`${p.kind}-${p.id}`} p={p} q={query} onSelect={() => act(() => onSelectPlace(p))} />
                ))}
              </CommandGroup>
            )}
            {showGroup("vessels") && results.vessels.length > 0 && (
              <CommandGroup heading="Vessels">
                <SeeMore cat="vessels" total={counts.vessels} shown={results.vessels.length} />
                {results.vessels.map((v) => (
                  <VesselRow key={v.mmsi} v={v} q={query} onSelect={() => act(() => onSelectVessel(v))} />
                ))}
              </CommandGroup>
            )}

            {showGroup("events") && results.events.length > 0 && (
              <CommandGroup heading="Events">
                <SeeMore cat="events" total={counts.events} shown={results.events.length} />
                {results.events.map((e) => (
                  <EventRow
                    key={e.id}
                    e={e}
                    q={query}
                    live={isLive ? isLive(e.mmsi) : true}
                    onSelect={() => act(() => onSelectAlert(e))}
                  />
                ))}
              </CommandGroup>
            )}

            {showGroup("intelligence") && results.intelligence.length > 0 && (
              <CommandGroup heading="Intelligence">
                <SeeMore cat="intelligence" total={counts.intelligence} shown={results.intelligence.length} />
                {results.intelligence.map((it, i) => (
                  <IntelRow
                    key={i}
                    it={it}
                    q={query}
                    live={isLive ? isLive(it.mmsi) : true}
                    onSelect={() => act(() => onSelectIntel(it))}
                  />
                ))}
              </CommandGroup>
            )}

            {showGroup("locations") && results.locations.length > 0 && (
              <CommandGroup heading="Locations">
                <SeeMore cat="locations" total={counts.locations} shown={results.locations.length} />
                {results.locations.map((l) => (
                  <LocationRow key={l.id} l={l} q={query} onSelect={() => act(() => onJumpLocation(l))} />
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>

      <div className="flex items-center justify-between border-t border-border/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>{query.trim().length >= 2 ? `${totalResults} result${totalResults === 1 ? "" : "s"}` : "Type to search"}</span>
        <span className="hidden gap-2 sm:flex">
          <kbd className="rounded bg-foreground/10 px-1">↑↓</kbd> navigate
          <kbd className="rounded bg-foreground/10 px-1">↵</kbd> open
          <kbd className="rounded bg-foreground/10 px-1">esc</kbd> close
        </span>
      </div>
    </Command>
  );
}

function RecentSearches({ recent, onPick }: { recent: string[]; onPick: (q: string) => void }) {
  if (recent.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">Search vessels, events, intelligence and places.</div>;
  }
  return (
    <CommandGroup heading="Recent searches">
      {recent.map((r) => (
        <CommandItem key={r} value={`recent-${r}`} onSelect={() => onPick(r)}>
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>{r}</span>
          <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function ago(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function VesselRow({ v, q, onSelect }: { v: SearchVessel; q: string; onSelect: () => void }) {
  return (
    <CommandItem value={`v-${v.mmsi}`} onSelect={onSelect}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <Ship className="h-3.5 w-3.5" style={{ color: colorHexFor(v.ship_type) }} />
      </span>
      <span className="min-w-0 truncate font-medium">
        <Highlight text={v.name ?? `MMSI ${v.mmsi}`} q={q} />
      </span>
      {v.live ? (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
          <Radio className="h-3 w-3" /> live
        </span>
      ) : v.last_ts ? (
        <span className="text-[10px] text-muted-foreground/70">last seen {ago(v.last_ts)}</span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40">no position</span>
      )}
      <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{v.mmsi}</span>
    </CommandItem>
  );
}

const EVENT_VERB: Record<string, string> = {
  rendezvous: "rendezvous", spoof: "position jump", enter: "entered", exit: "left",
  dwell: "loitering in", speed: "speeding in", dark: "went dark in",
};

function EventRow({
  e,
  q,
  live,
  onSelect,
}: {
  e: Alert;
  q: string;
  live: boolean;
  onSelect: () => void;
}) {
  const who = e.name ?? (e.mmsi != null ? `MMSI ${e.mmsi}` : "Unknown");
  const where = e.fence_name ? ` · ${EVENT_VERB[e.kind] ?? e.kind} ${e.fence_name}` : ` · ${EVENT_VERB[e.kind] ?? e.kind}`;
  return (
    <CommandItem value={`e-${e.id}`} onSelect={onSelect}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <Activity className="h-3.5 w-3.5 text-rose-400" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium"><Highlight text={who} q={q} /></span>
        <span className="text-muted-foreground">{where}</span>
      </span>
      {!live && (
        <span
          className="ml-auto shrink-0 rounded border border-foreground/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
          title="This vessel is no longer transmitting — clicking shows where the event happened"
        >
          not live
        </span>
      )}
    </CommandItem>
  );
}

function IntelRow({
  it,
  q,
  live,
  onSelect,
}: {
  it: SearchIntel;
  q: string;
  live: boolean;
  onSelect: () => void;
}) {
  return (
    <CommandItem value={`i-${it.kind}-${it.mmsi ?? it.title}`} onSelect={onSelect}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium"><Highlight text={it.title ?? "—"} q={q} /></span>
        <span className="text-muted-foreground"> · {it.subtitle}</span>
      </span>
      {!live && (
        <span
          className="ml-auto shrink-0 rounded border border-foreground/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
          title="Intelligence holding — this vessel is not currently transmitting in coverage, so there is nothing to show on the map"
        >
          not live
        </span>
      )}
    </CommandItem>
  );
}

function PlaceRow({ p, q, onSelect }: { p: SearchPlace; q: string; onSelect: () => void }) {
  const isStation = p.kind === "station";
  const Icon = isStation ? TrainFront : Cctv;
  const action = isStation ? "board" : "feed";
  const offline = p.kind === "camera" && p.available === false;
  return (
    <CommandItem value={`p-${p.kind}-${p.id}`} onSelect={onSelect}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <Icon className={cn("h-3.5 w-3.5", isStation ? "text-rose-400" : "text-sky-400")} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium"><Highlight text={p.name} q={q} /></span>
        <span className="text-muted-foreground"> · {p.subtitle}</span>
      </span>
      <span className="ml-auto shrink-0 rounded border border-foreground/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        {offline ? "offline" : action}
      </span>
    </CommandItem>
  );
}

function LocationRow({ l, q, onSelect }: { l: SearchLocation; q: string; onSelect: () => void }) {
  const Icon = l.kind === "geofence" ? Hexagon : MapPin;
  return (
    <CommandItem value={`l-${l.id}`} onSelect={onSelect}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-foreground/5">
        <Icon className="h-3.5 w-3.5 text-sky-400" />
      </span>
      <span className="min-w-0 truncate font-medium">
        <Highlight text={l.name} q={q} />
      </span>
      <span className="ml-auto shrink-0 text-[11px] capitalize text-muted-foreground">{l.kind}</span>
    </CommandItem>
  );
}
