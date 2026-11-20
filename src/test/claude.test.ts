import { describe, expect, it, vi } from "vitest";
import { callClaude, CLAUDE_MODEL } from "@/lib/claude";

describe("Claude Haiku 5.5 adapter", () => {
  it("omits deprecated temperature parameter and parses text response", async () => {
    const fx = vi.fn(async () =>
      Response.json({
        content: [{ type: "text", text: "Connected." }],
        stop_reason: "end_turn",
      }),
    );

    const res = await callClaude(
      "sk-ant-test-key",
      [
        { role: "system", content: "Connection check." },
        { role: "user", content: "Reply with Connected." },
      ],
      [],
      undefined,
      fx as unknown as typeof fetch,
      128,
    );

    expect(res).toEqual({ text: "Connected.", model: CLAUDE_MODEL });
    expect(fx).toHaveBeenCalledTimes(1);
    const [, init] = fx.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("claude-haiku-5-5");
    expect(body["max_tokens"]).toBe(128);
    expect(body["temperature"]).toBeUndefined();
  });

  it("reports status-specific errors and redacts leaked key prefixes", async () => {
    const fx400 = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "bad param for sk-ant-secret123" } }), {
          status: 400,
        }),
    );
    await expect(
      callClaude("sk-ant-secret123", [{ role: "user", content: "Hi" }], [], undefined, fx400 as unknown as typeof fetch),
    ).rejects.toThrow("Claude request rejected (HTTP 400) (bad param for [redacted]).");

    const fx401 = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { type: "authentication_error", message: "invalid x-api-key" } }), {
          status: 401,
        }),
    );
    await expect(
      callClaude("sk-ant-bad", [{ role: "user", content: "Hi" }], [], undefined, fx401 as unknown as typeof fetch),
    ).rejects.toThrow("Claude authentication failed (HTTP 401) (invalid x-api-key). Check your Anthropic API key and permissions.");
  });

  it("attaches cleaned base64 images and supplies non-empty text fallback when needed", async () => {
    const fx = vi.fn(async () =>
      Response.json({
        content: [{ type: "text", text: "EURUSD bullish flag." }],
        stop_reason: "end_turn",
      }),
    );

    const res = await callClaude(
      "sk-ant-test-key",
      [{ role: "user", content: "   " }],
      ["data:image/jpeg;base64,/9j/4AAQ\nSkZJ"],
      undefined,
      fx as unknown as typeof fetch,
      4096,
    );

    expect(res.text).toBe("EURUSD bullish flag.");
    const [, init] = fx.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: { type: string; text?: string; source?: { data: string; media_type: string } }[] }[];
    };
    expect(body.messages[0]?.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQSkZJ" } },
      { type: "text", text: "Analyze the attached chart image(s)." },
    ]);
  });
});

describe("claudeAnalysis client helper", () => {
  it("posts JSON to /api/public/claude with Firebase token and surfaces server errors cleanly", async () => {
    vi.resetModules();
    vi.doMock("@/lib/firebase", () => ({
      auth: {
        authStateReady: vi.fn(async () => {}),
        currentUser: { getIdToken: vi.fn(async () => "firebase-jwt-token") },
      },
    }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ text: "Chart shows 1.0850 support", model: "claude-haiku-5-5" }))
      .mockResolvedValueOnce(new Response("", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { claudeAnalysis } = await import("@/lib/claude.functions");
      const ok = await claudeAnalysis({
        data: {
          task: "pictures",
          images: ["data:image/jpeg;base64,/9j/4AAQ"],
          messages: [{ role: "user", content: "Read chart" }],
        },
      });
      expect(ok).toEqual({ text: "Chart shows 1.0850 support", model: "claude-haiku-5-5" });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/public/claude",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "content-type": "application/json",
            authorization: "Bearer firebase-jwt-token",
          }),
        }),
      );

      await expect(
        claudeAnalysis({
          data: {
            task: "pictures",
            images: ["data:image/jpeg;base64,/9j/4AAQ"],
            messages: [{ role: "user", content: "Read chart" }],
          },
        }),
      ).rejects.toThrow("Claude request failed (HTTP 502).");
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("@/lib/firebase");
    }
  });
});
