import { describe, expect, it } from "vitest";
import { parseJsonLenient, repairJson } from "@/lib/json-repair";

describe("parseJsonLenient", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLenient<{ a: number }>('{"a": 1}')).toEqual({ a: 1 });
  });

  it("strips code fences and prose", () => {
    expect(parseJsonLenient<{ a: number }>('Here you go:\n```json\n{"a": 2}\n```')).toEqual({ a: 2 });
  });

  it("repairs JSON truncated mid-string inside an array", () => {
    const broken = '{"entities":[{"name":"Fed","type":"org","summary":"central bank"},{"name":"ECB","type":"org","summary":"euro cent';
    const r = parseJsonLenient<{ entities: { name: string }[] }>(broken);
    expect(r.entities).toHaveLength(1);
    expect(r.entities[0]!.name).toBe("Fed");
  });

  it("repairs JSON truncated after a complete element", () => {
    const broken = '{"turns":[{"agent":"Quant","action":"BUY","confidence":70,"argument":"momentum"},';
    const r = parseJsonLenient<{ turns: { agent: string }[] }>(broken);
    expect(r.turns).toHaveLength(1);
  });

  it("removes trailing commas", () => {
    expect(parseJsonLenient<{ a: number[] }>('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it("closes an unterminated top-level array", () => {
    expect(parseJsonLenient<number[]>("[1, 2, 3")).toEqual([1, 2, 3]);
  });

  it("still rejects replies with no JSON", () => {
    expect(() => parseJsonLenient("no data here")).toThrow();
  });
});

describe("sanitizeJson repairs", () => {
  it("escapes unescaped inner quotes", () => {
    expect(parseJsonLenient<{ a: string }>('{"a": "he said "buy" now"}')).toEqual({ a: 'he said "buy" now' });
  });
  it("inserts missing commas between properties", () => {
    expect(parseJsonLenient<{ a: number; b: string }>('{"a": 1\n "b": "x"}')).toEqual({ a: 1, b: "x" });
  });
  it("escapes raw newlines in strings", () => {
    expect(parseJsonLenient<{ a: string }>('{"a": "line1\nline2"}'.replace("\\n", "\n"))).toEqual({ a: "line1\nline2" });
  });
});

describe("repairJson", () => {
  it("keeps valid JSON intact", () => {
    const ok = '{"a":[1,2],"b":"x"}';
    expect(JSON.parse(repairJson(ok))).toEqual({ a: [1, 2], b: "x" });
  });
});
