import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Pause, Play, RotateCcw, Trash2, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { buildWorld, describeImages, interview, loadSims, newSim, runRound, saveSims, writeReport, type Sim } from "@/lib/swarm";
import type { Msg } from "@/lib/providers";
import { useVault } from "@/lib/vault";
import { Area, Btn, Field, Panel, Tag } from "./ui";
import { cn } from "@/lib/utils";
import { ImagePaste, imagesFromPaste } from "./ImagePaste";

const STEPS = ["Graph", "Agents", "Simulate", "Report", "Interact"];
const stepIndex = (s: Sim) => ({ graph: 0, agents: 1, simulating: 2, report: 3, done: 4, error: 2 })[s.stage];

export function SwarmPanel() {
  const [sims, setSims] = useState<Sim[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => setSims(loadSims()), []);
  const active = sims.find((s) => s.id === activeId) ?? null;
  const update = (id: string) => (fn: (s: Sim) => Sim) =>
    setSims((all) => {
      const next = all.map((s) => (s.id === id ? fn(s) : s));
      saveSims(next);
      return next;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-2">
        <Btn className="w-full" onClick={() => setActiveId(null)}>
          + New simulation
        </Btn>
        {sims.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex items-center gap-2 rounded-md border p-2",
              s.id === activeId ? "border-primary" : "border-border",
            )}
          >
            <button className="min-w-0 flex-1 text-left" onClick={() => setActiveId(s.id)}>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm">{s.title}</span>
                {s.verdict && (
                  <Tag tone={s.verdict.signal === "BUY" ? "ok" : "bad"}>
                    {s.verdict.signal} {s.verdict.confidence}%
                  </Tag>
                )}
              </div>
              <div className="font-mono text-[10px] uppercase text-muted-foreground">
                {s.stage} · {s.agents.length} agents · r{s.roundsDone}
              </div>
            </button>
            <button
              aria-label="Delete simulation"
              className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              onClick={() =>
                setSims((a) => {
                  const n = a.filter((x) => x.id !== s.id);
                  saveSims(n);
                  if (activeId === s.id) setActiveId(null);
                  return n;
                })
              }
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </aside>
      {active ? (
        <SimView key={active.id} sim={active} update={update(active.id)} />
      ) : (
        <NewSim
          onCreate={(s) => {
            setSims((a) => {
              const n = [s, ...a];
              saveSims(n);
              return n;
            });
            setActiveId(s.id);
          }}
        />
      )}
    </div>
  );
}

