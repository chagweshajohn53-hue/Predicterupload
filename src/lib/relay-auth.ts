import { createServerOnlyFn } from "@tanstack/react-start";
import { cleanChain, cleanKeys, type ChainEntry, type Keys } from "./vault";

export type SavedRelay = { keys: Keys; chain: ChainEntry[] };

type StoredTokenEntry = SavedRelay & { userId: string; updatedAt: number };

const CACHE_FILE = "/tmp/failover-relay-tokens.json";
const tokenMap = new Map<string, StoredTokenEntry>();
let hydrated = false;

async function loadCache() {
  if (hydrated) return;
  hydrated = true;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, StoredTokenEntry>;
    for (const [token, entry] of Object.entries(parsed)) {
      if (token && entry?.keys && Array.isArray(entry.chain)) {
        tokenMap.set(token, entry);
      }
    }
  } catch {
    /* ignore missing cache or edge runtime without node:fs */
  }
}

async function persistCache() {
  try {
    const fs = await import("node:fs/promises");
    await fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(tokenMap)), { mode: 0o600 });
  } catch {
    /* ignore in edge/read-only runtimes */
  }
}

export const registerRelayToken = createServerOnlyFn(async (userId: string, vault: SavedRelay) => {
  await loadCache();
  for (const [existingToken, entry] of tokenMap.entries()) {
    if (entry.userId === userId) tokenMap.delete(existingToken);
  }
  const clean = { keys: cleanKeys(vault.keys), chain: cleanChain(vault.chain) };
  const token = clean.keys.apiToken.trim();
  if (token.length >= 24) {
    tokenMap.set(token, { ...clean, userId, updatedAt: Date.now() });
  }
  await persistCache();
});

/** Personal-token lookup for /v1/* and /api/public/v1/* endpoints. */
export const lookupRelayToken = createServerOnlyFn(async (token: string): Promise<SavedRelay | null> => {
  await loadCache();
  const entry = tokenMap.get(token);
  if (!entry || entry.keys.apiToken !== token || !Array.isArray(entry.chain)) return null;
  return { keys: cleanKeys(entry.keys), chain: cleanChain(entry.chain) };
});