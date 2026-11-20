import { describe, expect, it } from "vitest";
import { parseJson } from "@/lib/swarm";

describe("swarm JSON parsing", () => {
  it("extracts JSON wrapped in prose and code fences", () => {
    expect(parseJson<{ a: number }>('Sure!\n```json\n{"a": 2}\n```')).toEqual({ a: 2 });
  });
  it("rejects replies with no JSON", () => {
    expect(() => parseJson("no data here")).toThrow();
  });
});