function NewSim({ onCreate }: { onCreate: (s: Sim) => void }) {
  const { keys } = useVault();
  const [seed, setSeed] = useState("");
  const [q, setQ] = useState("");
  const [agents, setAgents] = useState(8);
  const [rounds, setRounds] = useState(6);
  const [images, setImages] = useState<string[]>([]);
  const [reading, setReading] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      let full = seed;
      let chartEvidence: string | undefined;
      if (images.length) {
        setReading("Claude Haiku 5.5 is reading chart pictures…");
        chartEvidence = await describeImages(images, q);
        full = `${seed}\n\n[Chart evidence extracted by Claude Haiku 5.5]\n${chartEvidence}`;
      }
      setReading("");
      onCreate({ ...newSim(full, q, rounds, chartEvidence), log: [`agents:${agents}`] });
    } catch (e) {
      setReading(`⚠ Couldn't read pictures: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const readFile = async (f: File) => setSeed((await f.text()).slice(0, 40000));

  return (
    <Panel
      title="Rehearse the future"
      right={
        <div className="flex items-center gap-2">
          <Tag tone="primary">Claude Haiku 5.5 bookends</Tag>
          <Tag tone={keys.zep ? "ok" : "muted"}>{keys.zep ? "zep memory on" : "local memory"}</Tag>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Paste charts or seed material. Claude Haiku 5.5 decodes chart structure, levels, price action, and indicators
          into strategy sections; specialist departments debate and vote BUY or SELL with Entry/SL/TP; Claude tallies the
          majority vote, highlights the strongest argument, and picks the best SL & TP.
        </p>
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Seed material</span>
          <Area
            rows={8}
            disabled={creating}
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onPaste={(e) =>
              void imagesFromPaste(e, (u) => setImages((p) => [...p, ...u].slice(0, 6)), setReading)
            }
            placeholder="Paste market context, news, report — or Ctrl+V chart screenshots for Claude Haiku 5.5…"
          />
        </label>
        <ImagePaste
          disabled={creating}
          images={images}
          setImages={setImages}
          onText={(t) => setSeed((s) => (s ? s + "\n" : "") + t)}
        />
        <input
          type="file"
          accept=".txt,.md,.csv,.json"
          onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          className="text-xs text-muted-foreground"
        />
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">What do you want to predict?</span>
          <Field
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Should we BUY or SELL EURUSD over the next session?"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Agents: {agents}</span>
            <input
              type="range"
              min={4}
              max={16}
              value={agents}
              onChange={(e) => setAgents(+e.target.value)}
              className="w-full accent-primary"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Rounds: {rounds}</span>
            <input
              type="range"
              min={2}
              max={20}
              value={rounds}
              onChange={(e) => setRounds(+e.target.value)}
              className="w-full accent-primary"
            />
          </label>
        </div>
        <Btn
          disabled={(seed.trim().length < 40 && !images.length) || !q.trim() || creating}
          onClick={() => void create()}
        >
          <Zap size={14} /> Build world & simulate
        </Btn>
        {reading && <p className="font-mono text-xs text-muted-foreground">{reading}</p>}
      </div>
    </Panel>
  );
}

function SimView({ sim, update }: { sim: Sim; update: (fn: (s: Sim) => Sim) => void }) {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [event, setEvent] = useState("");
  const ctrl = useRef<AbortController | null>(null);
  const simRef = useRef(sim);
  simRef.current = sim;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const guard = async (fn: (signal: AbortSignal) => Promise<void>) => {
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    update((s) => {
      const next = { ...s };
      delete next.error;
      return next;
    });
    try {
      await fn(c.signal);
    } catch (e) {
      const aborted =
        c.signal.aborted ||
        (e as Error)?.name === "AbortError" ||
        /aborted/i.test(String((e as Error)?.message));
      if (!aborted)
        update((s) => ({
          ...s,
          error: (e as Error).message,
          log: [...s.log, `⚠ ${(e as Error).message}`],
        }));
      setAuto(false);
    } finally {
      setBusy(false);
    }
  };

  // Kick off world building for fresh sims
  useEffect(() => {
    if (sim.stage === "graph" && sim.entities.length === 0 && !busy) {
      const n = Number(sim.log[0]?.startsWith("agents:") ? sim.log[0].slice(7) : 8);
      void guard(async (sig) => {
        await buildWorld(sim, update, n, sig);
      });
    }
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runRounds = () =>
    guard(async (sig) => {
      setAuto(true);
      autoRef.current = true;
      let cur = simRef.current;
      while (autoRef.current && cur.roundsDone < cur.rounds) cur = await runRound(cur, update, sig);
      if (cur.roundsDone >= cur.rounds) await writeReport(cur, update, sig);
      setAuto(false);
    });

  const retryStep = () => {
    if (!sim.agents.length) {
      const n = Number(sim.log[0]?.startsWith("agents:") ? sim.log[0].slice(7) : 8);
      void guard(async (sig) => {
        await buildWorld(simRef.current, update, n, sig);
      });
    } else if (sim.roundsDone < sim.rounds) {
      void runRounds();
    } else {
      void guard(async (sig) => {
        await writeReport(simRef.current, update, sig);
      });
    }
  };

  const step = stepIndex(sim);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={cn(
              "rounded-full border px-3 py-1 font-mono text-[10px] uppercase",
              i < step
                ? "border-success/40 text-success"
                : i === step
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {i + 1}. {s}
          </span>
        ))}
        {busy && <Tag tone="warn">working…</Tag>}
        {sim.zepGraph && <Tag tone="ok">zep</Tag>}
        {sim.modelsUsed && sim.modelsUsed.length > 0 && (
          <Tag tone="muted">{sim.modelsUsed.length} model{sim.modelsUsed.length === 1 ? "" : "s"} used</Tag>
        )}
      </div>

      {sim.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{sim.error}</span>
          <Btn variant="ghost" disabled={busy} onClick={retryStep}>
            <RotateCcw size={12} /> Retry
          </Btn>
        </div>
      )}

      {sim.chartEvidence && (
        <details className="rounded-lg border border-border bg-card p-3" open={!sim.verdict}>
          <summary className="cursor-pointer font-mono text-xs uppercase text-primary">
            Claude Haiku 5.5 · Chart Evidence Extracted
          </summary>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {sim.chartEvidence}
          </pre>
        </details>
      )}

      {sim.verdict && <VerdictBanner sim={sim} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Knowledge graph · ${sim.entities.length}`}>
          <Graph sim={sim} />
        </Panel>
        <Panel title={`Agents · ${sim.agents.length}`}>
          <div className="max-h-[340px] space-y-2 overflow-auto">
            {sim.agents.map((a) => (
              <div key={a.name} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{a.name}</span>
                  {a.department && <Tag tone="primary">{a.department}</Tag>}
                  <Tag>{a.platform}</Tag>
                  <Tag tone="warn">{a.stance}</Tag>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.role} — {a.persona}
                </div>
              </div>
            ))}
            {!sim.agents.length && (
              <p className="text-sm text-muted-foreground">Agents appear after the graph is built.</p>
            )}
          </div>
        </Panel>
      </div>

      {sim.agents.length > 0 && (
        <Panel
          title={`Simulation · round ${sim.roundsDone}/${sim.rounds}`}
          right={
            <div className="flex gap-2">
              {auto ? (
                <Btn variant="ghost" onClick={() => setAuto(false)}>
                  <Pause size={12} /> Pause
                </Btn>
              ) : sim.roundsDone < sim.rounds ? (
                <Btn disabled={busy} onClick={runRounds}>
                  <Play size={12} /> {sim.roundsDone ? "Resume" : "Start"}
                </Btn>
              ) : (
                <Btn
                  variant={sim.report ? "ghost" : "primary"}
                  disabled={busy}
                  onClick={() =>
                    guard(async (sig) => {
                      await writeReport(simRef.current, update, sig);
                    })
                  }
                >
                  {sim.report ? "Refresh Claude signal" : "Get Claude signal"}
                </Btn>
              )}
              {sim.roundsDone >= sim.rounds && (
                <Btn
                  variant="ghost"
                  disabled={busy}
                  onClick={() => update((s) => ({ ...s, rounds: s.rounds + 3, stage: "simulating" }))}
                >
                  +3 rounds
                </Btn>
              )}
            </div>
          }
        >
          <div className="mb-3 flex gap-2">
            <Field
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              placeholder="God's-eye view: inject a breaking event into the next round…"
            />
            <Btn
              variant="ghost"
              disabled={!event.trim()}
              onClick={() => {
                update((s) => ({
                  ...s,
                  injections: [...s.injections, { round: s.roundsDone + 1, text: event.trim() }],
                }));
                setEvent("");
              }}
            >
              Inject
            </Btn>
          </div>
          <Feed sim={sim} />
        </Panel>
      )}

      {sim.report && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Prediction report">
            <div className="prose prose-sm max-w-none text-foreground [&_h2]:mt-4 [&_h2]:font-mono [&_h2]:text-sm [&_h2]:uppercase [&_h2]:text-primary [&_li]:ml-4 [&_li]:list-disc [&_p]:my-2">
              <ReactMarkdown>{sim.report}</ReactMarkdown>
            </div>
          </Panel>
          <Interview sim={sim} />
        </div>
      )}

      <details className="rounded-md border border-border p-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-mono uppercase">Engine log</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
          {sim.log.filter((l) => !l.startsWith("agents:")).join("\n")}
        </pre>
      </details>
    </div>
  );
}

