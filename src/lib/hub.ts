// Isomorphic generation helpers (browser + server). Each takes a `fx` fetcher so the
// browser can route through the relay while the server calls providers directly.
import type { ChainEntry, Keys } from "./vault";
import { expandChain } from "./pool";
import { hasKeys, type Msg } from "./providers";

export type Fx = (
  url: string,
  init: { method?: string; auth?: string; body?: BodyInit; contentType?: string; signal?: AbortSignal },
) => Promise<Response>;

export const directFx: Fx = (url, i) => {
  const headers: Record<string, string> = {};
  if (i.auth) headers["authorization"] = i.auth;
  if (i.contentType) headers["content-type"] = i.contentType;
  return fetch(url, { method: i.method ?? "POST", headers, body: i.body ?? null, signal: i.signal ?? null });
};

export type MediaModel = { id: string; label: string; provider: "cloudflare" | "pollinations" };

export const IMAGE_MODELS: MediaModel[] = [
  { id: "@cf/black-forest-labs/flux-1-schnell", label: "Flux Schnell (CF)", provider: "cloudflare" },
  { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", label: "SDXL (CF)", provider: "cloudflare" },
  { id: "@cf/bytedance/stable-diffusion-xl-lightning", label: "SDXL Lightning (CF)", provider: "cloudflare" },
  { id: "flux", label: "Pollinations Flux (no key)", provider: "pollinations" },
];

const cfBase = (k: Keys) => `https://api.cloudflare.com/client/v4/accounts/${k.cfAccount}/ai`;

export function chatUrl(e: ChainEntry, k: Keys): { url: string; auth: string } {
  switch (e.provider) {
    case "groq":
      return { url: "https://api.groq.com/openai/v1/chat/completions", auth: `Bearer ${k.groq}` };
    case "gemini":
      return { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", auth: `Bearer ${k.gemini}` };
    case "openrouter":
      return { url: "https://openrouter.ai/api/v1/chat/completions", auth: `Bearer ${k.openrouter}` };
    case "cloudflare":
      return { url: `${cfBase(k)}/v1/chat/completions`, auth: `Bearer ${k.cfToken}` };
  }
}

function err(res: Response, text: string) {
  return Object.assign(new Error(`${res.status}: ${text.slice(0, 200)}`), { status: res.status });
}

type MediaJson = { result?: { image?: string } };

async function toBlob(res: Response, jsonField: (j: MediaJson) => string | undefined, mime: string): Promise<Blob> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = (await res.json()) as MediaJson;
    const b64 = jsonField(j);
    if (b64?.startsWith("http")) return (await fetch(b64)).blob();
    if (!b64) throw new Error(`No media in response: ${JSON.stringify(j).slice(0, 160)}`);
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: mime });
  }
  return res.blob();
}

export async function genImage(fx: Fx, k: Keys, m: MediaModel, prompt: string): Promise<Blob> {
  if (m.provider === "pollinations") {
    const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${m.id}&nologo=true`);
    if (!res.ok) throw err(res, await res.text());
    return res.blob();
  }
  if (m.provider === "cloudflare") {
    if (!k.cfAccount || !k.cfToken) throw new Error("no Cloudflare key");
    const res = await fx(`${cfBase(k)}/run/${m.id}`, {
      auth: `Bearer ${k.cfToken}`,
      body: JSON.stringify({ prompt, steps: m.id.includes("flux") ? 4 : 20 }),
      contentType: "application/json",
    });
    if (!res.ok) throw err(res, await res.text());
    return toBlob(res, (j) => j.result?.image, "image/jpeg");
  }
  throw new Error("Unsupported image provider");
}

export type Hop = { model: string; ok: boolean; detail: string };

export async function failover<T, M extends { id: string }>(models: M[], run: (m: M) => Promise<T>) {
  const hops: Hop[] = [];
  for (const m of models) {
    try {
      const out = await run(m);
      hops.push({ model: m.id, ok: true, detail: "served" });
      return { out, model: m, hops };
    } catch (e) {
      hops.push({ model: m.id, ok: false, detail: (e as Error).message.slice(0, 160) });
    }
  }
  return { out: null, model: null, hops };
}

/** Order models so the preferred id goes first. */
export const preferFirst = (list: MediaModel[], id?: string) =>
  id ? [...list.filter((m) => m.id === id), ...list.filter((m) => m.id !== id)] : list;

export type ChatOptions = {
  model?: string | undefined;
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  signal?: AbortSignal;
  unavailable?: Set<string>;
};
export type ChatOutput = {
  id?: string;
  created?: number;
  error?: { code?: number | string; message?: string };
  choices: { index?: number; message: { role?: string; content: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/** Shared hosted-chat adapter: the same failover loop as media, with full history on every hop. */
export async function runHostedChat(fx: Fx, keys: Keys, chain: ChainEntry[], messages: Msg[], opts: ChatOptions = {}) {
  const enabled = expandChain(
    chain.filter((e) => e.enabled),
    keys,
  ).filter((e) => hasKeys(e.provider, e.keys) && !opts.unavailable?.has(e.id));
  const preferred = opts.model && opts.model !== "freeflow" ? opts.model : undefined;
  const ordered = preferred
    ? [...enabled.filter((e) => e.model === preferred), ...enabled.filter((e) => e.model !== preferred)]
    : enabled;
  return failover(ordered, async (entry) => {
    opts.signal?.throwIfAborted();
    const { url, auth } = chatUrl(entry, entry.keys);
    let response: Response;
    try {
      response = await fx(url, {
        auth,
        contentType: "application/json",
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        body: JSON.stringify({
          model: entry.model,
          messages,
          stream: false,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.max_tokens !== undefined ? { max_tokens: opts.max_tokens } : {}),
        }),
      });
    } catch {
      opts.unavailable?.add(entry.id);
      throw new Error("Provider unreachable or timed out");
    }
    // Do not propagate upstream text: provider errors may echo credentials.
    if (!response.ok) {
      opts.unavailable?.add(entry.id);
      if ([401, 403, 402].includes(response.status)) {
        for (const sibling of enabled) {
          if (sibling.provider === entry.provider && sibling.keys === entry.keys) opts.unavailable?.add(sibling.id);
        }
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json().catch(() => null)) as ChatOutput | null;
    if (data?.error) {
      opts.unavailable?.add(entry.id);
      throw new Error(`Provider error ${data.error.code ?? ""}`.trim());
    }
    if (
      !data ||
      !Array.isArray(data.choices) ||
      !data.choices.length ||
      data.choices.some((c) => !c?.message || typeof c.message.content !== "string")
    ) {
      opts.unavailable?.add(entry.id);
      throw new Error("Invalid provider response");
    }
    return data;
  });
}
