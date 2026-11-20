import { runChat } from "./engine";
import { parseJsonLenient } from "./json-repair";
import {
  assignDepartment,
  finiteNum,
  inferSignalDirection,
  normalizeSignal,
  pickBestLevels,
  tallyFinalVotes,
  type Signal,
} from "./predict";
import type { Msg } from "./providers";
import { getVault } from "./vault";
import { zepAdd, zepCreateGraph, zepSearch } from "./zep";
import { claudeAnalysis } from "./claude.functions";

export type Entity = { name: string; type: string; summary: string };
export type Relation = { source: string; target: string; label: string };
export type Agent = {
  name: string;
  role: string;
  department?: string;
  persona: string;
  stance: string;
  platform: "twitter" | "reddit";
};
export type Post = {
  id: string;
  round: number;
  author: string;
  department?: string;
  platform: "twitter" | "reddit";
  kind: "post" | "reply" | "like";
  content: string;
  vote?: "BUY" | "SELL";
  confidence?: number;
  entry?: number | null;
  stop_loss?: number | null;
  take_profit?: number | null;
  replyTo?: string;
  likes: number;
};
export type SimVerdict = Signal & {
  model: string;
  reviewedAt: number;
  votes?: { BUY: number; SELL: number };
  strongestArgument?: string;
  decisionSource?: "agent_majority_votes" | "tie_broken_by_strongest_argument";
};
export type Sim = {
  id: string;
  title: string;
  seed: string;
  chartEvidence?: string;
  question: string;
  createdAt: number;
  stage: "graph" | "agents" | "simulating" | "report" | "done" | "error";
  entities: Entity[];
  relations: Relation[];
  agents: Agent[];
  posts: Post[];
  rounds: number;
  roundsDone: number;
  injections: { round: number; text: string }[];
  report: string;
  verdict?: SimVerdict;
  modelsUsed?: string[];
  zepGraph?: string;
  log: string[];
  error?: string;
};

const uid = () => Math.random().toString(36).slice(2, 10);

/** One failover-backed completion, collected as text. */
export async function ask(
  messages: Msg[],
  signal?: AbortSignal,
  onLog?: (msg: string) => void,
): Promise<{ text: string; model: string }> {
  let text = "";
  const r = await runChat({
    messages,
    ...(signal ? { signal } : {}),
    onToken: (t) => (text += t),
    onAttempt: (a) => {
      if (a.outcome !== "ok" && a.outcome !== "skipped") {
        onLog?.(`Failover: ${a.entry.provider}/${a.entry.model} (${a.detail}) → trying next model`);
      }
    },
    onStart: () => {
      text = "";
    },
  });
  if (!r.entry) {
    const summary = r.attempts
      .filter((a) => a.outcome !== "skipped")
      .slice(-3)
      .map((a) => `${a.entry.model}: ${a.detail}`)
      .join(" | ");
    throw new Error(
      summary
        ? `Every model in your Router failed (${summary}).`
        : "Every model in your Router is unavailable (add API keys in Keys tab or wait for cooldowns).",
    );
  }
  return { text, model: `${r.entry.provider}:${r.entry.model}` };
}

export function parseJson<T>(text: string): T {
  return parseJsonLenient<T>(text);
}

