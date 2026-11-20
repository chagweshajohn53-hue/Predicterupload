import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

const json = (d: unknown, status = 200) => Response.json(d, { status, headers: CORS });

const ClaudeAnalysisSchema = z.object({
  task: z.enum(["pictures", "review", "test"]),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(100_000),
      }),
    )
    .max(200),
  apiKey: z.string().max(512).optional(),
  images: z
    .array(z.string().max(8_000_000).regex(/^data:image\/(jpeg|png|webp|gif);base64,/))
    .max(6)
    .default([]),
});

export const Route = createFileRoute("/api/public/claude")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const { verifyFirebaseRequest } = await import("@/integrations/firebase/auth-middleware");
        try {
          await verifyFirebaseRequest(request);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Unauthorized";
          return json({ error: msg }, 401);
        }

        const rawBody = await request.json().catch(() => null);
        const parsed = ClaudeAnalysisSchema.safeParse(rawBody);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return json(
            { error: issue ? `Invalid Claude request (${issue.path.join(".") || "body"}: ${issue.message})` : "Invalid Claude request payload." },
            400,
          );
        }

        const { callClaude, CHART_PROMPT, REVIEW_PROMPT } = await import("@/lib/claude");
        const data = parsed.data;
        const key = data.apiKey?.trim() || process.env["ANTHROPIC_API_KEY"]?.trim();
        const systemPrompt =
          data.task === "pictures"
            ? CHART_PROMPT
            : data.task === "review"
              ? REVIEW_PROMPT
              : "Connection check. Reply concisely.";

        try {
          const result = await callClaude(
            key,
            [
              { role: "system", content: systemPrompt },
              ...(data.task === "test"
                ? [{ role: "user" as const, content: "Reply with Connected." }]
                : data.messages),
            ],
            data.images,
            request.signal,
            fetch,
            data.task === "test" ? 128 : 4096,
          );
          return json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const status = /missing|HTTP 400|Unsupported chart image/i.test(msg)
            ? 400
            : /authentication failed|HTTP 401|HTTP 403/i.test(msg)
              ? 401
              : /HTTP 429|HTTP 529/i.test(msg)
                ? 429
                : 502;
          return json({ error: msg }, status);
        }
      },
      ANY: () => json({ error: "Method not allowed" }, 405),
    },
  },
});
