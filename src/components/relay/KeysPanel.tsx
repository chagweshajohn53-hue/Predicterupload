import { useState } from "react";
import { claudeAnalysis } from "@/lib/claude.functions";
import { CLAUDE_MODEL } from "@/lib/claude";
import { Eye, EyeOff } from "lucide-react";
import { testProvider } from "@/lib/providers";
import { zepTest } from "@/lib/zep";
import { setVault, useVault, type ExtraKeys, type Keys, type ProviderId } from "@/lib/vault";
import { Btn, Field, Panel, Tag } from "./ui";

const ROWS: {
  id: ProviderId;
  label: string;
  fields: { k: Exclude<keyof Keys, "extra">; label: string; secret: boolean }[];
  hint: string;
}[] = [
  { id: "gemini", label: "Google Gemini", fields: [{ k: "gemini", label: "API key", secret: true }], hint: "aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", fields: [{ k: "groq", label: "API key", secret: true }], hint: "console.groq.com/keys" },
  { id: "openrouter", label: "OpenRouter", fields: [{ k: "openrouter", label: "API key", secret: true }], hint: "openrouter.ai/keys" },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    fields: [
      { k: "cfAccount", label: "Account ID", secret: false },
      { k: "cfToken", label: "API token", secret: true },
    ],
    hint: "dash.cloudflare.com → AI → Workers AI",
  },
];

