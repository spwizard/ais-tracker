import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Sparkles,
  SendHorizonal,
  Square,
  RotateCcw,
  CheckCircle2,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { FloatingPanel, type PanelChrome } from "@/components/FloatingPanel";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AnalystMessage } from "@/hooks/useAnalyst";

const SUGGESTIONS = [
  "Anything suspicious right now?",
  "Russian-flagged vessels in the Baltic",
  "Fastest ships in the Channel",
  "Any rendezvous events in the last 24h?",
];

const VESSEL_RE = /^(.*?)\s*\((\d{9})\)\s*$/;

/** A clickable vessel reference: name + small MMSI; selects + flies to it. */
function VesselRef({
  label,
  mmsi,
  onVessel,
}: {
  label: string;
  mmsi: number;
  onVessel: (mmsi: number) => void;
}) {
  return (
    <button
      onClick={() => onVessel(mmsi)}
      className="inline-flex items-baseline gap-1 rounded font-semibold text-primary transition-colors hover:underline"
    >
      <span>{label || mmsi}</span>
      <span className="text-[9px] font-normal tabular-nums text-primary/50">{mmsi}</span>
    </button>
  );
}

/** Inline markup: **bold** and vessel refs (**NAME (MMSI)**). */
function renderInline(
  text: string,
  onVessel: (mmsi: number) => void,
  keyBase: string,
): ReactNode[] {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) => {
    if (i % 2 === 0) return <span key={`${keyBase}-${i}`}>{part}</span>;
    const m = part.match(VESSEL_RE);
    if (m) {
      return (
        <VesselRef key={`${keyBase}-${i}`} label={m[1]} mmsi={Number(m[2])} onVessel={onVessel} />
      );
    }
    return (
      <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">
        {part}
      </strong>
    );
  });
}

type Block =
  | { kind: "header"; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "vessel"; name: string; mmsi: number; desc: string };

function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Drop markdown table separator rows; flatten table cell rows to bullets.
    if (/^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-")) continue;
    if (line.includes("|") && !line.match(/^\s*[-•*]/)) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        out.push({ kind: "bullet", text: cells.join(" · ") });
        continue;
      }
    }

    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      // A vessel entry: leading **NAME (MMSI)** then an optional "— description".
      const v = bullet[1].match(/^\*\*(.+?)\s*\((\d{9})\)\*\*\s*(?:[—–:-]\s*)?(.*)$/);
      if (v) {
        out.push({ kind: "vessel", name: v[1].trim(), mmsi: Number(v[2]), desc: v[3].trim() });
      } else {
        out.push({ kind: "bullet", text: bullet[1] });
      }
      continue;
    }

    // A section header: a fully-bold line, or a short "Label:" line.
    const bold = line.match(/^\*\*(.+?)\*\*:?$/);
    if (bold) {
      out.push({ kind: "header", text: bold[1].replace(/:$/, "") });
    } else if (/^[A-Z][^.!?]{0,40}:$/.test(line) && line.split(/\s+/).length <= 3) {
      // A short bare "Label:" (e.g. "Cargo (2):") — but not an intro sentence.
      out.push({ kind: "header", text: line.replace(/:$/, "") });
    } else {
      out.push({ kind: "para", text: line });
    }
  }
  return out;
}

function Prose({
  text,
  onVessel,
}: {
  text: string;
  onVessel: (mmsi: number) => void;
}) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="text-[13px] leading-relaxed text-foreground/90">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "header":
            return (
              <div
                key={i}
                className="mb-1.5 mt-3.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary/80 first:mt-0"
              >
                <span>{b.text}</span>
                <span className="h-px flex-1 bg-foreground/10" />
              </div>
            );
          case "vessel":
            return (
              <div key={i} className="mb-1.5 flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                <div className="min-w-0 flex-1">
                  <VesselRef label={b.name} mmsi={b.mmsi} onVessel={onVessel} />
                  {b.desc && (
                    <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                      {renderInline(b.desc, onVessel, `v${i}`)}
                    </div>
                  )}
                </div>
              </div>
            );
          case "bullet":
            return (
              <div key={i} className="mb-1 flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                <span className="min-w-0 flex-1">
                  {renderInline(b.text, onVessel, `b${i}`)}
                </span>
              </div>
            );
          default:
            return (
              <p key={i} className="mb-1.5 last:mb-0">
                {renderInline(b.text, onVessel, `p${i}`)}
              </p>
            );
        }
      })}
    </div>
  );
}

function ToolTrace({ tools, pending }: { tools: string[]; pending: boolean }) {
  if (tools.length === 0 && !pending) return null;
  return (
    <div className="mb-1.5 space-y-1">
      {tools.map((t, i) => {
        const running = pending && i === tools.length - 1;
        return (
          <div
            key={i}
            className="flex animate-fade-in items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin text-primary/70" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-primary/50" />
            )}
            <span className="truncate">{t}</span>
          </div>
        );
      })}
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1 px-0.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

export function AnalystPanel({
  chrome,
  messages,
  busy,
  onSend,
  onStop,
  onClear,
  onVessel,
}: {
  chrome: PanelChrome;
  messages: AnalystMessage[];
  busy: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  onClear: () => void;
  onVessel: (mmsi: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pin to the bottom as answers stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    if (busy || !draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <FloatingPanel
      title="AI Analyst"
      icon={Sparkles}
      width={380}
      {...chrome}
      actions={
        messages.length > 0 ? (
          <Hint label="Clear conversation" side="bottom">
            <button
              onClick={onClear}
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              aria-label="Clear conversation"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </Hint>
        ) : undefined
      }
    >
      <div className="flex h-[480px] flex-col">
        {/* Conversation */}
        <div ref={scrollRef} className="panel-scroll flex-1 overflow-y-auto px-3 py-3">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-2 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Ask the live picture anything
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  I can search the fleet, pull ownership &amp; sanctions dossiers,
                  check risk events and sea state — and point at the map while I
                  answer.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => onSend(s)}
                    className="rounded-full border border-foreground/10 bg-foreground/5 px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 px-3 py-2 text-[13px] leading-relaxed">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  (() => {
                    const body = m.text + m.draft;
                    return (
                  <div key={i} className="max-w-full">
                    <ToolTrace tools={m.tools} pending={!!m.pending && !body} />
                    {body ? (
                      <Prose text={body} onVessel={onVessel} />
                    ) : m.pending ? (
                      <Thinking />
                    ) : null}
                    {m.pending && body && (
                      <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-text-bottom" />
                    )}
                    {m.error && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {m.error}
                      </div>
                    )}
                    {m.costUsd != null && (
                      <div className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground/50">
                        ≈${m.costUsd.toFixed(3)}
                      </div>
                    )}
                  </div>
                    );
                  })()
                ),
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-foreground/5 p-2.5">
          <div className="flex items-center gap-1.5 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-1.5 transition-colors focus-within:border-primary/40">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask the analyst…"
              className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
            {busy ? (
              <Hint label="Stop" side="top">
                <button
                  onClick={onStop}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground/10 text-foreground transition-colors hover:bg-foreground/20"
                  aria-label="Stop"
                >
                  <Square className="h-3 w-3" />
                </button>
              </Hint>
            ) : (
              <button
                onClick={submit}
                disabled={!draft.trim()}
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
                  draft.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/85"
                    : "text-muted-foreground/40",
                )}
                aria-label="Send"
              >
                <SendHorizonal className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-1.5 px-1 text-center text-[10px] text-muted-foreground/50">
            Answers are grounded in live data &amp; this app's intelligence holdings
          </div>
        </div>
      </div>
    </FloatingPanel>
  );
}
