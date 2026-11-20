import { auth } from "./firebase";
import type { SavedRelay } from "./relay-auth";

export async function syncRelayToken({ data }: { data: SavedRelay }): Promise<{ ok: boolean }> {
  await auth.authStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) return { ok: false };

  const res = await fetch("/api/public/relay-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) return { ok: false };
  return { ok: true };
}
