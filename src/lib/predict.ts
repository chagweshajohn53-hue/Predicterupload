import { runHostedChat, type Fx, type Hop } from "./hub";
import { parseJsonLenient } from "./json-repair";
import type { Msg } from "./providers";
import type { ChainEntry, Keys } from "./vault";
import { CHART_PROMPT, REVIEW_PROMPT } from "./claude";

export type Reviewer = (messages: Msg[], images?: string[]) => Promise<{ text: string; model: string }>;

// Server-side Swarm predictor: personas -> debate rounds -> consensus signal.
// Every LLM step runs through runHostedChat, so it inherits the Router failover.

export const TRADING_DEPARTMENTS = [
  { name: "Structure & Levels Dept", focus: "market structure, swing highs/lows, support/resistance, and key price levels" },
  { name: "Technical Indicators Dept", focus: "RSI, MACD, moving averages, volume, and indicator alignment" },
  { name: "Price Action & Momentum Dept", focus: "candlestick formations, breakouts, rejections, and momentum shifts" },
  { name: "Liquidity & Order-Flow Dept", focus: "liquidity sweeps, supply/demand zones, traps, and contrarian order flow" },
  { name: "Macro & Risk Dept", focus: "macro catalysts, volatility regime, risk-to-reward, and invalidation boundaries" },
] as const;

export function assignDepartment(index: number) {
  return TRADING_DEPARTMENTS[index % TRADING_DEPARTMENTS.length]!;
}

export type Persona = { name: string; role: string; department: string; bias: string };
export type Turn = {
  round: number;
  agent: string;
  department: string;
  action: "BUY" | "SELL";
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  argument: string;
};
export type Signal = {
  signal: "BUY" | "SELL";
  confidence: number;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  rationale: string;
};
export type VoteTally = {
  BUY: number;
  SELL: number;
  buyWeight: number;
  sellWeight: number;
  lockedSignal: "BUY" | "SELL" | null;
  tieBreakerBias: "BUY" | "SELL";
};

export function extractJson<T>(text: string): T {
  return parseJsonLenient<T>(text);
}

export function finiteNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim().replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function inferSignalDirection(text: string, fallback: "BUY" | "SELL" = "BUY"): "BUY" | "SELL" {
  const decision = text.match(/Decision\s*:\s*(BUY|SELL)\b/i);
  if (decision?.[1]) return decision[1].toUpperCase() as "BUY" | "SELL";
  const buyMatches = text.match(/\b(buy|buying|long|bullish|upside|uptrend|breakout|support\s+bounce|accumulate)\b/gi)?.length ?? 0;
  const sellMatches = text.match(/\b(sell|selling|short|bearish|downside|downtrend|breakdown|resistance\s+rejection|distribute)\b/gi)?.length ?? 0;
  if (buyMatches > sellMatches) return "BUY";
  if (sellMatches > buyMatches) return "SELL";
  return fallback;
}

export function normalizeSignal(raw: Partial<Signal> | null | undefined, fallback: "BUY" | "SELL" = "BUY"): Signal {
  const s = String(raw?.signal ?? "").trim().toUpperCase();
  const rationale = String(raw?.rationale ?? "").slice(0, 500);
  let signal: "BUY" | "SELL";
  if (s === "BUY" || s === "LONG" || s === "BULLISH") {
    signal = "BUY";
  } else if (s === "SELL" || s === "SHORT" || s === "BEARISH") {
    signal = "SELL";
  } else if (/\bBUY\b/.test(s) && !/\bSELL\b/.test(s)) {
    signal = "BUY";
  } else if (/\bSELL\b/.test(s) && !/\bBUY\b/.test(s)) {
    signal = "SELL";
  } else {
    signal = inferSignalDirection(rationale, fallback);
  }
  const c = Number(raw?.confidence);
  return {
    signal,
    confidence: Number.isFinite(c) ? Math.max(0, Math.min(100, Math.round(c))) : 0,
    entry: finiteNum(raw?.entry),
    stop_loss: finiteNum(raw?.stop_loss),
    take_profit: finiteNum(raw?.take_profit),
    rationale,
  };
}

