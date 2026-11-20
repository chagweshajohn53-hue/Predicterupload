import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { hasKeys } from "@/lib/providers";
import { DEFAULT_CHAIN, newEntry, PROVIDER_LABEL, setVault, useVault, type ProviderId } from "@/lib/vault";
import { Btn, Field, Panel, Tag } from "./ui";

export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function ChainStatus({ compact }: { compact?: boolean }) {
  const { chain, cooldowns, status, keys } = useVault();
  const now = useNow();
  return (
    <ol className="space-y-2">
      {chain.map((c, i) => {
        const cd = cooldowns[c.id];
        const cooling = cd && cd.until > now;
        const st = status[c.id];
        const keyed = hasKeys(c.provider, keys);
        return (
          <li
            key={c.id}
            className={`rounded-md border border-border bg-background px-3 py-2 ${!c.enabled ? "opacity-40" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
              <Tag>{PROVIDER_LABEL[c.provider]}</Tag>
              <span className="truncate font-mono text-xs">{c.model}</span>
              <span className="ml-auto">
                {!keyed ? (
                  <Tag tone="bad">no key</Tag>
                ) : cooling ? (
                  <Tag tone="warn">{Math.ceil((cd.until - now) / 1000)}s</Tag>
                ) : (
                  <Tag tone="ok">ready</Tag>
                )}
              </span>
            </div>
            {!compact && st && (
              <div className="mt-1 flex flex-wrap gap-3 font-mono text-[10px] text-muted-foreground">
                <span>last {st.lastStatus}</span>
                {st.remainingReq && <span>req left {st.remainingReq}</span>}
                {st.remainingTok && <span>tok left {st.remainingTok}</span>}
                {st.resetReq && <span>reset {st.resetReq}</span>}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const SUGGEST: Record<ProviderId, string[]> = {
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
  openrouter: [
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-chat-v3-0324:free",
    "qwen/qwen3-235b-a22b:free",
  ],
  cloudflare: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct", "@cf/qwen/qwq-32b"],
};

export function ChainPanel() {
  const { chain, cooldowns } = useVault();
  const now = useNow();
  const [prov, setProv] = useState<ProviderId>("groq");
  const [model, setModel] = useState("");
  const activeCooldowns = Object.values(cooldowns).filter((c) => c.until > now).length;
  const move = (i: number, d: number) =>
    setVault((s) => {
      const c = [...s.chain];
      const j = i + d;
      if (j < 0 || j >= c.length) return s;
      [c[i], c[j]] = [c[j]!, c[i]!];
      return { ...s, chain: c };
    });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Panel
        title="Priority chain"
        right={
          <div className="flex gap-2">
            {activeCooldowns > 0 && (
              <Btn variant="ghost" onClick={() => setVault((s) => ({ ...s, cooldowns: {} }))}>
                Clear cooldowns ({activeCooldowns})
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => setVault((s) => ({ ...s, chain: DEFAULT_CHAIN, cooldowns: {} }))}>
              Reset
            </Btn>
          </div>
        }
      >
        <ol className="space-y-2">
          {chain.map((c, i) => {
            const cd = cooldowns[c.id];
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <input
                  type="checkbox"
                  checked={c.enabled}
                  onChange={() =>
                    setVault((s) => ({
                      ...s,
                      chain: s.chain.map((x) => (x.id === c.id ? { ...x, enabled: !x.enabled } : x)),
                    }))
                  }
                  className="accent-primary"
                  aria-label="Enabled"
                />
                <span className="w-4 font-mono text-xs text-muted-foreground">{i + 1}</span>
                <Tag>{PROVIDER_LABEL[c.provider]}</Tag>
                <span className="flex-1 truncate font-mono text-sm">{c.model}</span>
                {cd && cd.until > now && (
                  <button
                    onClick={() =>
                      setVault((s) => {
                        const n = { ...s.cooldowns };
                        delete n[c.id];
                        return { ...s, cooldowns: n };
                      })
                    }
                    title="Clear cooldown"
                  >
                    <Tag tone="warn">
                      {cd.reason} · {Math.ceil((cd.until - now) / 1000)}s ✕
                    </Tag>
                  </button>
                )}
                <button
                  onClick={() => move(i, -1)}
                  className="text-muted-foreground hover:text-primary"
                  aria-label="Up"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  className="text-muted-foreground hover:text-primary"
                  aria-label="Down"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  onClick={() => setVault((s) => ({ ...s, chain: s.chain.filter((x) => x.id !== c.id) }))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ol>
      </Panel>
      <Panel title="Add model">
        <div className="space-y-3">
          <select
            value={prov}
            onChange={(e) => setProv(e.target.value as ProviderId)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
          >
            {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
          <Field value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" list="model-suggest" />
          <datalist id="model-suggest">
            {SUGGEST[prov].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-1">
            {SUGGEST[prov].map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className="font-mono text-[10px] text-muted-foreground hover:text-primary"
              >
                {m}
              </button>
            ))}
          </div>
          <Btn
            className="w-full"
            disabled={!model}
            onClick={() => {
              setVault((s) => ({ ...s, chain: [...s.chain, newEntry(prov, model)] }));
              setModel("");
            }}
          >
            Add to chain
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
