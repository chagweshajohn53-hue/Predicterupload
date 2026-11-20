import { describe, expect, it, vi, afterEach } from "vitest";
import { describeImages } from "@/lib/swarm";
import { claudeAnalysis } from "@/lib/claude.functions";
import { chatBody } from "@/lib/providers";
import { imageDimensions, supportsImages } from "@/lib/vision";
import { toDataUrl } from "@/components/relay/ImagePaste";

vi.mock("@/lib/claude.functions", () => ({ claudeAnalysis: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(claudeAnalysis).mockReset();
});

describe("chart picture processing", () => {
  it("skips text-only Groq Llama but accepts Gemini and Scout vision", () => {
    expect(supportsImages({ id: "a", provider: "groq", model: "llama-3.3-70b-versatile", enabled: true })).toBe(false);
    expect(supportsImages({ id: "b", provider: "gemini", model: "gemini-2.5-flash", enabled: true })).toBe(true);
    expect(supportsImages({ id: "c", provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", enabled: true })).toBe(true);
  });
  it("retains readable chart resolution without upscaling or changing aspect ratio", () => {
    expect(imageDimensions(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(imageDimensions(800, 450)).toEqual({ width: 800, height: 450 });
  });
  it("attaches actual JPEG content to the final user message and preserves history", () => {
    const messages = [
      { role: "system" as const, content: "Read charts" },
      { role: "user" as const, content: "Earlier" },
      { role: "assistant" as const, content: "Earlier answer" },
      { role: "user" as const, content: "New chart" },
    ];
    const body = JSON.parse(chatBody("gemini", "gemini-2.5-flash", messages, ["data:image/jpeg;base64,abc"]));
    expect(body.messages.slice(0, 3)).toEqual(messages.slice(0, 3));
    expect(body.messages[3].content).toEqual([
      { type: "text", text: "New chart" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,abc" } },
    ]);
    expect(body.stream).toBe(true);
  });
  it("keeps ordinary text requests unchanged", () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    expect(JSON.parse(chatBody("groq", "llama", messages)).messages).toEqual(messages);
  });
  it("rejects empty and non-image uploads", async () => {
    await expect(toDataUrl(new Blob([], { type: "image/png" }))).rejects.toThrow("non-empty");
    await expect(toDataUrl(new Blob(["bad"], { type: "text/plain" }))).rejects.toThrow("picture");
  });
  it("reads identical chart and context once via Claude Haiku 5.5, keeping only successful descriptions", async () => {
    vi.mocked(claudeAnalysis).mockResolvedValue({ text: "EURUSD LAST 1.0850", model: "claude-haiku-5-5" });
    expect(await describeImages(["data:image/jpeg;base64,cache-test"], "Read price")).toBe("EURUSD LAST 1.0850");
    expect(await describeImages(["data:image/jpeg;base64,cache-test"], "Read price")).toBe("EURUSD LAST 1.0850");
    expect(claudeAnalysis).toHaveBeenCalledTimes(1);
    expect(vi.mocked(claudeAnalysis).mock.calls[0]?.[0]).toMatchObject({
      data: { task: "pictures", images: ["data:image/jpeg;base64,cache-test"] },
    });
  });
  it("rejects empty Claude vision replies rather than letting agents invent chart data", async () => {
    vi.mocked(claudeAnalysis).mockResolvedValue({ text: "   ", model: "claude-haiku-5-5" });
    await expect(describeImages(["data:image/jpeg;base64,failed-read"], "Unavailable")).rejects.toThrow("Claude returned no image-reading analysis");
  });
});