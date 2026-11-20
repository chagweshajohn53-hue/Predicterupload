import { z } from "zod";
import { directFx, runHostedChat, type ChatOutput, type Fx } from "./hub";
import { hasKeys } from "./providers";
import type { SavedRelay } from "./relay-auth";

export type TokenLookup = (token: string) => Promise<SavedRelay | null>;
export const OPENAI_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};
export const openAIOptions = () => new Response(null, { status: 204, headers: OPENAI_HEADERS });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: OPENAI_HEADERS });
export const apiError = (message: string, status: number, code: string, param: string | null = null) =>
  json({ error: { message, type: status === 401 ? "authentication_error" : status >= 500 ? "server_error" : "invalid_request_error", param, code } }, status);
export const openAIMethodNotAllowed = () => apiError("Method not allowed", 405, "method_not_allowed");

const ChatRequest = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(100_000) })).min(1).max(200),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(131_072).optional(),
  stream: z.boolean().default(false),
});

async function authenticate(request: Request, lookup: TokenLookup) {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1];
  if (!token || token.length < 24 || token.length > 256) return null;
  const saved = await lookup(token);
  return saved?.keys.apiToken === token ? saved : null;
}

function completion(data: ChatOutput, model: string) {
  const prompt = data.usage?.prompt_tokens ?? 0;
  const generated = data.usage?.completion_tokens ?? 0;
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: data.choices.map((choice, index) => ({ index, message: { role: "assistant", content: choice.message.content }, finish_reason: choice.finish_reason ?? "stop" })),
    usage: { prompt_tokens: prompt, completion_tokens: generated, total_tokens: data.usage?.total_tokens ?? prompt + generated },
  };
}

export async function handleChatCompletion(request: Request, lookup: TokenLookup, fx: Fx = directFx) {
  try {
    const vault = await authenticate(request, lookup);
    if (!vault) return apiError("Missing or invalid API token", 401, "invalid_api_key");
    const parsed = ChatRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError("Invalid chat request", 400, "invalid_request", parsed.error.issues[0]?.path.join(".") ?? null);
    const body = parsed.data;
    if (body.stream) return apiError("Streaming is not supported by this endpoint. Set stream to false.", 400, "unsupported_value", "stream");
    if (body.model !== "freeflow" && !vault.chain.some((e) => e.enabled && hasKeys(e.provider, vault.keys) && e.model === body.model)) {
      return apiError("Model is not enabled or has no configured provider key. Use freeflow or GET /v1/models.", 404, "model_not_found", "model");
    }
    const result = await runHostedChat(fx, vault.keys, vault.chain, body.messages, body);
    if (!result.out || !result.model) return apiError("All configured providers are unavailable. Please try again later.", 503, "providers_unavailable");
    return json(completion(result.out, result.model.model));
  } catch {
    return apiError("The relay is temporarily unavailable", 503, "relay_unavailable");
  }
}

export async function handleModels(request: Request, lookup: TokenLookup) {
  try {
    const vault = await authenticate(request, lookup);
    if (!vault) return apiError("Missing or invalid API token", 401, "invalid_api_key");
    const models = new Map([["freeflow", "freeflow"]]);
    for (const entry of vault.chain) {
      if (entry.enabled && hasKeys(entry.provider, vault.keys)) models.set(entry.model, entry.provider);
    }
    return json({ object: "list", data: [...models].map(([id, owner]) => ({ id, object: "model", created: 0, owned_by: owner })) });
  } catch {
    return apiError("The relay is temporarily unavailable", 503, "relay_unavailable");
  }
}