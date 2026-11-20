import type { Keys, ProviderId } from "./vault";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export function relay(url: string, opts: { auth?: string; method?: string; body?: BodyInit; contentType?: string; signal?: AbortSignal | undefined }) {
  const headers: Record<string, string> = { "x-target-url": url, "x-fwd-method": opts.method ?? "POST" };
  if (opts.auth) headers["x-fwd-authorization"] = opts.auth;
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return fetch("/api/public/relay", { method: "POST", headers, body: opts.body ?? "", signal: opts.signal ?? null });
}

export function hasKeys(p: ProviderId, k: Keys) {
  if (p === "cloudflare") return !!(k.cfAccount && k.cfToken);
  return !!k[p];
}

const cfBase = (k: Keys) => `https://api.cloudflare.com/client/v4/accounts/${k.cfAccount}/ai`;

export function chatEndpoint(p: ProviderId, k: Keys): { url: string; auth: string } {
  switch (p) {
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

export function chatBody(p: ProviderId, model: string, messages: Msg[], images?: string[]) {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") { lastUser = i; break; }
  }
  const wireMessages = images?.length ? messages.map((m, i) => i === lastUser ? {
    ...m, content: [{ type: "text", text: m.content }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))],
  } : m) : messages;
  const body: Record<string, unknown> = { model, messages: wireMessages, stream: true };
  if (p === "groq" || p === "openrouter") body["stream_options"] = { include_usage: true };
  return JSON.stringify(body);
}

export async function testProvider(p: ProviderId, k: Keys): Promise<string> {
  const map: Record<ProviderId, { url: string; auth: string }> = {
    groq: { url: "https://api.groq.com/openai/v1/models", auth: `Bearer ${k.groq}` },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/models", auth: `Bearer ${k.gemini}` },
    openrouter: { url: "https://openrouter.ai/api/v1/key", auth: `Bearer ${k.openrouter}` },
    cloudflare: { url: `${cfBase(k)}/models/search?per_page=1`, auth: `Bearer ${k.cfToken}` },
  };
  const { url, auth } = map[p];
  const res = await relay(url, { auth, method: "GET" });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error("Server relay (/api/public/relay) returned non-JSON response — check that the SSR server is active");
  }
  const data = (await res.json().catch(() => null)) as { error?: { message?: string }; success?: boolean } | null;
  if (!data || data.error || data.success === false) {
    throw new Error(data?.error?.message ?? "Malformed provider JSON response");
  }
  return "Connected";
}

export async function cfImage(k: Keys, model: string, prompt: string) {
  const res = await relay(`${cfBase(k)}/run/${model}`, {
    auth: `Bearer ${k.cfToken}`,
    body: JSON.stringify({ prompt, steps: model.includes("flux") ? 4 : 20 }),
    contentType: "application/json",
  });
  if (!res.ok) throw Object.assign(new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = await res.json();
    return `data:image/jpeg;base64,${j.result?.image}`;
  }
  return URL.createObjectURL(await res.blob());
}

export async function groqTranscribe(k: Keys, file: Blob) {
  const fd = new FormData();
  fd.append("file", file, "audio.webm");
  fd.append("model", "whisper-large-v3-turbo");
  const res = await relay("https://api.groq.com/openai/v1/audio/transcriptions", { auth: `Bearer ${k.groq}`, body: fd });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).text as string) ?? "";
}

export async function cfTranscribe(k: Keys, file: Blob) {
  const res = await relay(`${cfBase(k)}/run/@cf/openai/whisper`, {
    auth: `Bearer ${k.cfToken}`,
    body: file,
    contentType: file.type || "application/octet-stream",
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).result?.text as string) ?? "";
}

export async function cfSpeak(k: Keys, text: string, speaker: string) {
  const res = await relay(`${cfBase(k)}/run/@cf/deepgram/aura-1`, {
    auth: `Bearer ${k.cfToken}`,
    body: JSON.stringify({ text, speaker }),
    contentType: "application/json",
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = await res.json();
    return `data:audio/mpeg;base64,${j.result?.audio}`;
  }
  return URL.createObjectURL(await res.blob());
}
