import { chatBody, chatEndpoint, hasKeys, relay, type Msg } from "./providers";
import { expandChain, getVault, setVault, type ChainEntry, type Keys, type ProviderId } from "./vault";
import { supportsImages } from "./vision";

export type Attempt = { entry: ChainEntry; outcome: "ok" | "rate_limited" | "error" | "skipped"; detail: string };
export type ChatResult = {
  entry: ChainEntry | null;
  attempts: Attempt[];
  ttft: number;
  total: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
};

/** Parse "2m59.5s", "7.6s", "120ms", "30", epoch ms/seconds → milliseconds from now. */
export function parseReset(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1e12) return Math.max(0, n - Date.now());
    if (n > 1e9) return Math.max(0, n * 1000 - Date.now());
    return n * 1000;
  }
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/);
  if (!m || !m[0]) return null;
  return ((+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + +(m[3] ?? 0)) * 1000 + +(m[4] ?? 0);
}

export function isRateLimit(status: number, text: string) {
  return status === 429 || status === 402 || /rate.?limit|quota|exhaust|too many requests|resource_exhausted|capacity/i.test(text);
}

function keySignature(p: ProviderId, k: Keys): string {
  return p === "cloudflare" ? `${k.cfAccount}:${k.cfToken}` : k[p];
}

function recordStatus(id: string, res: Response) {
  const h = res.headers;
  setVault((s) => ({
    ...s,
    status: {
      ...s.status,
      [id]: {
        remainingReq: h.get("x-ratelimit-remaining-requests") ?? h.get("x-ratelimit-remaining") ?? undefined,
        remainingTok: h.get("x-ratelimit-remaining-tokens") ?? undefined,
        resetReq: h.get("x-ratelimit-reset-requests") ?? h.get("x-ratelimit-reset") ?? undefined,
        lastStatus: res.status,
        at: Date.now(),
      },
    },
  }));
}

function cooldown(id: string, ms: number, reason: string) {
  setVault((s) => ({ ...s, cooldowns: { ...s.cooldowns, [id]: { until: Date.now() + ms, reason } } }));
}

function cooldownMatchingKey(entries: { id: string; provider: ProviderId; keys: Keys }[], target: { provider: ProviderId; keys: Keys }, ms: number, reason: string) {
  const sig = keySignature(target.provider, target.keys);
  const until = Date.now() + ms;
  setVault((s) => {
    const next = { ...s.cooldowns };
    for (const e of entries) {
      if (e.provider === target.provider && keySignature(e.provider, e.keys) === sig) {
        next[e.id] = { until, reason };
      }
    }
    return { ...s, cooldowns: next };
  });
}

async function readWithTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Stream timed out waiting for model tokens")), ms);
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("Aborted")), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type StreamChunk = {
  error?: string | { message?: string; code?: number };
  choices?: { delta?: { content?: string }; message?: { content?: string } }[];
  usage?: ChatResult["usage"];
};

