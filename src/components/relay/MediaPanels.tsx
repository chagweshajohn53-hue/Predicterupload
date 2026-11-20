import { useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { relay, cfSpeak, cfTranscribe, groqTranscribe } from "@/lib/providers";
import { useVault } from "@/lib/vault";
import { failover, genImage, IMAGE_MODELS, preferFirst, type Fx } from "@/lib/hub";
import { Area, Btn, Panel, Tag } from "./ui";

export function ImagePanel() {
  const { keys } = useVault();
  const list = IMAGE_MODELS;
  const [prompt, setPrompt] = useState("");
  const [primary, setPrimary] = useState<string>(list[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [items, setItems] = useState<{ src: string; model: string; ms: number; prompt: string }[]>([]);
  const fx: Fx = (url, i) => relay(url, i);
  const go = async () => {
    setBusy(true);
    setLog([]);
    const t = performance.now();
    const r = await failover(preferFirst(list, primary), (m) => genImage(fx, keys, m, prompt));
    setLog(r.hops.map((h) => (h.ok ? `✓ ${h.model}` : `✗ ${h.model} — ${h.detail.slice(0, 90)} → failing over`)));
    if (r.out && r.model)
      setItems((x) => [{ src: URL.createObjectURL(r.out!), model: r.model!.id, ms: performance.now() - t, prompt }, ...x]);
    setBusy(false);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel title="Image · all providers">
        <div className="space-y-3">
          <select
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          >
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <Area
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A lighthouse in a storm, cinematic"
          />
          <Btn className="w-full" onClick={go} disabled={!prompt || busy}>
            {busy ? "Generating…" : "Generate"}
          </Btn>
          <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Gallery">
        {items.length === 0 ? (
          <p className="font-mono text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((im, i) => (
              <figure key={i} className="overflow-hidden rounded-md border border-border">
                <img src={im.src} alt={im.prompt} className="aspect-square w-full object-cover" />
                <figcaption className="flex justify-between p-2 font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{im.model.split("/").pop()}</span>
                  <span>{Math.round(im.ms)}ms</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

const SPEAKERS = ["angus", "asteria", "arcas", "orion", "orpheus", "athena", "luna", "zeus", "perseus", "helios", "hera", "stella"];

export function VoicePanel() {
  const { keys } = useVault();
  const [rec, setRec] = useState(false);
  const [text, setText] = useState("");
  const [via, setVia] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mr = useRef<MediaRecorder | null>(null);
  const [tts, setTts] = useState("Hello from the failover relay.");
  const [speaker, setSpeaker] = useState("asteria");
  const [audio, setAudio] = useState("");

  const transcribe = async (blob: Blob) => {
    setBusy(true);
    setErr("");
    setVia("");
    const t = performance.now();
    const tries: [string, () => Promise<string>][] = [];
    if (keys.groq) tries.push(["Groq whisper-large-v3-turbo", () => groqTranscribe(keys, blob)]);
    if (keys.cfAccount && keys.cfToken) tries.push(["Cloudflare whisper", () => cfTranscribe(keys, blob)]);
    const fails: string[] = [];
    for (const [name, fn] of tries) {
      try {
        setText(await fn());
        setVia(`${name}${fails.length ? " (failover)" : ""} · ${Math.round(performance.now() - t)}ms`);
        break;
      } catch (e) {
        fails.push(`${name}: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    if (!tries.length) fails.push("Add a Groq or Cloudflare key.");
    setErr(fails.join("\n"));
    setBusy(false);
  };

  const toggle = async () => {
    if (rec) {
      mr.current?.stop();
      setRec(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void transcribe(new Blob(chunks, { type: r.mimeType }));
      };
      r.start();
      mr.current = r;
      setRec(true);
    } catch (e) {
      setErr(String(e));
    }
  };

  const speak = async () => {
    setBusy(true);
    setErr("");
    try {
      setAudio(await cfSpeak(keys, tts, speaker));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Transcribe · Groq Whisper → CF Whisper">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Btn onClick={toggle} variant={rec ? "danger" : "primary"} disabled={busy}>
              {rec ? (
                <>
                  <Square size={14} /> Stop
                </>
              ) : (
                <>
                  <Mic size={14} /> Record
                </>
              )}
            </Btn>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-border bg-secondary px-3 font-mono text-xs uppercase">
              Upload
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void transcribe(e.target.files[0])}
              />
            </label>
          </div>
          {busy && <Tag>working…</Tag>}
          {via && <Tag tone="ok">{via}</Tag>}
          <Area rows={6} value={text} readOnly placeholder="Transcript appears here" />
        </div>
      </Panel>
      <Panel title="Speak · Cloudflare Aura">
        <div className="space-y-3">
          <select
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          >
            {SPEAKERS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Area rows={4} value={tts} onChange={(e) => setTts(e.target.value)} />
          <Btn onClick={speak} disabled={busy || !tts || !keys.cfToken}>
            Synthesize
          </Btn>
          {audio && <audio src={audio} controls autoPlay className="w-full" />}
        </div>
      </Panel>
      {err && <pre className="whitespace-pre-wrap font-mono text-xs text-destructive md:col-span-2">{err}</pre>}
    </div>
  );
}
