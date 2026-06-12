import { useCallback, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** A show_on_map directive streamed from the analyst. */
export interface MapDirective {
  mmsis?: number[];
  lat?: number;
  lon?: number;
  zoom?: number;
}

export interface AnalystMessage {
  role: "user" | "assistant";
  text: string; // committed answer
  draft: string; // current round's streaming text (dropped on `discard`)
  tools: string[]; // tool-trace labels, in order
  costUsd?: number;
  error?: string;
  pending?: boolean;
}

/**
 * Chat state + SSE streaming for the AI analyst. `onMap` fires when the model
 * drives the map (highlight vessels / fly the camera) mid-answer.
 */
export function useAnalyst(onMap: (d: MapDirective) => void) {
  const [messages, setMessages] = useState<AnalystMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const onMapRef = useRef(onMap);
  onMapRef.current = onMap;

  const patchLast = useCallback((fn: (m: AnalystMessage) => AnalystMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), fn(last)];
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      // History = the prior completed turns, as plain text.
      const history = messages
        .filter((m) => m.text && !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.text }));

      setMessages((prev) => [
        ...prev,
        { role: "user", text: q, draft: "", tools: [] },
        { role: "assistant", text: "", draft: "", tools: [], pending: true },
      ]);
      setBusy(true);
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(`${API_URL}/api/analyst`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: q, history }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            switch (ev.type) {
              case "delta":
                patchLast((m) => ({ ...m, draft: m.draft + (ev.text as string) }));
                break;
              case "discard": // that round was tool-narration — drop it
                patchLast((m) => ({ ...m, draft: "" }));
                break;
              case "tool":
                patchLast((m) => ({ ...m, tools: [...m.tools, ev.label as string] }));
                break;
              case "map":
                onMapRef.current(ev as MapDirective);
                break;
              case "final":
                patchLast((m) => ({ ...m, costUsd: ev.cost_usd as number }));
                break;
              case "error":
                patchLast((m) => ({ ...m, error: ev.message as string }));
                break;
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          patchLast((m) => ({
            ...m,
            error: m.error ?? "Connection to the analyst failed — is the backend up?",
          }));
        }
      } finally {
        // Commit whatever's left in the draft as the final answer.
        patchLast((m) => ({
          ...m,
          text: m.text + m.draft,
          draft: "",
          pending: false,
        }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, busy, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, send, stop, clear };
}
