import { describe, expect, it, vi } from "vitest";
import { handleChatCompletion, handleModels } from "@/lib/openai-api";
import type { SavedRelay } from "@/lib/relay-auth";

const token = "ffr_test_only_not_a_real_token_123456";
const saved: SavedRelay = {
  keys: { groq: "test-groq-secret", gemini: "test-gemini-secret", cfAccount: "", cfToken: "", openrouter: "", apiToken: token, zep: "" },
  chain: [
    { id: "a", provider: "groq", model: "llama-3.3-70b-versatile", enabled: true },
    { id: "b", provider: "gemini", model: "gemini-2.5-flash", enabled: true },
  ],
};
const lookup = async (value: string) => value === token ? saved : null;
const messages = [{ role: "system", content: "Keep the user's scene context" }, { role: "user", content: "Scene one: forest" }, { role: "assistant", content: "A misty forest" }, { role: "user", content: "Continue that scene" }];
const request = (body: unknown, auth = `Bearer ${token}`) => new Request("https://relay.example/v1/chat/completions", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
const success = () => Response.json({ choices: [{ message: { role: "assistant", content: "Forest scene continued" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }, secret: "must-not-be-returned" });

describe("OpenAI relay", () => {
  it("requires a matching personal Bearer token before contacting a provider", async () => {
    const fx = vi.fn();
    const response = await handleChatCompletion(request({ model: "freeflow", messages }, "Bearer invalid_token_that_is_long_enough"), lookup, fx);
    expect(response.status).toBe(401);
    expect(fx).not.toHaveBeenCalled();
    expect((await response.json()).error.code).toBe("invalid_api_key");
  });
  it("rejects a token without the Bearer scheme", async () => {
    expect((await handleChatCompletion(request({ model: "freeflow", messages }, token), lookup)).status).toBe(401);
  });
  it("preserves system prompts and full history on rate-limit failover", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fx = vi.fn(async (_url: string, init: { body?: BodyInit }) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? new Response("quota exhausted", { status: 429 }) : success();
    });
    const response = await handleChatCompletion(request({ model: "freeflow", messages }), lookup, fx);
    expect(response.status).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.["messages"]).toEqual(messages);
    expect(bodies[1]?.["messages"]).toEqual(messages);
    expect((await response.json()).model).toBe("gemini-2.5-flash");
  });
  it("forwards temperature and max_tokens on every hop", async () => {
    const bodies: Record<string, unknown>[] = [];
    await handleChatCompletion(request({ model: "freeflow", messages, temperature: 0.7, max_tokens: 256 }), lookup, async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? new Response("fail", { status: 500 }) : success();
    });
    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(body).toMatchObject({ temperature: 0.7, max_tokens: 256, stream: false });
  });
  it("prioritizes the selected enabled model without removing fallbacks", async () => {
    const models: string[] = [];
    const response = await handleChatCompletion(request({ model: "gemini-2.5-flash", messages }), lookup, async (_url, init) => {
      models.push(JSON.parse(String(init.body)).model);
      return models.length === 1 ? new Response("error", { status: 500 }) : success();
    });
    expect(response.status).toBe(200);
    expect(models).toEqual(["gemini-2.5-flash", "llama-3.3-70b-versatile"]);
  });
  it("returns standard completion fields and usage, not arbitrary provider fields", async () => {
    const response = await handleChatCompletion(request({ model: "freeflow", messages }), lookup, async () => success());
    const data = await response.json();
    expect(data).toMatchObject({ object: "chat.completion", model: "llama-3.3-70b-versatile", choices: [{ index: 0, message: { role: "assistant", content: "Forest scene continued" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } });
    expect(data.id).toMatch(/^chatcmpl-/);
    expect(data.created).toBeGreaterThan(0);
    expect(data.secret).toBeUndefined();
  });
  it("does not expose provider secrets in errors", async () => {
    const response = await handleChatCompletion(request({ model: "freeflow", messages }), lookup, async () => { throw new Error(saved.keys.groq); });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(saved.keys.groq);
  });
  it("rejects unsupported streaming explicitly", async () => {
    const fx = vi.fn();
    const response = await handleChatCompletion(request({ model: "freeflow", messages, stream: true }), lookup, fx);
    expect(response.status).toBe(400);
    expect((await response.json()).error.param).toBe("stream");
    expect(fx).not.toHaveBeenCalled();
  });
  it("returns 400 for malformed requests", async () => {
    expect((await handleChatCompletion(request({ model: "freeflow", messages: [] }), lookup)).status).toBe(400);
  });
  it("returns 404 for unconfigured models", async () => {
    expect((await handleChatCompletion(request({ model: "not-configured", messages }), lookup)).status).toBe(404);
  });
  it("authenticates model listing and includes only enabled configured chat models", async () => {
    expect((await handleModels(new Request("https://relay.example/v1/models"), lookup)).status).toBe(401);
    const response = await handleModels(new Request("https://relay.example/v1/models", { headers: { authorization: `Bearer ${token}` } }), lookup);
    expect((await response.json()).data.map((m: { id: string }) => m.id)).toEqual(["freeflow", "llama-3.3-70b-versatile", "gemini-2.5-flash"]);
  });
});