export function tallyFinalVotes(items: { action: "BUY" | "SELL"; confidence: number }[]): VoteTally {
  let BUY = 0;
  let SELL = 0;
  let buyWeight = 0;
  let sellWeight = 0;
  for (const item of items) {
    const w = item.confidence > 0 ? item.confidence : 50;
    if (item.action === "BUY") {
      BUY++;
      buyWeight += w;
    } else {
      SELL++;
      sellWeight += w;
    }
  }
  const lockedSignal: "BUY" | "SELL" | null = BUY > SELL ? "BUY" : SELL > BUY ? "SELL" : null;
  const tieBreakerBias: "BUY" | "SELL" = sellWeight > buyWeight ? "SELL" : "BUY";
  return { BUY, SELL, buyWeight, sellWeight, lockedSignal, tieBreakerBias };
}

export function pickBestLevels(
  candidates: {
    action: "BUY" | "SELL";
    confidence: number;
    entry?: number | null;
    stop_loss?: number | null;
    take_profit?: number | null;
  }[],
  winningSignal: "BUY" | "SELL",
): { entry: number | null; stop_loss: number | null; take_profit: number | null } {
  const validDirectional = (c: { entry?: number | null; stop_loss?: number | null; take_profit?: number | null }) => {
    const e = finiteNum(c.entry);
    const sl = finiteNum(c.stop_loss);
    const tp = finiteNum(c.take_profit);
    if (sl === null || tp === null) return false;
    if (e === null) return sl !== tp;
    return winningSignal === "BUY" ? sl < e && tp > e : sl > e && tp < e;
  };
  const side = candidates.filter((c) => c.action === winningSignal && (finiteNum(c.stop_loss) !== null || finiteNum(c.take_profit) !== null));
  side.sort((a, b) => {
    const aValid = validDirectional(a) ? 1 : 0;
    const bValid = validDirectional(b) ? 1 : 0;
    if (aValid !== bValid) return bValid - aValid;
    const aBoth = finiteNum(a.stop_loss) !== null && finiteNum(a.take_profit) !== null ? 1 : 0;
    const bBoth = finiteNum(b.stop_loss) !== null && finiteNum(b.take_profit) !== null ? 1 : 0;
    if (aBoth !== bBoth) return bBoth - aBoth;
    return (b.confidence || 0) - (a.confidence || 0);
  });
  const top = side[0];
  return {
    entry: finiteNum(top?.entry),
    stop_loss: finiteNum(top?.stop_loss),
    take_profit: finiteNum(top?.take_profit),
  };
}

export const FALLBACK: Persona[] = [
  { name: "Structure Strategist", role: "market structure analyst", department: assignDepartment(0).name, bias: "trend structure and support/resistance" },
  { name: "Quant Analyst", role: "systematic trader", department: assignDepartment(1).name, bias: "indicators and statistics" },
  { name: "Momentum Trader", role: "price action trader", department: assignDepartment(2).name, bias: "candlestick breakouts and momentum" },
  { name: "Order-Flow Contrarian", role: "liquidity trader", department: assignDepartment(3).name, bias: "liquidity sweeps and crowded fades" },
  { name: "Risk & Macro Desk", role: "risk officer", department: assignDepartment(4).name, bias: "macro drivers and invalidation levels" },
  { name: "Swing Technician", role: "swing trader", department: assignDepartment(0).name, bias: "multi-timeframe levels" },
  { name: "Indicator Specialist", role: "technical analyst", department: assignDepartment(1).name, bias: "oscillator divergences and MAs" },
  { name: "Tape Reader", role: "scalper", department: assignDepartment(2).name, bias: "short-term price action" },
  { name: "Bank FX Dealer", role: "institutional dealer", department: assignDepartment(3).name, bias: "institutional flows and stop runs" },
  { name: "Macro Economist", role: "macro PM", department: assignDepartment(4).name, bias: "rates and volatility regime" },
];

/** Accepts {agents:[...]}, a bare array, or any object holding an array of personas. */
export function pickPersonas(raw: unknown): Persona[] {
  let arr: unknown = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    arr = o["agents"] ?? o["personas"] ?? o["participants"] ?? Object.values(o).find(Array.isArray);
  }
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((a, idx) => {
    const dept = assignDepartment(idx).name;
    if (typeof a === "string") return [{ name: a, role: "market participant", department: dept, bias: "" }];
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const name = String(o["name"] ?? o["agent"] ?? o["role"] ?? "").trim();
    const department = String(o["department"] ?? "").trim() || dept;
    return name ? [{ name, role: String(o["role"] ?? o["type"] ?? "trader"), department, bias: String(o["bias"] ?? o["view"] ?? o["stance"] ?? "") }] : [];
  });
}

