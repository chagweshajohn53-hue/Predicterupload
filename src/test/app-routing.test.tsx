import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { openAIMethodNotAllowed, openAIOptions } from "@/lib/openai-api";
import { routeTree } from "@/routeTree.gen";

const EXPECTED_ROUTES = [
  "/",
  "/v1/models",
  "/v1/chat/completions",
  "/api/public/v1/models",
  "/api/public/v1/chat/completions",
  "/api/public/v1/generate",
  "/api/public/v1/predict",
  "/api/public/claude",
  "/api/public/relay",
  "/api/public/relay-token",
];

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches every page and API route instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    for (const path of EXPECTED_ROUTES) {
      const matches = router.matchRoutes(path);
      expect(matches.at(-1)?.routeId, `Expected route match for ${path}`).not.toBe(rootRouteId);
    }
  });

  it("returns 204 CORS and 405 JSON for OpenAI helper responses", async () => {
    const preflight = openAIOptions();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");

    const methodNotAllowed = openAIMethodNotAllowed();
    expect(methodNotAllowed.status).toBe(405);
    const body = (await methodNotAllowed.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe("method_not_allowed");
  });
});
