import { createFileRoute } from "@tanstack/react-router";
import { handleChatCompletion, openAIMethodNotAllowed, openAIOptions } from "@/lib/openai-api";

export const Route = createFileRoute("/api/public/v1/chat/completions")({
  server: { handlers: {
    OPTIONS: openAIOptions,
    POST: async ({ request }) => {
      const { lookupRelayToken } = await import("@/lib/relay-auth");
      return handleChatCompletion(request, lookupRelayToken);
    },
    ANY: openAIMethodNotAllowed,
  } },
});