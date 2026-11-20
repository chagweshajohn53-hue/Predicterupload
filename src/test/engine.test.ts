import { afterEach, describe, expect, it, vi } from "vitest";
import { isRateLimit, parseReset } from "@/lib/engine";
import { testProvider } from "@/lib/providers";
import type { Keys } from "@/lib/vault";

const KEYS: Keys = {
  groq: "gsk_test",
  gemini: "AIza_test",
  openrouter: "sk-or-test",
  cfAccount: "acct",
  cfToken: "tok",
  apiToken: "",
  zep: "",
};

describe("failover rules", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses Groq-style reset durations", () => expect(parseReset("2m59.5s")).toBe(179500));
  it("parses retry-after seconds", () => expect(parseReset("30")).toBe(30000));
  it("treats 429 as rate limit", () => expect(isRateLimit(429, "")).toBe(true));
  it("treats quota messages as rate limit", () => expect(isRateLimit(400, "RESOURCE_EXHAUSTED quota")).toBe(true));
  it("does not treat 401 as rate limit", () => expect(isRateLimit(401, "invalid key")).toBe(false));

  it("rejects HTML SSR fallback responses in testProvider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    await expect(testProvider("openrouter", KEYS)).rejects.toThrow(/non-JSON response/);
  });

  it("accepts valid JSON responses in testProvider", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "llama-3.1-8b-instant" }] })),
    );
    await expect(testProvider("groq", KEYS)).resolves.toBe("Connected");
  });
});
