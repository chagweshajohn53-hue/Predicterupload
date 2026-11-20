import { useSyncExternalStore } from "react";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "./firebase";
import { syncRelayToken } from "./relay-auth.functions";

export type ProviderId = "groq" | "gemini" | "openrouter" | "cloudflare";
export type Keys = {
  groq: string;
  gemini: string;
  openrouter: string;
  cfAccount: string;
  cfToken: string;
  apiToken: string;
  zep: string;
  anthropic?: string;
  extra?: ExtraKeys[];
};
export type ExtraKeys = Partial<Pick<Keys, "groq" | "gemini" | "openrouter" | "cfAccount" | "cfToken">>;
export { expandChain, type PooledEntry } from "./pool";

export type ChainEntry = { id: string; provider: ProviderId; model: string; enabled: boolean };
export type Cooldown = { until: number; reason: string };
export type LiveStatus = {
  remainingReq?: string | undefined;
  remainingTok?: string | undefined;
  resetReq?: string | undefined;
  lastStatus?: number | undefined;
  at: number;
};

export type VaultState = {
  keys: Keys;
  chain: ChainEntry[];
  cooldowns: Record<string, Cooldown>;
  status: Record<string, LiveStatus>;
};

const uid = () => Math.random().toString(36).slice(2, 9);

export const DEFAULT_CHAIN: ChainEntry[] = [
  { id: "c1", provider: "groq", model: "llama-3.3-70b-versatile", enabled: true },
  { id: "c2", provider: "gemini", model: "gemini-2.5-flash", enabled: true },
  { id: "c3", provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free", enabled: true },
  { id: "c4", provider: "openrouter", model: "deepseek/deepseek-chat-v3-0324:free", enabled: true },
  { id: "c8", provider: "openrouter", model: "qwen/qwen-2.5-72b-instruct:free", enabled: true },
  { id: "c5", provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", enabled: true },
  { id: "c9", provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", enabled: true },
  { id: "c10", provider: "groq", model: "qwen/qwen3-32b", enabled: true },
  { id: "c11", provider: "groq", model: "llama-3.1-8b-instant", enabled: true },
  { id: "c12", provider: "gemini", model: "gemini-2.5-flash-lite", enabled: true },
  { id: "c13", provider: "gemini", model: "gemini-2.0-flash", enabled: true },
  { id: "c14", provider: "openrouter", model: "deepseek/deepseek-r1:free", enabled: true },
  { id: "c15", provider: "openrouter", model: "google/gemma-3-27b-it:free", enabled: true },
  { id: "c16", provider: "openrouter", model: "mistralai/mistral-small-3.2-24b-instruct:free", enabled: true },
  { id: "c17", provider: "openrouter", model: "nvidia/llama-3.1-nemotron-ultra-253b-v1:free", enabled: true },
  { id: "c18", provider: "openrouter", model: "qwen/qwen3-235b-a22b:free", enabled: true },
  { id: "c19", provider: "openrouter", model: "liquid/lfm-2.5-2.6b:free", enabled: true },
  { id: "c22", provider: "cloudflare", model: "@cf/qwen/qwq-32b", enabled: true },
];

const DEFAULT: VaultState = {
  keys: { groq: "", gemini: "", openrouter: "", cfAccount: "", cfToken: "", apiToken: "", zep: "", anthropic: "" },
  chain: DEFAULT_CHAIN,
  cooldowns: {},
  status: {},
};

const KEY = "failover-vault-v1";
let state: VaultState = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state = {
        ...DEFAULT,
        ...saved,
        keys: cleanKeys(saved.keys),
        chain: cleanChain(saved.chain ?? DEFAULT_CHAIN),
      };
    }
  } catch {
    /* ignore */
  }
}

export function getVault(): VaultState {
  load();
  return state;
}

export function setVault(fn: (s: VaultState) => VaultState) {
  load();
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  scheduleCloudSave();
}

// ---- Cloud sync (Firebase Firestore: vaults/{userId}) ----
let cloudUser: string | null = null;
let cloudDocExists = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved = "";