async function askJson<T>(
  system: string,
  user: string,
  signal?: AbortSignal,
  onModel?: (model: string) => void,
  onLog?: (msg: string) => void,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    const { text, model } = await ask(
      [
        {
          role: "system",
          content: system + "\nRespond with valid JSON only, no prose. Double-quote every property name and string value.",
        },
        {
          role: "user",
          content:
            user +
            (i
              ? `\nYour previous reply was invalid JSON (${String(last).slice(0, 160)}). Correct the syntax; do not use bare words as string values.`
              : ""),
        },
      ],
      signal,
      onLog,
    );
    onModel?.(model);
    try {
      return parseJson<T>(text);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export function newSim(seed: string, question: string, rounds: number, chartEvidence?: string): Sim {
  return {
    id: uid(),
    title: question.slice(0, 60) || "Untitled simulation",
    seed,
    ...(chartEvidence ? { chartEvidence } : {}),
    question,
    createdAt: Date.now(),
    stage: "graph",
    entities: [],
    relations: [],
    agents: [],
    posts: [],
    rounds,
    roundsDone: 0,
    injections: [],
    report: "",
    modelsUsed: [],
    log: [],
  };
}

type Update = (fn: (s: Sim) => Sim) => void;
const log = (u: Update, m: string) => u((s) => ({ ...s, log: [...s.log, `${new Date().toLocaleTimeString()} ${m}`] }));
const trackModel = (u: Update, m: string) =>
  u((s) => ({
    ...s,
    modelsUsed: s.modelsUsed?.includes(m) ? s.modelsUsed : [...(s.modelsUsed ?? []), m],
  }));

async function memory(sim: Sim, q: string): Promise<string[]> {
  const key = getVault().keys.zep;
  if (!key || !sim.zepGraph) return [];
  try {
    return await zepSearch(key, sim.zepGraph, q);
  } catch {
    return [];
  }
}
async function remember(sim: Sim, text: string) {
  const key = getVault().keys.zep;
  if (!key || !sim.zepGraph) return;
  try {
    await zepAdd(key, sim.zepGraph, text);
  } catch {
    /* memory is best-effort */
  }
}

export async function buildWorld(sim: Sim, u: Update, agentCount: number, signal?: AbortSignal): Promise<Sim> {
  let cur = sim;
  const up: Update = (fn) => {
    cur = fn(cur);
    u(() => cur);
  };
  const onModel = (m: string) => trackModel(up, m);
  const onLog = (m: string) => log(up, m);

  if (cur.chartEvidence) {
    trackModel(up, "anthropic:claude-haiku-5-5");
  }

  // 1. Graph construction via failover chain
  log(up, "Extracting entities and relationships from seed + Claude chart evidence…");
  const g = await askJson<{ entities: Entity[]; relations: Relation[] }>(
    "You build knowledge graphs for market and social simulations. Extract assets, people, institutions, indicators, groups and concepts that matter for the prediction question.",
    `Prediction question: ${sim.question}\n\nSeed & chart evidence:\n${sim.seed.slice(0, 14000)}\n\nReturn JSON shaped like {"entities":[{"name":"Entity name","type":"concept","summary":"Brief summary"}],"relations":[{"source":"Entity name","target":"Another entity","label":"RELATED_TO"}]} with 6-20 entities. label is SCREAMING_SNAKE_CASE.`,
    signal,
    onModel,
    onLog,
  );
  up((s) => ({ ...s, entities: g.entities ?? [], relations: (g.relations ?? []).filter((r) => r.source && r.target) }));
  log(up, `Graph: ${g.entities?.length ?? 0} entities, ${g.relations?.length ?? 0} relations`);

  const key = getVault().keys.zep;
  if (key) {
    const gid = `mirofish-${sim.id}`;
    try {
      await zepCreateGraph(key, gid, sim.title);
      up((s) => ({ ...s, zepGraph: gid }));
      await zepAdd(key, gid, `Prediction question: ${sim.question}\n\n${sim.seed}`);
      log(up, "Seed stored in Zep graph memory");
    } catch (e) {
      log(up, `Zep memory unavailable, continuing with local memory (${(e as Error).message.slice(0, 80)})`);
    }
  } else log(up, "No Zep key — using local memory only");

  // 2. Auto-assign specialist trading departments across the agent count
  up((s) => ({ ...s, stage: "agents" }));
  const deptSchedule = Array.from({ length: agentCount }, (_, i) => assignDepartment(i));
  log(up, `Assigning ${agentCount} agents across ${new Set(deptSchedule.map((d) => d.name)).size} trading departments…`);
  const a = await askJson<{ agents: Agent[] }>(
    "You design diverse, realistic specialist trading-department agents for a financial market simulation.",
    `Question: ${sim.question}\nEntities: ${JSON.stringify(cur.entities).slice(0, 6000)}\n\nCreate exactly ${agentCount} agents assigned 1-to-1 to these departments:\n${deptSchedule.map((d, i) => `${i + 1}. ${d.name} (${d.focus})`).join("\n")}\n\nReturn JSON shaped like {"agents":[{"name":"Analyst","role":"Structure strategist","department":"Structure & Levels Dept","persona":"Personality and motives. Analytical style.","stance":"bullish","platform":"twitter"}]}. Persona must be 2 sentences. Vary initial stance between bullish, bearish, momentum, contrarian, and skeptical. Platform must be the quoted string "twitter" or "reddit".`,
    signal,
    onModel,
    onLog,
  );
  const assignedAgents = (a.agents ?? []).slice(0, agentCount).map((ag, i) => ({
    ...ag,
    department: ag.department?.trim() || assignDepartment(i).name,
  }));
  up((s) => ({ ...s, agents: assignedAgents, stage: "simulating" }));
  log(up, `${cur.agents.length} departmental agents ready`);
  return cur;
}

export async function runRound(sim: Sim, u: Update, signal?: AbortSignal): Promise<Sim> {
  let cur = sim;
  const up: Update = (fn) => {
    cur = fn(cur);
    u(() => cur);
  };
  const round = sim.roundsDone + 1;
  const feed = sim.posts
    .slice(-30)
    .map((p) => `[${p.id}] (${p.platform}, r${p.round}) ${p.author}${p.replyTo ? ` ↳${p.replyTo}` : ""}: ${p.content} (♥${p.likes})`)
    .join("\n");
  const events = sim.injections.filter((i) => i.round === round).map((i) => i.text);
  const mem = await memory(sim, `${sim.question} ${events.join(" ")} ${sim.posts.slice(-3).map((p) => p.content).join(" ")}`);

  log(up, `Round ${round}: departmental agents debating & voting…`);
  const res = await askJson<{
    actions: {
      author: string;
      kind: "post" | "reply" | "like" | "idle";
      vote?: string;
      confidence?: number;
      entry?: number | null;
      stop_loss?: number | null;
      take_profit?: number | null;
      content?: string;
      replyTo?: string;
    }[];
  }>(
    "You are the OASIS-style engine of a departmental trading-floor simulation. Each agent analyzes the decoded chart sections from its department's specialty, reacts to the feed, memory and breaking events, and MUST vote BUY or SELL (never neutral, wait, or hold) while proposing Entry, SL, and TP based on visible chart levels.",
    `Question being predicted: ${sim.question}\nRound ${round} of ${sim.rounds}.\n\n${sim.chartEvidence ? `Decoded Chart Sections (Claude Haiku 5.5):\n${sim.chartEvidence.slice(0, 4000)}\n\n` : ""}Departments & Agents:\n${sim.agents.map((a, i) => `- ${a.name} [${a.department ?? assignDepartment(i).name}] (${a.role}, ${a.stance}, ${a.platform}): ${a.persona}`).join("\n")}\n\n${mem.length ? `Long-term memory facts:\n${mem.map((m) => "- " + m).join("\n")}\n\n` : ""}${events.length ? `BREAKING EVENT injected this round: ${events.join(" | ")}\n\n` : ""}Recent feed:\n${feed || "(empty — first round)"}\n\nReturn JSON shaped like {"actions":[{"author":"Exact agent name","kind":"post","vote":"BUY","confidence":72,"entry":1.0850,"stop_loss":1.0810,"take_profit":1.0930,"content":"Department argument citing chart levels/indicators","replyTo":"p1"}]} with one action per agent. Kind must be post, reply, like or idle. Every post or reply MUST include "vote":"BUY"|"SELL" and "confidence":0-100 (and entry/stop_loss/take_profit numbers or null). Omit replyTo unless replying or liking; omit content for likes and idle.`,
    signal,
    (m) => trackModel(up, m),
    (m) => log(up, m),
  );
  const names = new Set(sim.agents.map((a) => a.name));
  const newPosts: Post[] = [];
  const likes: Record<string, number> = {};
  for (const act of res.actions ?? []) {
    if (!names.has(act.author) || act.kind === "idle") continue;
    if (act.kind === "like") {
      if (act.replyTo) likes[act.replyTo] = (likes[act.replyTo] ?? 0) + 1;
      continue;
    }
    if (!act.content) continue;
    const agentIndex = sim.agents.findIndex((a) => a.name === act.author);
    const agent = sim.agents[agentIndex]!;
    const dept = agent.department ?? assignDepartment(Math.max(0, agentIndex)).name;
    const norm = normalizeSignal({
      signal: (act.vote ?? "") as "BUY" | "SELL",
      confidence: act.confidence ?? 60,
      rationale: act.content,
    });
    const entry = finiteNum(act.entry);
    const stop_loss = finiteNum(act.stop_loss);
    const take_profit = finiteNum(act.take_profit);
    newPosts.push({
      id: `p${sim.posts.length + newPosts.length + 1}`,
      round,
      author: act.author,
      department: dept,
      platform: agent.platform,
      kind: act.kind,
      content: act.content,
      vote: norm.signal,
      confidence: norm.confidence || 60,
      ...(entry !== null ? { entry } : {}),
      ...(stop_loss !== null ? { stop_loss } : {}),
      ...(take_profit !== null ? { take_profit } : {}),
      likes: 0,
      ...(act.kind === "reply" && act.replyTo ? { replyTo: act.replyTo } : {}),
    });
  }
  up((s) => ({
    ...s,
    posts: [...s.posts.map((p) => (likes[p.id] ? { ...p, likes: p.likes + likes[p.id]! } : p)), ...newPosts],
    roundsDone: round,
  }));
  const rVotes = tallyFinalVotes(newPosts.map((p) => ({ action: p.vote ?? "BUY", confidence: p.confidence ?? 60 })));
  log(up, `Round ${round}: ${newPosts.length} posts (${rVotes.BUY} BUY · ${rVotes.SELL} SELL), ${Object.values(likes).reduce((a, b) => a + b, 0)} likes`);
  void remember(
    cur,
    `Round ${round}${events.length ? ` (event: ${events.join("; ")})` : ""}:\n${newPosts.map((p) => `${p.author} [${p.vote ?? "BUY"}]: ${p.content}`).join("\n")}`,
  );
  return cur;
}

type ClaudeReviewPayload = Partial<Signal> & { strongest_argument?: string; report?: string };

function collectFinalRoundVotes(sim: Sim) {
  const maxRound = sim.posts.reduce((m, p) => Math.max(m, p.round), 0);
  const roundPosts = sim.posts.filter((p) => p.round === maxRound);
  const byAuthor = new Map<
    string,
    {
      author: string;
      department: string;
      action: "BUY" | "SELL";
      confidence: number;
      entry: number | null;
      stop_loss: number | null;
      take_profit: number | null;
      content: string;
      likes: number;
    }
  >();
  for (const p of roundPosts) {
    const dir = p.vote ?? inferSignalDirection(p.content, "BUY");
    byAuthor.set(p.author, {
      author: p.author,
      department: p.department ?? "Trading Desk",
      action: dir,
      confidence: p.confidence ?? 60,
      entry: finiteNum(p.entry),
      stop_loss: finiteNum(p.stop_loss),
      take_profit: finiteNum(p.take_profit),
      content: p.content,
      likes: p.likes,
    });
  }
  return [...byAuthor.values()];
}

export async function writeReport(sim: Sim, u: Update, signal?: AbortSignal): Promise<Sim> {
  let cur: Sim = { ...sim, stage: "report" };
  u(() => cur);
  const mem = await memory(sim, sim.question);
  signal?.throwIfAborted();

  const finalAgentVotes = collectFinalRoundVotes(sim);
  const tally = tallyFinalVotes(finalAgentVotes);
  if (tally.lockedSignal) {
    log(u, `Final agent vote tally: ${tally.BUY} BUY vs ${tally.SELL} SELL → majority locks ${tally.lockedSignal}`);
  } else {
    log(u, `Final agent vote tally tied: ${tally.BUY} BUY vs ${tally.SELL} SELL → Claude selecting strongest argument`);
  }
  log(u, "Sending vote tally, debate arguments, and candidate SL/TP levels to Claude Haiku 5.5 for review…");

  const voteRule = tally.lockedSignal
    ? `MAJORITY VOTE LOCKED: ${tally.lockedSignal} (${tally.BUY} BUY vs ${tally.SELL} SELL). You MUST NOT change or override this direction—keep "signal": "${tally.lockedSignal}".`
    : `VOTES ARE TIED (${tally.BUY} BUY vs ${tally.SELL} SELL). Break the tie strictly in favor of whichever side presented the single strongest argument and indicator alignment in the simulation debate.`;

  const winningSideCandidates = finalAgentVotes
    .filter((v) => !tally.lockedSignal || v.action === tally.lockedSignal)
    .map(
      (v) =>
        `- ${v.author} [${v.department}] (${v.action} ${v.confidence}%, ♥${v.likes}) | entry=${v.entry ?? "null"}, SL=${v.stop_loss ?? "null"}, TP=${v.take_profit ?? "null"} | "${v.content}"`,
    )
    .join("\n");

  const apiKey = getVault().keys.anthropic?.trim();
  const { text, model } = await claudeAnalysis({
    ...(signal ? { signal } : {}),
    data: {
      task: "review",
      ...(apiKey ? { apiKey } : {}),
      images: [],
      messages: [
        {
          role: "user",
          content: `Review the simulation departments' votes and arguments below.
${voteRule}

Your role as Claude is strictly to:
1. Confirm the vote tally (${tally.BUY} BUY vs ${tally.SELL} SELL).
2. Identify the single strongest argument supporting the winning side.
3. Choose the most appropriate Entry, Stop Loss (SL), and Take Profit (TP) from the winning agents' proposed levels and the decoded chart structure.
4. Report a confidence score (0%–100%) reflecting vote margin and argument strength.
Do NOT invent prices and do NOT output neutral, HOLD, WAIT, or undecided.

Question: ${sim.question}

Original Seed Context:
${sim.seed.slice(0, 6000)}

${sim.chartEvidence ? `Decoded Chart Sections:\n${sim.chartEvidence}\n\n` : ""}Simulation Models Used: ${(sim.modelsUsed ?? []).join(", ") || "Router chain"}

Final-Round Department Votes & Proposed SL/TP Candidates:
${winningSideCandidates || "(no structured votes recorded)"}

Injected Events: ${sim.injections.map((i) => `r${i.round}: ${i.text}`).join("; ") || "none"}

${mem.length ? `Memory Facts:\n${mem.join("\n")}\n\n` : ""}Full Simulated Debate Feed (${sim.posts.length} posts across ${sim.roundsDone} rounds):
${sim.posts.map((p) => `(r${p.round}) ${p.author}${p.department ? ` [${p.department}]` : ""}${p.vote ? ` (${p.vote} ${p.confidence ?? 60}%)` : ""}: ${p.content} ♥${p.likes}`).join("\n").slice(-14000)}

Format your verdict strictly as: Decision: [BUY/SELL], Confidence Score: [XX]%

Return VALID JSON ONLY with this exact shape:
{
  "signal": "BUY" | "SELL",
  "confidence": 0-100,
  "entry": number | null,
  "stop_loss": number | null,
  "take_profit": number | null,
  "strongest_argument": "Quote or summarize the single strongest winning argument from the simulation.",
  "rationale": "Decision: [BUY/SELL], Confidence Score: [XX]% — Cite the vote tally (${tally.BUY} BUY vs ${tally.SELL} SELL), strongest argument, and why the selected SL/TP fits the chart.",
  "report": "Markdown report starting on line 1 with: Decision: [BUY/SELL], Confidence Score: [XX]%, followed by sections: ## Vote Tally & Strongest Argument, ## Selected Entry, SL & TP Rationale, ## Department Consensus & Risks"
}`,
        },
      ],
    },
  });
  signal?.throwIfAborted();

  let parsed: ClaudeReviewPayload | null = null;
  try {
    parsed = parseJsonLenient<ClaudeReviewPayload>(text);
  } catch {
    parsed = null;
  }

  const normalized = parsed
    ? normalizeSignal(parsed, tally.tieBreakerBias)
    : (() => {
        const decisionMatch = text.match(/Decision\s*:\s*(BUY|SELL)\b/i) ?? text.match(/\b(BUY|SELL)\b/i);
        const confMatch = text.match(/Confidence(?:\s+Score)?\s*:\s*(\d{1,3})\s*%/i) ?? text.match(/(\d{1,3})\s*%/);
        return normalizeSignal(
          {
            signal: (decisionMatch?.[1]?.toUpperCase() as "BUY" | "SELL" | undefined) ?? inferSignalDirection(text, tally.tieBreakerBias),
            confidence: confMatch ? Number(confMatch[1]) : 60,
            rationale: text.split("\n").find((l) => l.trim().length > 10)?.slice(0, 300) ?? "",
          },
          tally.tieBreakerBias,
        );
      })();

  const finalSignal = tally.lockedSignal ?? normalized.signal;
  const fallbackLevels = pickBestLevels(finalAgentVotes, finalSignal);
  const entry = normalized.entry ?? fallbackLevels.entry;
  const stop_loss = normalized.stop_loss ?? fallbackLevels.stop_loss;
  const take_profit = normalized.take_profit ?? fallbackLevels.take_profit;

  const winningPosts = finalAgentVotes.filter((v) => v.action === finalSignal);
  const avgVoteShare = finalAgentVotes.length ? Math.round((winningPosts.length / finalAgentVotes.length) * 100) : 60;
  const confidence = normalized.confidence > 0 ? normalized.confidence : avgVoteShare;
  const strongestArgument =
    String(parsed?.strongest_argument ?? "").trim() ||
    winningPosts.sort((a, b) => b.likes - a.likes || b.confidence - a.confidence)[0]?.content ||
    "";

  const decisionHeader = `Decision: ${finalSignal}, Confidence Score: ${confidence}%`;
  const rawReport = parsed?.report?.trim() || text;
  const reportMarkdown = /^Decision\s*:\s*(BUY|SELL)/i.test(rawReport) ? rawReport : `${decisionHeader}\n\n${rawReport}`;
  const verdict: SimVerdict = {
    signal: finalSignal,
    confidence,
    entry,
    stop_loss,
    take_profit,
    rationale: normalized.rationale || `${decisionHeader} — ${tally.BUY} BUY vs ${tally.SELL} SELL votes.`,
    model,
    reviewedAt: Date.now(),
    votes: { BUY: tally.BUY, SELL: tally.SELL },
    ...(strongestArgument ? { strongestArgument } : {}),
    decisionSource: tally.lockedSignal ? "agent_majority_votes" : "tie_broken_by_strongest_argument",
  };
  cur = {
    ...cur,
    verdict,
    report: reportMarkdown,
    modelsUsed: cur.modelsUsed?.includes(`anthropic:${model}`) ? cur.modelsUsed : [...(cur.modelsUsed ?? []), `anthropic:${model}`],
    stage: "done",
  };
  log(
    u,
    `Final decision (${verdict.decisionSource === "agent_majority_votes" ? "majority vote" : "tie-break"}): Decision: ${verdict.signal}, Confidence Score: ${verdict.confidence}% (${tally.BUY} BUY · ${tally.SELL} SELL)`,
  );
  u(() => cur);
  return cur;
}

export async function interview(sim: Sim, who: string | "ReportAgent", history: Msg[], signal?: AbortSignal) {
  const agent = sim.agents.find((a) => a.name === who);
  const mine = sim.posts
    .filter((p) => p.author === who)
    .map((p) => `(r${p.round}) ${p.content}`)
    .join("\n");
  const mem = await memory(sim, history[history.length - 1]?.content ?? sim.question);
  const system = agent
    ? `You are ${agent.name}, ${agent.role}. ${agent.persona} Initial stance: ${agent.stance}. You lived through a simulation about "${sim.question}". Your posts:\n${mine || "(none)"}\n${mem.length ? `What you remember:\n${mem.join("\n")}` : ""}\nStay fully in character and commit to a clear BUY or SELL stance (never neutral or wait).`
    : `You are ReportAgent (Claude Haiku 5.5). Answer questions decisively using the final BUY/SELL verdict, report, chart evidence, and feed. Always commit to BUY or SELL with a 0-100% confidence score—never say wait, hold, or neutral.\nVerdict: ${sim.verdict ? `Decision: ${sim.verdict.signal}, Confidence Score: ${sim.verdict.confidence}% - ${sim.verdict.rationale}` : "pending"}\nReport:\n${sim.report.slice(0, 6000)}\nFeed:\n${sim.posts.map((p) => `${p.author}: ${p.content}`).join("\n").slice(-6000)}`;
  if (!agent) {
    signal?.throwIfAborted();
    const apiKey = getVault().keys.anthropic?.trim();
    const result = await claudeAnalysis({
      ...(signal ? { signal } : {}),
      data: {
        task: "review",
        ...(apiKey ? { apiKey } : {}),
        images: [],
        messages: [{ role: "system", content: system }, ...history],
      },
    });
    signal?.throwIfAborted();
    return result;
  }
  return ask([{ role: "system", content: system }, ...history], signal);
}

// Local persistence
const KEY = "mirofish-sims-v1";
export function loadSims(): Sim[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Sim[];
  } catch {
    return [];
  }
}
export function saveSims(s: Sim[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.slice(0, 20)));
  } catch {
    /* quota */
  }
}

const imageDescriptions = new Map<string, string>();

/** Read charts strictly via server-side Claude Haiku 5.5, caching successful repeated requests in memory. */
export async function describeImages(images: string[], context: string, signal?: AbortSignal): Promise<string> {
  if (!images.length) return "";
  signal?.throwIfAborted();
  const key = JSON.stringify([context.slice(0, 500), images]);
  const cached = imageDescriptions.get(key);
  if (cached) return cached;
  const apiKey = getVault().keys.anthropic?.trim();
  const result = await claudeAnalysis({
    ...(signal ? { signal } : {}),
    data: {
      task: "pictures",
      ...(apiKey ? { apiKey } : {}),
      images,
      messages: [{ role: "user", content: context.slice(0, 4000) }],
    },
  });
  signal?.throwIfAborted();
  if (!result.text.trim()) throw new Error("Claude returned no image-reading analysis.");
  const description = result.text.trim();
  if (imageDescriptions.size >= 4) {
    const oldest = imageDescriptions.keys().next().value;
    if (oldest !== undefined) imageDescriptions.delete(oldest);
  }
  imageDescriptions.set(key, description);
  return description;
}