function SecretInput({
  value,
  onChange,
  secret,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  secret: boolean;
  placeholder: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field
        type={secret && !show ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-9"
      />
      {secret && (
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
          aria-label="Toggle visibility"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      )}
    </div>
  );
}

export function KeysPanel() {
  const { keys } = useVault();
  const [res, setRes] = useState<Record<string, { ok: boolean; msg: string } | "loading">>({});
  const test = async (p: ProviderId) => {
    setRes((r) => ({ ...r, [p]: "loading" }));
    try {
      await testProvider(p, keys);
      setRes((r) => ({ ...r, [p]: { ok: true, msg: "Connected" } }));
    } catch (e) {
      setRes((r) => ({ ...r, [p]: { ok: false, msg: String((e as Error).message) } }));
    }
  };
  const claudeStatus = res["claude"];
  const zepStatus = res["zep"];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel
        title="Claude Haiku 5.5 · chart decoder & SL/TP reviewer"
        right={
          claudeStatus === "loading" ? (
            <Tag>testing…</Tag>
          ) : claudeStatus ? (
            <Tag tone={claudeStatus.ok ? "ok" : "bad"}>{claudeStatus.ok ? "connected" : "failed"}</Tag>
          ) : null
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">API key ({CLAUDE_MODEL})</span>
            <SecretInput
              value={keys.anthropic ?? ""}
              secret
              placeholder="Anthropic API key (sk-ant-...)"
              onChange={(v) => setVault((s) => ({ ...s, keys: { ...s.keys, anthropic: v } }))}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">console.anthropic.com/settings/keys</span>
            <Btn
              variant="ghost"
              disabled={claudeStatus === "loading"}
              onClick={async () => {
                setRes((r) => ({ ...r, claude: "loading" }));
                try {
                  const apiKey = keys.anthropic?.trim();
                  await claudeAnalysis({
                    data: {
                      task: "test",
                      ...(apiKey ? { apiKey } : {}),
                      messages: [],
                      images: [],
                    },
                  });
                  setRes((r) => ({ ...r, claude: { ok: true, msg: "Connected" } }));
                } catch (e) {
                  const msg =
                    e instanceof Error
                      ? e.message
                      : typeof e === "object" && e !== null && "message" in e
                        ? String((e as { message: unknown }).message)
                        : String(e);
                  setRes((r) => ({ ...r, claude: { ok: false, msg } }));
                }
              }}
            >
              Test Claude
            </Btn>
          </div>
          <p className="text-xs text-muted-foreground">
            Decodes uploaded charts into structured levels, price action, and indicator sections for the simulation departments, then tallies votes, highlights the strongest argument, and picks the best SL & TP. Falls back to server ANTHROPIC_API_KEY if left blank.
          </p>
          {claudeStatus && claudeStatus !== "loading" && !claudeStatus.ok && (
            <p className="break-all font-mono text-xs text-destructive">{claudeStatus.msg}</p>
          )}
        </div>
      </Panel>
      {ROWS.map((row) => {
        const r = res[row.id];
        return (
          <Panel
            key={row.id}
            title={row.label}
            right={
              r === "loading" ? (
                <Tag>testing…</Tag>
              ) : r ? (
                <Tag tone={r.ok ? "ok" : "bad"}>{r.ok ? "connected" : "failed"}</Tag>
              ) : null
            }
          >
            <div className="space-y-3">
              {row.fields.map((f) => (
                <label key={f.k} className="block space-y-1">
                  <span className="text-xs text-muted-foreground">{f.label}</span>
                  <SecretInput
                    value={keys[f.k] ?? ""}
                    secret={f.secret}
                    placeholder={f.label}
                    onChange={(v) => setVault((s) => ({ ...s, keys: { ...s.keys, [f.k]: v } }))}
                  />
                </label>
              ))}
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{row.hint}</span>
                <Btn variant="ghost" onClick={() => test(row.id)} disabled={r === "loading"}>
                  Test
                </Btn>
              </div>
              {r && r !== "loading" && !r.ok && <p className="break-all font-mono text-xs text-destructive">{r.msg}</p>}
              <BackupKeys row={row} keys={keys} />
            </div>
          </Panel>
        );
      })}
      <Panel
        title="Zep graph memory (Swarm)"
        right={
          zepStatus === "loading" ? (
            <Tag>testing…</Tag>
          ) : zepStatus ? (
            <Tag tone={zepStatus.ok ? "ok" : "bad"}>{zepStatus.ok ? "connected" : "failed"}</Tag>
          ) : null
        }
      >
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">API key</span>
            <SecretInput
              value={keys.zep}
              secret
              placeholder="Zep API key"
              onChange={(v) => setVault((s) => ({ ...s, keys: { ...s.keys, zep: v } }))}
            />
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">app.getzep.com → API keys</span>
            <Btn
              variant="ghost"
              disabled={!keys.zep || zepStatus === "loading"}
              onClick={async () => {
                setRes((r) => ({ ...r, zep: "loading" }));
                try {
                  await zepTest(keys.zep);
                  setRes((r) => ({ ...r, zep: { ok: true, msg: "Connected" } }));
                } catch (e) {
                  setRes((r) => ({ ...r, zep: { ok: false, msg: (e as Error).message } }));
                }
              }}
            >
              Test
            </Btn>
          </div>
          {zepStatus && zepStatus !== "loading" && !zepStatus.ok && (
            <p className="break-all font-mono text-xs text-destructive">{zepStatus.msg}</p>
          )}
        </div>
      </Panel>
      <p className="text-xs text-muted-foreground md:col-span-2">
        Keys are saved to your Firebase Firestore vault and sync across devices.
      </p>
    </div>
  );
}

function BackupKeys({ row, keys }: { row: (typeof ROWS)[number]; keys: Keys }) {
  const extra = keys.extra ?? [];
  const set = (i: number, k: keyof ExtraKeys, v: string) =>
    setVault((s) => {
      const list = [...(s.keys.extra ?? [])];
      while (list.length <= i) list.push({});
      list[i] = { ...list[i], [k]: v };
      return { ...s, keys: { ...s.keys, extra: list } };
    });
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Backup accounts (used when the main one hits its limit)
      </summary>
      <div className="mt-2 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1">
            <span className="text-xs text-muted-foreground">Backup {i + 1}</span>
            {row.fields.map((f) => (
              <SecretInput
                key={f.k}
                value={(extra[i]?.[f.k as keyof ExtraKeys] as string) ?? ""}
                secret={f.secret}
                placeholder={f.label}
                onChange={(v) => set(i, f.k as keyof ExtraKeys, v)}
              />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
