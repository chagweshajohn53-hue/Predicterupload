import type { ChainEntry, Keys } from "./vault";

export type PooledEntry = ChainEntry & { keys: Keys; base: string };

/** Backup accounts: each chain entry is tried with the main key, then each extra key, before moving on. */
export function expandChain(chain: ChainEntry[], keys: Keys): PooledEntry[] {
  const out: PooledEntry[] = [];
  for (const e of chain) {
    out.push({ ...e, keys, base: e.id });
    (keys.extra ?? []).forEach((x, i) => {
      const has = e.provider === "cloudflare" ? !!x.cfToken : !!x[e.provider];
      if (!has) return;
      const k: Keys = { ...keys, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v)) };
      out.push({ ...e, keys: k, id: `${e.id}#${i + 2}`, base: e.id });
    });
  }
  return out;
}
