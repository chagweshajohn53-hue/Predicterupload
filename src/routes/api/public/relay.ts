import { createFileRoute } from "@tanstack/react-router";

// Stateless pass-through to whitelisted AI providers. Keys arrive per request
// from the browser vault and are never stored or logged here.
const ALLOWED = new Set([
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.cloudflare.com",
  "api.getzep.com",
]);

const EXPOSE = /^(x-ratelimit|retry-after|content-type|x-request-id)/i;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, x-target-url, x-fwd-method, x-fwd-authorization",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

const json = (d: unknown, status = 200) => Response.json(d, { status, headers: CORS });

export const Route = createFileRoute("/api/public/relay")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const target = request.headers.get("x-target-url") ?? "";
        let url: URL;
        try {
          url = new URL(target);
        } catch {
          return json({ error: "Invalid target" }, 400);
        }
        if (url.protocol !== "https:" || !ALLOWED.has(url.hostname)) {
          return json({ error: "Target not allowed" }, 403);
        }
        const method = (request.headers.get("x-fwd-method") ?? "POST").toUpperCase();
        const headers = new Headers();
        headers.set("user-agent", "FailoverRelay/1.0");
        const auth = request.headers.get("x-fwd-authorization");
        if (auth) headers.set("authorization", auth);
        const ct = request.headers.get("content-type");
        if (ct && method !== "GET" && method !== "HEAD") headers.set("content-type", ct);
        if (url.hostname === "openrouter.ai") headers.set("x-title", "Failover Relay");
        let upstream: Response;
        try {
          const init: RequestInit = {
            method,
            headers,
            signal: request.signal,
            redirect: "manual",
            ...(method === "GET" || method === "HEAD" ? {} : { body: await request.arrayBuffer() }),
          };
          upstream = await fetch(url, init);
        } catch (e) {
          return json({ error: `Upstream unreachable: ${String(e)}` }, 502);
        }
        const out = new Headers(CORS);
        upstream.headers.forEach((v, k) => {
          if (EXPOSE.test(k)) out.set(k, v);
        });
        return new Response(upstream.body, { status: upstream.status, headers: out });
      },
      ANY: () => json({ error: "Method not allowed" }, 405),
    },
  },
});
