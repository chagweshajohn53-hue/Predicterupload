import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Hosted failover endpoint for external apps.
// Caller authenticates with the personal API token generated in the Export tab.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-expose-headers": "x-served-by, x-hops",
  "cache-control": "no-store",
};

const Body = z.object({
  type: z.enum(["chat", "image"]).default("chat"),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(100_000) })).max(200).optional(),
  prompt: z.string().max(4000).optional(),
  model: z.string().max(200).optional(),
});

const json = (d: unknown, status = 200) => Response.json(d, { status, headers: CORS });

export const Route = createFileRoute("/api/public/v1/generate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (token.length < 24) return json({ error: "Missing or invalid API token" }, 401);
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
        const b = parsed.data;

        const { lookupRelayToken } = await import("@/lib/relay-auth");
        const vault = await lookupRelayToken(token);
        if (!vault) return json({ error: "Invalid API token" }, 401);
        const keys = vault.keys;

        const { directFx, failover, genImage, IMAGE_MODELS, preferFirst, runHostedChat } = await import("@/lib/hub");

        if (b.type === "chat") {
          const messages = b.messages ?? (b.prompt ? [{ role: "user" as const, content: b.prompt }] : null);
          if (!messages) return json({ error: "messages or prompt required" }, 400);
          const result = await runHostedChat(directFx, keys, vault.chain, messages);
          if (!result.out || !result.model) return json({ error: "All providers exhausted", hops: result.hops }, 503);
          return json({
            ...result.out,
            served_by: { provider: result.model.provider, model: result.model.model },
            hops: result.hops,
          });
        }

        if (!b.prompt) return json({ error: "prompt required" }, 400);
        const prompt = b.prompt;
        const r = await failover(preferFirst(IMAGE_MODELS, b.model), (m) => genImage(directFx, keys, m, prompt));
        if (!r.out || !r.model) return json({ error: "All models failed", hops: r.hops }, 503);
        return new Response(r.out, {
          headers: {
            ...CORS,
            "content-type": r.out.type || "image/jpeg",
            "x-served-by": r.model.id,
            "x-hops": JSON.stringify(r.hops).slice(0, 4000),
          },
        });
      },
      ANY: () => json({ error: "Method not allowed" }, 405),
    },
  },
});
