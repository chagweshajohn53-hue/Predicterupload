import { relay } from "./providers";

// Zep Cloud graph memory, called through the relay (keys stay in the user's vault).
const BASE = "https://api.getzep.com/api/v2";

async function call(key: string, path: string, body: unknown) {
  const res = await relay(BASE + path, { auth: `Api-Key ${key}`, body: JSON.stringify(body), contentType: "application/json" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zep ${res.status}: ${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export async function zepCreateGraph(key: string, graphId: string, name: string) {
  return call(key, "/graph/create", { graph_id: graphId, name });
}

export async function zepAdd(key: string, graphId: string, data: string) {
  // Zep caps episodes at ~10k chars.
  for (let i = 0; i < data.length; i += 9000) {
    await call(key, "/graph", { graph_id: graphId, type: "text", data: data.slice(i, i + 9000) });
  }
}

export async function zepSearch(key: string, graphId: string, query: string, limit = 6): Promise<string[]> {
  const r = await call(key, "/graph/search", { graph_id: graphId, query: query.slice(0, 380), scope: "edges", limit });
  return ((r?.edges ?? []) as { fact?: string }[]).map((e) => e.fact ?? "").filter(Boolean);
}

export async function zepTest(key: string) {
  const res = await relay(BASE + "/graph/list-all?pageSize=1", { auth: `Api-Key ${key}`, method: "GET" });
  if (!res.ok) throw new Error(`Zep ${res.status}: ${(await res.text()).slice(0, 160)}`);
}