function VerdictBanner({ sim }: { sim: Sim }) {
  const v = sim.verdict!;
  const tone = v.signal === "BUY" ? "border-success/60 bg-success/10 text-success" : "border-destructive/60 bg-destructive/10 text-destructive";
  const barColor = v.signal === "BUY" ? "bg-success" : "bg-destructive";
  const Icon = v.signal === "BUY" ? TrendingUp : TrendingDown;

  return (
    <div className={cn("rounded-lg border p-4", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-current/30 bg-background/60">
            <Icon size={22} />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {v.decisionSource === "tie_broken_by_strongest_argument"
                ? `Tie-Break by Strongest Argument · Reviewed by ${v.model}`
                : `Agent Majority Locked · Reviewed by ${v.model}`}
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tracking-tight">Decision: {v.signal}</span>
              <span className="font-mono text-lg font-semibold text-foreground">Confidence Score: {v.confidence}%</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-xs text-foreground">
          {v.votes && (
            <span className="rounded border border-border bg-background/80 px-2.5 py-1">
              Votes: {v.votes.BUY} BUY · {v.votes.SELL} SELL
            </span>
          )}
          {v.entry !== null && (
            <span className="rounded border border-border bg-background/80 px-2.5 py-1">Entry: {v.entry}</span>
          )}
          {v.stop_loss !== null && (
            <span className="rounded border border-border bg-background/80 px-2.5 py-1">SL: {v.stop_loss}</span>
          )}
          {v.take_profit !== null && (
            <span className="rounded border border-border bg-background/80 px-2.5 py-1">TP: {v.take_profit}</span>
          )}
        </div>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-background/70">
        <div className={cn("h-full transition-all", barColor)} style={{ width: `${v.confidence}%` }} />
      </div>
      {v.strongestArgument && (
        <div className="mt-3 rounded border border-border/70 bg-background/60 px-3 py-2 text-xs text-foreground">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Strongest argument: </span>
          {v.strongestArgument}
        </div>
      )}
      {v.rationale && <p className="mt-2 text-sm text-foreground">{v.rationale}</p>}
    </div>
  );
}

function Graph({ sim }: { sim: Sim }) {
  const pos = useMemo(() => {
    const n = sim.entities.length || 1;
    return Object.fromEntries(
      sim.entities.map((e, i) => {
        const a = (i / n) * Math.PI * 2;
        const r = i % 2 ? 120 : 150;
        return [e.name, { x: 200 + Math.cos(a) * r, y: 170 + Math.sin(a) * r * 0.85 }];
      }),
    );
  }, [sim.entities]);
  const types = [...new Set(sim.entities.map((e) => e.type))];
  const color = (t: string) => `var(--chart-${(types.indexOf(t) % 5) + 1})`;
  if (!sim.entities.length) return <p className="text-sm text-muted-foreground">Reading seed material…</p>;
  return (
    <svg viewBox="0 0 400 340" className="h-[340px] w-full">
      {sim.relations.map((r, i) => {
        const a = pos[r.source],
          b = pos[r.target];
        if (!a || !b) return null;
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border)" strokeWidth={1} />
            <text
              x={(a.x + b.x) / 2}
              y={(a.y + b.y) / 2}
              fontSize={5}
              fill="var(--muted-foreground)"
              textAnchor="middle"
            >
              {r.label}
            </text>
          </g>
        );
      })}
      {sim.entities.map((e) => {
        const p = pos[e.name];
        if (!p) return null;
        return (
          <g key={e.name}>
            <title>{`${e.type}: ${e.summary}`}</title>
            <circle cx={p.x} cy={p.y} r={7} fill={color(e.type)} />
            <text x={p.x} y={p.y - 10} fontSize={8} fill="var(--foreground)" textAnchor="middle">
              {e.name.slice(0, 22)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Feed({ sim }: { sim: Sim }) {
  const [tab, setTab] = useState<"twitter" | "reddit">("twitter");
  const posts = sim.posts.filter((p) => p.platform === tab).slice().reverse();
  return (
    <div>
      <div className="mb-2 flex gap-1">
        {(["twitter", "reddit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded px-2 py-1 font-mono text-[10px] uppercase",
              tab === t ? "bg-secondary text-foreground" : "text-muted-foreground",
            )}
          >
            {t} · {sim.posts.filter((p) => p.platform === t).length}
          </button>
        ))}
      </div>
      <div className="max-h-[420px] space-y-2 overflow-auto">
        {sim.injections.length > 0 &&
          sim.injections.map((i, k) => (
            <div key={k} className="rounded-md border border-accent/50 p-2 text-xs text-accent">
              ⚡ Round {i.round}: {i.text}
            </div>
          ))}
        {posts.map((p) => (
          <div key={p.id} className={cn("rounded-md border border-border p-2", p.replyTo && "ml-6")}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{p.author}</span>
              {p.department && <Tag>{p.department}</Tag>}
              {p.vote && (
                <Tag tone={p.vote === "BUY" ? "ok" : "bad"}>
                  {p.vote} {p.confidence ?? 60}%
                </Tag>
              )}
              <span className="font-mono text-muted-foreground">
                r{p.round} · {p.id}
                {p.replyTo ? ` ↳ ${p.replyTo}` : ""}
              </span>
              <span className="ml-auto text-muted-foreground">♥ {p.likes}</span>
            </div>
            <p className="mt-1 text-sm">{p.content}</p>
            {(p.entry !== undefined && p.entry !== null) ||
            (p.stop_loss !== undefined && p.stop_loss !== null) ||
            (p.take_profit !== undefined && p.take_profit !== null) ? (
              <div className="mt-1 flex flex-wrap gap-2 font-mono text-[10px] text-muted-foreground">
                {p.entry !== undefined && p.entry !== null && <span>Entry {p.entry}</span>}
                {p.stop_loss !== undefined && p.stop_loss !== null && <span>SL {p.stop_loss}</span>}
                {p.take_profit !== undefined && p.take_profit !== null && <span>TP {p.take_profit}</span>}
              </div>
            ) : null}
          </div>
        ))}
        {!posts.length && <p className="text-sm text-muted-foreground">No posts yet.</p>}
      </div>
    </div>
  );
}

function Interview({ sim }: { sim: Sim }) {
  const [who, setWho] = useState("ReportAgent");
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [shots, setShots] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const hist = chats[who] ?? [];
  const send = async () => {
    if (busy) return;
    setError("");
    const pics = images;
    const key = `${who}:${hist.length}`;
    setShots((s) => ({ ...s, [key]: pics }));
    setImages([]);
    setInput("");
    setBusy(true);
    let text = input || "What do you see in these pictures?";
    setChats((c) => ({ ...c, [who]: [...hist, { role: "user", content: text }] }));
    try {
      if (pics.length)
        text += `\n\n[Attached pictures, described by Claude Haiku 5.5]\n${await describeImages(pics, `${sim.question}\n${text}`)}`;
    } catch (e) {
      setImages(pics);
      setChats((c) => ({
        ...c,
        [who]: [
          ...hist,
          { role: "user", content: text },
          { role: "assistant", content: `⚠ Couldn't read pictures: ${e instanceof Error ? e.message : String(e)}` },
        ],
      }));
      setBusy(false);
      return;
    }
    const h: Msg[] = [...hist, { role: "user", content: text }];
    setChats((c) => ({ ...c, [who]: h }));
    try {
      const { text } = await interview(sim, who, h);
      setChats((c) => ({ ...c, [who]: [...h, { role: "assistant", content: text }] }));
    } catch (e) {
      setChats((c) => ({ ...c, [who]: [...h, { role: "assistant", content: `⚠ ${(e as Error).message}` }] }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Talk to the world">
      <select
        disabled={busy}
        value={who}
        onChange={(e) => setWho(e.target.value)}
        className="mb-3 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        <option value="ReportAgent">ReportAgent (Claude Haiku 5.5)</option>
        {sim.agents.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} — {a.role}
          </option>
        ))}
      </select>
      <div className="mb-3 max-h-[380px] space-y-2 overflow-auto">
        {hist.map((m, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap rounded-md p-2 text-sm",
              m.role === "user" ? "ml-8 bg-secondary" : "mr-8 border border-border",
            )}
          >
            {shots[`${who}:${i}`]?.length ? (
              <div className="mb-1 flex flex-wrap gap-1">
                {shots[`${who}:${i}`]?.map((u, j) => (
                  <img key={j} src={u} alt="attached" className="h-14 rounded border border-border" />
                ))}
              </div>
            ) : null}
            {m.role === "user" ? m.content.split("\n\n[Attached pictures")[0] : m.content}
          </div>
        ))}
        {busy && <Tag tone="warn">thinking…</Tag>}
      </div>
      {error && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mb-2">
        <ImagePaste disabled={busy} images={images} setImages={setImages} onText={(t) => setInput((s) => s + t)} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if ((input.trim() || images.length) && !busy) void send();
        }}
      >
        <Field
          disabled={busy}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => void imagesFromPaste(e, (u) => setImages((p) => [...p, ...u].slice(0, 6)), setError)}
          placeholder={`Ask ${who}… (Ctrl+V a chart)`}
        />
        <Btn disabled={busy || (!input.trim() && !images.length)}>Send</Btn>
      </form>
    </Panel>
  );
}
