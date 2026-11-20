import { describe, expect, it, vi } from "vitest";
import {
  assignDepartment,
  inferSignalDirection,
  normalizeSignal,
  pickBestLevels,
  runPrediction,
  tallyFinalVotes,
  TRADING_DEPARTMENTS,
} from "@/lib/predict";
import type { ChainEntry, Keys } from "@/lib/vault";

describe("normalizeSignal", () => {
  it("never returns HOLD or WAIT for undecided actions and uses fallback bias", () => {
    expect(normalizeSignal({ signal: "HOLD" as never }, "SELL").signal).toBe("SELL");
    expect(normalizeSignal({ signal: "WAIT" as never }, "BUY").signal).toBe("BUY");
    expect(normalizeSignal({ signal: "neutral" as never }, "SELL").signal).toBe("SELL");
  });

  it("infers BUY or SELL from dominant rationale when raw signal is undecided", () => {
    expect(
      normalizeSignal({
        signal: "HOLD" as never,
        confidence: 62,
        rationale: "Bearish breakdown below resistance rejection favors short momentum.",
      }).signal,
    ).toBe("SELL");
    expect(
      normalizeSignal({
        signal: "WAIT" as never,
        confidence: 68,
        rationale: "Decision: BUY, Confidence Score: 68% — breakout above support.",
      }).signal,
    ).toBe("BUY");
  });

  it("clamps confidence to 0-100", () => expect(normalizeSignal({ signal: "BUY", confidence: 140 }).confidence).toBe(100));
  it("accepts lowercase sell and bearish/bullish synonyms", () => {
    expect(normalizeSignal({ signal: "sell" as never }).signal).toBe("SELL");
    expect(normalizeSignal({ signal: "bullish" as never }).signal).toBe("BUY");
    expect(inferSignalDirection("Strong bearish selloff and downside breakdown")).toBe("SELL");
  });
});

describe("departmental voting and level selection", () => {
  it("auto-assigns trading departments evenly across agent counts", () => {
    const depts = Array.from({ length: 7 }, (_, i) => assignDepartment(i).name);
    expect(depts.slice(0, TRADING_DEPARTMENTS.length)).toEqual(TRADING_DEPARTMENTS.map((d) => d.name));
    expect(depts[5]).toBe(TRADING_DEPARTMENTS[0].name);
  });

  it("locks majority BUY or SELL votes and marks ties as null", () => {
    expect(
      tallyFinalVotes([
        { action: "SELL", confidence: 70 },
        { action: "SELL", confidence: 80 },
        { action: "BUY", confidence: 90 },
      ]).lockedSignal,
    ).toBe("SELL");

    const tie = tallyFinalVotes([
      { action: "BUY", confidence: 65 },
      { action: "SELL", confidence: 85 },
    ]);
    expect(tie.lockedSignal).toBeNull();
    expect(tie.tieBreakerBias).toBe("SELL");
  });

  it("picks the highest-confidence valid Entry, SL, and TP from the winning side", () => {
    const levels = pickBestLevels(
      [
        { action: "BUY", confidence: 95, entry: 100, stop_loss: 105, take_profit: 110 },
        { action: "SELL", confidence: 70, entry: 100, stop_loss: 103, take_profit: 92 },
        { action: "SELL", confidence: 88, entry: 100, stop_loss: 102, take_profit: 90 },
      ],
      "SELL",
    );
    expect(levels).toEqual({ entry: 100, stop_loss: 102, take_profit: 90 });
  });

  it("locks final decision to agent majority votes even if reviewer returns the opposite side", async () => {
    const keys: Keys = { groq: "k", gemini: "", openrouter: "", cfAccount: "", cfToken: "", apiToken: "", zep: "" };
    const chain: ChainEntry[] = [{ id: "g1", provider: "groq", model: "llama-3.3-70b-versatile", enabled: true }];
    let call = 0;
    const fx = vi.fn(async () => {
      call++;
      const payload =
        call === 1
          ? {
              agents: [
                { name: "A1", role: "Struct", department: "Structure & Levels Dept", bias: "levels" },
                { name: "A2", role: "Quant", department: "Technical Indicators Dept", bias: "rsi" },
                { name: "A3", role: "Flow", department: "Price Action & Momentum Dept", bias: "candles" },
              ],
            }
          : {
              turns: [
                { agent: "A1", action: "SELL", confidence: 82, entry: 1.085, stop_loss: 1.089, take_profit: 1.076, argument: "Resistance rejection at 1.088." },
                { agent: "A2", action: "SELL", confidence: 76, entry: 1.085, stop_loss: 1.088, take_profit: 1.077, argument: "RSI bearish divergence." },
                { agent: "A3", action: "BUY", confidence: 55, entry: 1.085, stop_loss: 1.081, take_profit: 1.092, argument: "Minor lower wick bounce." },
              ],
            };
      return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }] });
    });

    const reviewer = vi.fn(async (_msgs: unknown, images?: string[]) => {
      if (images?.length) {
        return { text: "## 1. Market Metadata & Current Price\nEURUSD 1.0850", model: "claude-haiku-5-5" };
      }
      // Deliberately return BUY from Claude reviewer to verify deterministic majority vote lock prevents override
      return {
        text: JSON.stringify({
          signal: "BUY",
          confidence: 79,
          entry: 1.085,
          stop_loss: 1.089,
          take_profit: 1.076,
          strongest_argument: "Resistance rejection at 1.088.",
          rationale: "Decision: SELL, Confidence Score: 79% — 2 SELL vs 1 BUY.",
          report: "Decision: SELL, Confidence Score: 79%",
        }),
        model: "claude-haiku-5-5",
      };
    });

    const res = await runPrediction(
      fx as unknown as typeof fetch,
      keys,
      chain,
      { seed: "EURUSD session context", question: "Trade EURUSD?", agents: 3, rounds: 1, images: ["data:image/jpeg;base64,/9j/4AAQ"] },
      reviewer,
    );

    expect(res.signal).toBe("SELL");
    expect(res.votes).toEqual({ BUY: 1, SELL: 2 });
    expect(res.decision_source).toBe("agent_majority_votes");
    expect(res.stop_loss).toBe(1.089);
    expect(res.take_profit).toBe(1.076);
    expect(res.strongest_argument).toContain("Resistance rejection");
  });
});