function sanitizeForFirestore(keys: Keys, chain: ChainEntry[]) {
  const cleanedKeys = cleanKeys(keys);
  const bound = (v: string | undefined, max = 512) => String(v ?? "").slice(0, max);
  const safeKeys: Record<string, unknown> = {
    groq: bound(cleanedKeys.groq),
    gemini: bound(cleanedKeys.gemini),
    openrouter: bound(cleanedKeys.openrouter),
    cfAccount: bound(cleanedKeys.cfAccount),
    cfToken: bound(cleanedKeys.cfToken),
    apiToken: bound(cleanedKeys.apiToken),
    zep: bound(cleanedKeys.zep),
    anthropic: bound(cleanedKeys.anthropic),
  };
  if (cleanedKeys.extra?.length) {
    safeKeys["extra"] = cleanedKeys.extra.slice(0, 10).map((x) => {
      const out: Record<string, string> = {};
      for (const k of ["groq", "gemini", "openrouter", "cfAccount", "cfToken"] as const) {
        if (typeof x[k] === "string") out[k] = bound(x[k]);
      }
      return out;
    });
  }
  const safeChain = cleanChain(chain)
    .slice(0, 50)
    .map((e) => ({
      id: bound(e.id, 64) || uid(),
      provider: e.provider,
      model: bound(e.model, 200),
      enabled: Boolean(e.enabled),
    }))
    .filter((e) => e.model.length > 0);
  return { keys: safeKeys, chain: safeChain };
}

function scheduleCloudSave() {
  if (!cloudUser) return;
  const targetUser = cloudUser;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = sanitizeForFirestore(state.keys, state.chain);
    const json = JSON.stringify(payload);
    if (json === lastSaved || cloudUser !== targetUser) return;
    const path = `vaults/${targetUser}`;
    const ref = doc(db, "vaults", targetUser);
    try {
      if (cloudDocExists) {
        await updateDoc(ref, {
          keys: payload.keys,
          chain: payload.chain,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          userId: targetUser,
          keys: payload.keys,
          chain: payload.chain,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        cloudDocExists = true;
      }
      lastSaved = json;
      void syncRelayToken({
        data: {
          keys: cleanKeys(state.keys),
          chain: cleanChain(state.chain).slice(0, 50),
        },
      }).catch(() => {});
    } catch (err) {
      handleFirestoreError(err, cloudDocExists ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  }, 600);
}

export async function connectCloud(userId: string) {
  cloudUser = userId;
  cloudDocExists = false;
  const path = `vaults/${userId}`;
  const ref = doc(db, "vaults", userId);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      cloudDocExists = true;
      const remote = snap.data() as Partial<VaultState> | undefined;
      if (remote && (remote.keys || remote.chain)) {
        const nextKeys = cleanKeys(remote.keys);
        const nextChain = mergeChain(cleanChain(remote.chain ?? state.chain));
        lastSaved = JSON.stringify(sanitizeForFirestore(nextKeys, nextChain));
        setVault((s) => ({ ...s, keys: nextKeys, chain: nextChain }));
        if (nextKeys.apiToken) {
          void syncRelayToken({ data: { keys: nextKeys, chain: nextChain.slice(0, 50) } }).catch(() => {});
        }
        return;
      }
    }
    scheduleCloudSave();
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export function disconnectCloud() {
  cloudUser = null;
  cloudDocExists = false;
  lastSaved = "";
  clearTimeout(saveTimer);
  state = DEFAULT;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useVault(): VaultState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getVault,
    () => DEFAULT,
  );
}

export const newEntry = (provider: ProviderId, model: string): ChainEntry => ({
  id: uid(),
  provider,
  model,
  enabled: true,
});

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  groq: "Groq",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  cloudflare: "Cloudflare",
};

function mergeChain(c: ChainEntry[]) {
  const have = new Set(c.map((e) => e.provider + e.model));
  return [...c, ...DEFAULT_CHAIN.filter((d) => !have.has(d.provider + d.model)).map((d) => ({ ...d, id: uid() }))];
}

export function cleanKeys(raw: Partial<Keys> = {}): Keys {
  const base = Object.fromEntries(
    Object.keys(DEFAULT.keys)
      .filter((k) => k !== "extra")
      .map((k) => [k, String((raw as Record<string, unknown>)[k] ?? "")]),
  );
  const extra = (raw.extra ?? [])
    .slice(0, 10)
    .map((x) =>
      Object.fromEntries(
        Object.entries(x)
          .filter(([k, v]) => ["groq", "gemini", "openrouter", "cfAccount", "cfToken"].includes(k) && typeof v === "string")
          .map(([k, v]) => [k, String(v)]),
      ),
    );
  return { ...base, extra } as Keys;
}

export function cleanChain(chain: ChainEntry[]): ChainEntry[] {
  return chain.filter((e) => e && Object.hasOwn(PROVIDER_LABEL, e.provider) && typeof e.model === "string" && e.model.trim().length > 0);
}
