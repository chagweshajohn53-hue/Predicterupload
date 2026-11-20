import { useRef, useState } from "react";
import { ArrowRight, Send, Square } from "lucide-react";
import { runChat, type Attempt } from "@/lib/engine";
import type { Msg } from "@/lib/providers";
import { PROVIDER_LABEL, type ChainEntry } from "@/lib/vault";
import { ChainStatus } from "./ChainPanel";
import { Area, Btn, Panel, Tag } from "./ui";

type Meta = { entry: ChainEntry | null; attempts: Attempt[]; ttft: number; total: number; tokens: number; estimated: boolean };
type Row = Msg & { meta?: Meta | undefined; live?: string | undefined };

export function ChatPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("");
  const [system, setSystem] = useState("You are a helpful assistant.");
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const history: Msg[] = [...(system ? [{ role: "system" as const, content: system }] : []), ...rows.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
    setRows((r) => [...r, { role: "user", content: text }, { role: "assistant", content: "", live: "connecting…", meta: { entry: null, attempts: [], ttft: 0, total: 0, tokens: 0, estimated: true } }]);
    const patch = (fn: (r: Row) => Row) => setRows((rs) => rs.map((r, i) => (i === rs.length - 1 ? fn(r) : r)));
    setBusy(true);
    ctrl.current = new AbortController();
    let out = "";
    try {
      const res = await runChat({
        messages: history,
        signal: ctrl.current.signal,
        onStart: (e) => { out = ""; patch((r) => ({ ...r, content: "", live: `dispatching to ${PROVIDER_LABEL[e.provider]}…`, meta: { ...r.meta!, entry: e } })); },
        onAttempt: (a) => patch((r) => ({ ...r, meta: { ...r.meta!, attempts: [...r.meta!.attempts, a] } })),
        onToken: (t) => { out += t; patch((r) => ({ ...r, content: out, live: undefined })); },
      });
      const tokens = res.usage?.completion_tokens ?? Math.ceil(out.length / 4);
      patch((r) => ({
        ...r,
        live: undefined,
        content: res.entry ? out : "All providers in the chain failed or are cooling down. Check keys or wait for cooldowns.",
        meta: { entry: res.entry, attempts: res.attempts, ttft: res.ttft, total: res.total, tokens, estimated: !res.usage },
      }));
    } catch {
      patch((r) => ({ ...r, live: undefined, content: out || "(stopped)" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Chat" right={<Btn variant="ghost" onClick={() => setRows([])} disabled={busy}>Clear</Btn>}>
        <div className="flex h-[62vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {rows.length === 0 && <p className="pt-20 text-center font-mono text-sm text-muted-foreground">Send a prompt — it routes down your chain until a provider answers.</p>}
            {rows.map((r, i) => (
              <div key={i} className={r.role === "user" ? "ml-auto max-w-[85%]" : "max-w-[92%]"}>
                {r.role === "assistant" && r.meta && <MetaBar m={r.meta} />}
                <div className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${r.role === "user" ? "bg-secondary" : "border border-border bg-background"}`}>
                  {r.content || <span className="animate-pulse font-mono text-xs text-muted-foreground">{r.live}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Area rows={2} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Message… (Enter to send)" />
            {busy ? <Btn variant="danger" onClick={() => ctrl.current?.abort()}><Square size={14} /></Btn> : <Btn onClick={send} disabled={!input.trim()}><Send size={14} /></Btn>}
          </div>
        </div>
      </Panel>
      <div className="space-y-4">
        <Panel title="System prompt"><Area rows={3} value={system} onChange={(e) => setSystem(e.target.value)} /></Panel>
        <Panel title="Live chain"><ChainStatus compact /></Panel>
      </div>
    </div>
  );
}

function MetaBar({ m }: { m: Meta }) {
  const failed = m.attempts.filter((a) => a.outcome !== "ok");
  return (
    <div className="mb-1 space-y-1">
      {failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-1">
          <span className="font-mono text-[10px] uppercase text-accent">failover</span>
          {failed.map((a, i) => (
            <span key={i} className="flex items-center gap-1" title={a.detail}>
              <Tag tone={a.outcome === "rate_limited" ? "warn" : a.outcome === "skipped" ? "muted" : "bad"}>{PROVIDER_LABEL[a.entry.provider]} · {a.outcome === "rate_limited" ? "429" : a.outcome}</Tag>
              <ArrowRight size={10} className="text-muted-foreground" />
            </span>
          ))}
          {m.entry && m.attempts.some((a) => a.outcome === "ok") && <Tag tone="ok">{PROVIDER_LABEL[m.entry.provider]} picked up</Tag>}
        </div>
      )}
      {m.entry && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <Tag tone="primary">{m.entry.model}</Tag>
          {m.total > 0 && <><span>ttft {Math.round(m.ttft)}ms</span><span>total {Math.round(m.total)}ms</span><span>{m.estimated ? "~" : ""}{m.tokens} tok</span>{m.total > 0 && <span>{(m.tokens / (m.total / 1000)).toFixed(1)} tok/s</span>}</>}
        </div>
      )}
    </div>
  );
}
