import { describe, expect, it } from "vitest";
import { isRateLimit, parseReset } from "@/lib/engine";
describe("failover rules", () => {
  it("parses Groq-style reset durations", () => expect(parseReset("2m59.5s")).toBe(179500));
  it("parses retry-after seconds", () => expect(parseReset("30")).toBe(30000));
  it("treats 429 as rate limit", () => expect(isRateLimit(429, "")).toBe(true));
  it("treats quota messages as rate limit", () => expect(isRateLimit(400, "RESOURCE_EXHAUSTED quota")).toBe(true));
  it("does not treat 401 as rate limit", () => expect(isRateLimit(401, "invalid key")).toBe(false));
});