export async function runPrediction(fx: Fx, keys: Keys, chain: ChainEntry[], input: { seed: string; question: string; agents: number; rounds: number; images?: string[] }, reviewer?: Reviewer) {
  const hops: Hop[] = [];
  const models = new Set<string>();
  const unavailable = new Set<string>();
  const ask = async <T>(system: string, user: string, finalReview = false): Promise<T> => {
    for (let i = 0; i < 2; i++) {
      const msgs: Msg[] = [{ role: "system", content: system + "\nRespond with valid JSON only, no prose." }, { role: "user", content: user }];
      if (finalReview && reviewer) {
        const r = await reviewer(msgs);
        models.add(`anthropic:${r.model}`);
        hops.push({ model: r.model, ok: true, detail: "vote tally & SL/TP review" });
        try { return extractJson<T>(r.text); } catch { continue; }
      }
      const r = await runHostedChat(fx, keys, chain, msgs, { temperature: 0.1, unavailable });
      hops.push(...r.hops);
      if (!r.out || !r.model) throw new Error("All providers exhausted");
      models.add(`${r.model.provider}:${r.model.model}`);
      try { return extractJson<T>(r.out.choices[0]?.message.content ?? ""); } catch { /* retry */ }
    }
    throw new Error("Model did not return valid JSON");
  };

  let chart = "";
  if (input.images?.length) {
    if (!reviewer) throw new Error("Claude picture reader is unavailable");
    const r = await reviewer([{ role: "system", content: CHART_PROMPT }, { role: "user", content: input.question }], input.images);
    chart = r.text;
    models.add(`anthropic:${r.model}`);
    hops.push({ model: r.model, ok: true, detail: "chart decoding" });
  }
  const ctx = `MARKET CONTEXT:\n${input.seed}\n\nDECODED CHART SECTIONS:\n${chart || "No pictures supplied"}\n\nQUESTION: ${input.question}`;

  // 1. Auto-assign specialist trading departments across the agent count
  const deptSchedule = Array.from({ length: input.agents }, (_, i) => assignDepartment(i));
  let personas: Persona[] = [];
  try {
    const p = await ask<unknown>(
      `Create ${input.agents} distinct market specialists assigned to these exact departments:\n${deptSchedule.map((d, i) => `${i + 1}. ${d.name} (${d.focus})`).join("\n")}\nReturn {"agents":[{"name","role","department","bias"}]}.`,
      ctx,
    );
    personas = pickPersonas(p)
      .slice(0, input.agents)
      .map((ag, i) => ({ ...ag, department: assignDepartment(i).name }));
  } catch (e) {
    if (e instanceof Error && /exhausted/.test(e.message)) throw e;
  }
  if (!personas.length) personas = FALLBACK.slice(0, input.agents);

  const deptByAgent = new Map(personas.map((p) => [p.name, p.department]));

  // 2. Departmental debate rounds (models vote BUY or SELL and propose SL/TP)
  const turns: Turn[] = [];
  for (let round = 1; round <= input.rounds; round++) {
    const prior = turns.slice(-input.agents * 2).map((t) => `R${t.round} ${t.agent} [${t.department}]: ${t.action} (${t.confidence}%${t.stop_loss !== null ? `, SL ${t.stop_loss}` : ""}${t.take_profit !== null ? `, TP ${t.take_profit}` : ""}) - ${t.argument}`).join("\n") || "(none yet)";
    const r = await ask<{
      turns: { agent: string; action: string; confidence: number; entry?: number | null; stop_loss?: number | null; take_profit?: number | null; argument: string }[];
    }>(
      `You simulate round ${round} of a departmental trading-floor debate. Each department analyzes the decoded chart sections and others' arguments from its specialty. Every agent MUST choose a definitive "BUY" or "SELL" vote (never HOLD, WAIT, or neutral) and propose Entry, SL, and TP based on visible chart levels (or null if chart prices are absent). Return {"turns":[{"agent","action":"BUY|SELL","confidence":0-100,"entry":number|null,"stop_loss":number|null,"take_profit":number|null,"argument":"one or two concise sentences"}]} with one turn per agent.`,
      `${ctx}\n\nDEPARTMENTS & AGENTS:\n${personas.map((a) => `- ${a.name} [${a.department}] (${a.role}): ${a.bias}`).join("\n")}\n\nPREVIOUS ARGUMENTS:\n${prior}`,
    );
    for (const t of r.turns ?? []) {
      const arg = String(t.argument ?? "").slice(0, 400);
      const agentName = String(t.agent);
      const n = normalizeSignal({ signal: t.action as "BUY" | "SELL", confidence: t.confidence, rationale: arg });
      turns.push({
        round,
        agent: agentName,
        department: deptByAgent.get(agentName) ?? assignDepartment(turns.length).name,
        action: n.signal,
        confidence: n.confidence,
        entry: finiteNum(t.entry),
        stop_loss: finiteNum(t.stop_loss),
        take_profit: finiteNum(t.take_profit),
        argument: arg,
      });
    }
  }

  // Deduplicate final round so each agent gets 1 vote
  const lastRoundByAgent = new Map<string, Turn>();
  for (const t of turns.filter((x) => x.round === input.rounds)) {
    lastRoundByAgent.set(t.agent, t);
  }
  const finalVotes = lastRoundByAgent.size ? [...lastRoundByAgent.values()] : turns;
  const tally = tallyFinalVotes(finalVotes);
  const voteRule = tally.lockedSignal
    ? `MAJORITY VOTE LOCKED: ${tally.lockedSignal} (${tally.BUY} BUY vs ${tally.SELL} SELL). You MUST keep "signal": "${tally.lockedSignal}" and must NOT override the agents' majority vote.`
    : `VOTES ARE TIED (${tally.BUY} BUY vs ${tally.SELL} SELL). Break the tie strictly in favor of whichever side has the single strongest argument in the debate.`;

  const levelCandidates = finalVotes
    .filter((t) => !tally.lockedSignal || t.action === tally.lockedSignal)
    .map((t) => `${t.agent} [${t.department}] (${t.action} ${t.confidence}%): entry=${t.entry ?? "null"}, SL=${t.stop_loss ?? "null"}, TP=${t.take_profit ?? "null"} — ${t.argument}`)
    .join("\n");

  // 3. Claude reviews tally, identifies strongest argument, and picks best SL & TP
  const final = await ask<Partial<Signal> & { strongest_argument?: string; report?: string }>(
    `${REVIEW_PROMPT}\n\n${voteRule}\nReturn {"signal":"BUY|SELL","confidence":0-100,"entry":number|null,"stop_loss":number|null,"take_profit":number|null,"strongest_argument":"the single strongest winning argument from the debate","rationale":"Decision: [BUY/SELL], Confidence Score: [XX]% — cite vote tally and strongest argument","report":"Markdown starting with: Decision: [BUY/SELL], Confidence Score: [XX]% followed by vote tally, strongest argument, and selected SL/TP"}.`,
    `${ctx}\n\nVOTE TALLY:\nBUY: ${tally.BUY} votes · SELL: ${tally.SELL} votes\n\nCANDIDATE LEVELS & ARGUMENTS:\n${levelCandidates || "(none)"}\n\nFULL DEBATE:\n${turns.map((t) => `R${t.round} ${t.agent} [${t.department}]: ${t.action} (${t.confidence}%) - ${t.argument}`).join("\n")}`,
    true,
  );

  const normalized = normalizeSignal(final, tally.tieBreakerBias);
  const lockedDirection = tally.lockedSignal ?? normalized.signal;
  const fallbackLevels = pickBestLevels(finalVotes, lockedDirection);
  const entry = normalized.entry ?? fallbackLevels.entry;
  const stop_loss = normalized.stop_loss ?? fallbackLevels.stop_loss;
  const take_profit = normalized.take_profit ?? fallbackLevels.take_profit;
  const strongest_argument = String(final.strongest_argument ?? "").trim() || finalVotes.filter((t) => t.action === lockedDirection).sort((a, b) => b.confidence - a.confidence)[0]?.argument || "";

  return {
    ...normalized,
    signal: lockedDirection,
    entry,
    stop_loss,
    take_profit,
    strongest_argument,
    decision_source: tally.lockedSignal ? "agent_majority_votes" : "tie_broken_by_strongest_argument",
    chart_evidence: chart,
    votes: { BUY: tally.BUY, SELL: tally.SELL },
    report: String(final.report ?? "").slice(0, 4000),
    agents: personas,
    debate: turns,
    models: [...models],
    hops,
  };
}
