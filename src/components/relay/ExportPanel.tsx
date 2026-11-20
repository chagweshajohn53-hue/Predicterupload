import { useState } from "react";
import { chatEndpoint } from "@/lib/providers";
import { setVault, useVault, type Keys } from "@/lib/vault";
import { Btn, Panel } from "./ui";

const PLACE: Keys = {
  groq: "$GROQ_API_KEY",
  gemini: "$GEMINI_API_KEY",
  openrouter: "$OPENROUTER_API_KEY",
  cfAccount: "$CF_ACCOUNT_ID",
  cfToken: "$CF_API_TOKEN",
  apiToken: "",
  zep: "",
};
const ENV: Record<string, string> = {
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cloudflare: "CF_API_TOKEN",
};

function Code({ title, code }: { title: string; code: string }) {
  const [c, setC] = useState(false);
  return (
    <Panel
      title={title}
      right={
        <Btn
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setC(true);
            setTimeout(() => setC(false), 1200);
          }}
        >
          {c ? "Copied" : "Copy"}
        </Btn>
      }
    >
      <pre className="max-h-[440px] overflow-auto font-mono text-xs leading-relaxed text-muted-foreground">{code}</pre>
    </Panel>
  );
}

export function ExportPanel() {
  const { chain, keys } = useVault();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-app-url";
  const endpoint = `${origin}/api/public/v1/generate`;

  const tok = keys.apiToken || "YOUR_API_TOKEN";
  const openai = `# MiroFish / OpenAI-compatible settings
Base URL: ${origin}/v1
Chat: POST ${origin}/v1/chat/completions
Models: GET ${origin}/v1/models
Predict: POST ${origin}/api/public/v1/predict
Authorization: Bearer ${tok}
Model: freeflow
Streaming: false (not supported by this endpoint)

# Fallback public base URL:
${origin}/api/public/v1

# Full conversation history is retained on every failover hop.
# Available names are returned by GET /models for your saved keys.
${activeModels(chain)}

curl ${origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${tok}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"freeflow","messages":[{"role":"system","content":"You are a research assistant."},{"role":"user","content":"Summarize our discussion."}],"temperature":0.7,"max_tokens":512,"stream":false}'`;

  const makeToken = () => {
    const a = new Uint8Array(24);
    crypto.getRandomValues(a);
    setVault((s) => ({
      ...s,
      keys: { ...s.keys, apiToken: "ffr_" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("") },
    }));
  };

  const hosted = `// Hosted failover API — one URL for chat, image, and Claude+Swarm predictions.
// Your saved keys and router order are used server-side; history you send is kept across fallbacks.
const API = "${endpoint}";
const TOKEN = "${tok}";

async function relay(body: object) {
  const res = await fetch(API, { method: "POST", headers: { Authorization: \`Bearer \${TOKEN}\`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res;
}

// 1) Chat completion with failover
const chat = await (await relay({ type: "chat", messages: [{ role: "user", content: "Summarize EURUSD macro catalysts" }] })).json();
console.log(chat.served_by, chat.choices[0].message.content);

// 2) Keyframe image
const frame = await (await relay({ type: "image", prompt: "Misty forest at sunrise, cinematic" })).blob();`;

  const hostedCurl = `curl ${endpoint} \\
  -H "Authorization: Bearer ${tok}" -H "Content-Type: application/json" \\
  -d '{"type":"image","prompt":"Drone shot over a misty forest"}' --output frame.jpg`;

  const active = chain.filter((c) => c.enabled);
  const ts = `// OpenAI-compatible failover client — drop into any Node/edge app.
const CHAIN = [
${active
  .map((c) => {
    const { url } = chatEndpoint(c.provider, { ...PLACE, cfAccount: "${process.env.CF_ACCOUNT_ID}" });
    return `  { url: \`${url}\`, key: process.env.${ENV[c.provider]}, model: ${JSON.stringify(c.model)} },`;
  })
  .join("\n")}
];
const cooldown = new Map<string, number>();

export async function unifiedChat(messages: { role: string; content: string }[], opts: Record<string, unknown> = {}) {
  for (const p of CHAIN) {
    const id = p.url + p.model;
    if ((cooldown.get(id) ?? 0) > Date.now() || !p.key) continue;
    const res = await fetch(p.url, {
      method: "POST",
      headers: { Authorization: \`Bearer \${p.key}\`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: p.model, messages, ...opts }),
    });
    if (res.ok) return { provider: p.model, response: await res.json() };
    const body = await res.text();
    if (res.status === 429 || /quota|rate.?limit|exhaust/i.test(body)) {
      const ra = Number(res.headers.get("retry-after")) || 60;
      cooldown.set(id, Date.now() + ra * 1000);
    }
    // fall through to next provider with the same full history
  }
  throw new Error("All providers exhausted");
}`;

  const first = active[0];
  const fe = first ? chatEndpoint(first.provider, PLACE) : null;
  const curl =
    fe && first
      ? `# Primary hop (${first.model}). Swap URL/model for each fallback.
curl ${fe.url} \\
  -H "Authorization: Bearer ${first.provider === "cloudflare" ? PLACE.cfToken : (PLACE as unknown as Record<string, string>)[first.provider]}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${first.model}","messages":[{"role":"user","content":"Hello"}]}'

# Fallback loop in bash
for hop in ${active.map((c) => `"${chatEndpoint(c.provider, PLACE).url}|${c.model}|${ENV[c.provider]}"`).join(" \\\n  ")}; do
  IFS='|' read url model keyvar <<< "$hop"
  code=$(curl -s -o /tmp/out.json -w '%{http_code}' "$url" \\
    -H "Authorization: Bearer \${!keyvar}" -H "Content-Type: application/json" \\
    -d "{\\"model\\":\\"$model\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}")
  [ "$code" = "200" ] && { echo "served by $model"; cat /tmp/out.json; break; }
  echo "$model -> $code, failing over"
done`
      : "# Enable at least one model in the chain.";

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Your API token" right={<Btn onClick={makeToken}>{keys.apiToken ? "Regenerate" : "Create token"}</Btn>}>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {keys.apiToken || "No token yet — create one to call the hosted failover & prediction endpoints."}
        </p>
      </Panel>
      <Code title="MiroFish · OpenAI-compatible API" code={openai} />
      <Code title="cURL · hosted image" code={hostedCurl} />
      <Code title="Hosted API" code={hosted} />
      <Code title="TypeScript failover helper" code={ts} />
      <Code title="cURL" code={curl} />
    </div>
  );
}

function activeModels(chain: { enabled: boolean; model: string }[]) {
  return ["freeflow", ...new Set(chain.filter((entry) => entry.enabled).map((entry) => entry.model))].join("\n");
}
