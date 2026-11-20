import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

const ExtraKeySchema = z.object({
  groq: z.string().max(512).optional(),
  gemini: z.string().max(512).optional(),
  openrouter: z.string().max(512).optional(),
  cfAccount: z.string().max(512).optional(),
  cfToken: z.string().max(512).optional(),
});

const VaultSyncSchema = z.object({
  keys: z.object({
    groq: z.string().max(512).default(""),
    gemini: z.string().max(512).default(""),
    openrouter: z.string().max(512).default(""),
    cfAccount: z.string().max(512).default(""),
    cfToken: z.string().max(512).default(""),
    apiToken: z.string().max(512).default(""),
    zep: z.string().max(512).default(""),
    anthropic: z.string().max(512).default(""),
    extra: z.array(ExtraKeySchema).max(10).optional(),
  }),
  chain: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        provider: z.enum(["groq", "gemini", "openrouter", "cloudflare"]),
        model: z.string().min(1).max(200),
        enabled: z.boolean(),
      }),
    )
    .max(50),
});

export const Route = createFileRoute("/api/public/relay-token")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const { verifyFirebaseRequest } = await import("@/integrations/firebase/auth-middleware");
        let userId: string;
        try {
          const verified = await verifyFirebaseRequest(request);
          userId = verified.userId;
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : "Unauthorized" }, { status: 401, headers: CORS });
        }

        const raw = await request.json().catch(() => null);
        const parsed = VaultSyncSchema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Invalid vault sync payload" }, { status: 400, headers: CORS });
        }

        const { registerRelayToken } = await import("@/lib/relay-auth");
        const { extra: rawExtra, ...baseKeys } = parsed.data.keys;
        const extra = rawExtra?.map((x) =>
          Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === "string")),
        );
        await registerRelayToken(userId, {
          keys: {
            ...baseKeys,
            ...(extra && extra.length > 0 ? { extra } : {}),
          },
          chain: parsed.data.chain,
        });
        return Response.json({ ok: true }, { headers: CORS });
      },
      ANY: () => Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS }),
    },
  },
});
