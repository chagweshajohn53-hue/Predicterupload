import { auth } from "./firebase";

export type ClaudeTask = "pictures" | "review" | "test";

export type ClaudeAnalysisInput = {
  task: ClaudeTask;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  apiKey?: string;
  images?: string[];
};

export type ClaudeAnalysisResult = {
  text: string;
  model: string;
};

export async function claudeAnalysis({
  data,
  signal,
}: {
  data: ClaudeAnalysisInput;
  signal?: AbortSignal;
}): Promise<ClaudeAnalysisResult> {
  signal?.throwIfAborted();
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("Please sign in with Google before running Claude analysis.");
  }

  const res = await fetch("/api/public/claude", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
    ...(signal ? { signal } : {}),
  });

  const raw = await res.text();
  let parsed: { text?: unknown; model?: unknown; error?: unknown } | null = null;
  try {
    parsed = raw ? (JSON.parse(raw) as { text?: unknown; model?: unknown; error?: unknown }) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed?.error === "string" && parsed.error.trim()
        ? parsed.error.trim()
        : raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220) ||
          `Claude request failed (HTTP ${res.status}).`;
    throw new Error(errMsg);
  }

  if (!parsed || typeof parsed.text !== "string" || typeof parsed.model !== "string") {
    throw new Error("Claude endpoint returned an unexpected response.");
  }

  return { text: parsed.text, model: parsed.model };
}