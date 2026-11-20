import { createFileRoute } from "@tanstack/react-router";
import { handleModels, openAIMethodNotAllowed, openAIOptions } from "@/lib/openai-api";

export const Route = createFileRoute("/api/public/v1/models")({
  server: { handlers: {
    OPTIONS: openAIOptions,
    GET: async ({ request }) => {
      const { lookupRelayToken } = await import("@/lib/relay-auth");
      return handleModels(request, lookupRelayToken);
    },
    ANY: openAIMethodNotAllowed,
  } },
});