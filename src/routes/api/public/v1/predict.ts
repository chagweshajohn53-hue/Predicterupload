import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Runs the full Swarm (personas -> debate -> consensus) for external bots.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};
const json = (d: unknown, status = 200) => Response.json(d, { status, headers: CORS });

const Body = z.object({
  seed: z.string().min(10).max(60_000),
  question: z.string().min(3).max(1000),
  agents: z.number().int().min(3).max(10).default(6),
  rounds: z.number().int().min(1).max(5).default(2),
  images: z.array(z.string().max(8_000_000).regex(/^data:image\/(jpeg|png|webp|gif);base64,/)).max(6).default([]),
});

export const Route = createFileRoute("/api/public/v1/predict")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (token.length < 24) return json({ error: "Missing or invalid API token" }, 401);
        const { lookupRelayToken } = await import("@/lib/relay-auth");
        const vault = await lookupRelayToken(token);
        if (!vault) return json({ error: "Invalid API token" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
        try {
          const [{ directFx }, { runPrediction }, { callClaude }] = await Promise.all([
            import("@/lib/hub"),
            import("@/lib/predict"),
            import("@/lib/claude"),
          ]);
          const key = vault.keys.anthropic?.trim() || process.env["ANTHROPIC_API_KEY"];
          if (!key) return json({ error: "Claude API key is missing" }, 503);
          return json(await runPrediction(directFx, vault.keys, vault.chain, parsed.data, (messages, images) => callClaude(key, messages, images, request.signal)));
        } catch (e) {
          const msg = e instanceof Error && /exhausted|JSON|agents/.test(e.message) ? e.message : "Prediction failed";
          return json({ error: msg }, 503);
        }
      },
      ANY: () => json({ error: "Method not allowed" }, 405),
    },
  },
});