export async function runChat(opts: {
  messages: Msg[];
  images?: string[];
  signal?: AbortSignal;
  onToken: (t: string) => void;
  onAttempt: (a: Attempt) => void;
  onStart: (e: ChainEntry) => void;
}): Promise<ChatResult> {
  const { keys: baseKeys, chain } = getVault();
  const expanded = expandChain(
    chain.filter((c) => c.enabled),
    baseKeys,
  );
  const attempts: Attempt[] = [];
  const push = (a: Attempt) => {
    attempts.push(a);
    opts.onAttempt(a);
  };
  const t0 = performance.now();

  for (const entry of expanded) {
    opts.signal?.throwIfAborted();
    if (opts.images?.length && !supportsImages(entry)) continue;
    const keys = entry.keys;
    const cd = getVault().cooldowns[entry.id];
    if (cd && cd.until > Date.now()) {
      push({ entry, outcome: "skipped", detail: `cooling down (${Math.ceil((cd.until - Date.now()) / 1000)}s)` });
      continue;
    }
    if (!hasKeys(entry.provider, keys)) {
      push({ entry, outcome: "skipped", detail: "no API key" });
      continue;
    }
    opts.onStart(entry);
    const { url, auth } = chatEndpoint(entry.provider, keys);
    const start = performance.now();
    let res: Response;
    try {
      const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
      res = await relay(url, {
        auth,
        body: chatBody(entry.provider, entry.model, opts.messages, opts.images),
        contentType: "application/json",
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      cooldown(entry.id, 45_000, "unreachable");
      push({ entry, outcome: "error", detail: String(e) });
      continue;
    }
    recordStatus(entry.id, res);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        cooldownMatchingKey(expanded, entry, 120_000, `HTTP ${res.status}`);
        push({ entry, outcome: "error", detail: `HTTP ${res.status} (auth failed) · skipping key` });
      } else if (isRateLimit(res.status, text)) {
        const ms =
          parseReset(res.headers.get("retry-after")) ??
          parseReset(res.headers.get("x-ratelimit-reset-requests")) ??
          parseReset(res.headers.get("x-ratelimit-reset")) ??
          60_000;
        cooldown(entry.id, Math.max(ms, 5_000), `HTTP ${res.status}`);
        push({ entry, outcome: "rate_limited", detail: `HTTP ${res.status} · cooldown ${Math.round(ms / 1000)}s` });
      } else if (res.status === 404 || (res.status === 400 && /model|not found|decommission|deprecated|does not exist|unsupported/i.test(text))) {
        cooldown(entry.id, 300_000, `HTTP ${res.status}`);
        push({ entry, outcome: "error", detail: `HTTP ${res.status} (model unavailable): ${text.slice(0, 120)}` });
      } else {
        if (res.status >= 500) cooldown(entry.id, 45_000, `HTTP ${res.status}`);
        push({ entry, outcome: "error", detail: `HTTP ${res.status}: ${text.slice(0, 140)}` });
      }
      continue;
    }

    let ttft = 0;
    let got = false;
    let usage: ChatResult["usage"];
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();

    try {
      // Handle providers that reply with non-streaming JSON even when stream=true
      if (ct.includes("application/json") && !ct.includes("text/event-stream")) {
        const j = (await res.json()) as StreamChunk;
        if (j.error) {
          const code = typeof j.error === "object" && j.error.code ? `${j.error.code} ` : "";
          const msg = typeof j.error === "string" ? j.error : j.error.message ?? "provider error";
          throw new Error(`${code}${msg}`);
        }
        const content = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content;
        if (content) {
          ttft = performance.now() - start;
          got = true;
          opts.onToken(content);
        }
        if (j.usage) usage = j.usage;
      } else {
        if (!res.body) throw new Error("The model returned no response stream.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        outer: for (;;) {
          const { value, done } = await readWithTimeout(reader.read(), 30_000, opts.signal);
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith("data:")) continue;
            const data = l.slice(5).trim();
            if (data === "[DONE]") break outer;
            let j: StreamChunk;
            try {
              j = JSON.parse(data) as StreamChunk;
            } catch {
              continue;
            }
            if (j.error) {
              const code = typeof j.error === "object" && j.error.code ? `${j.error.code} ` : "";
              const msg = typeof j.error === "string" ? j.error : j.error.message ?? "stream error";
              throw new Error(`${code}${msg}`);
            }
            const delta = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content;
            if (delta) {
              if (!got) ttft = performance.now() - start;
              got = true;
              opts.onToken(delta);
            }
            if (j.usage) usage = j.usage;
          }
        }
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      const msg = String(e);
      const rateLimited = isRateLimit(0, msg) || /\b429\b/.test(msg);
      cooldown(entry.id, rateLimited ? 60_000 : 30_000, rateLimited ? "stream quota" : "stream error");
      push({ entry, outcome: rateLimited ? "rate_limited" : "error", detail: msg.slice(0, 140) });
      continue;
    }

    if (!got) {
      cooldown(entry.id, 30_000, "empty response");
      push({ entry, outcome: "error", detail: "empty response" });
      continue;
    }
    push({ entry, outcome: "ok", detail: "served" });
    return { entry, attempts, ttft, total: performance.now() - t0, usage };
  }
  return { entry: null, attempts, ttft: 0, total: performance.now() - t0 };
}
