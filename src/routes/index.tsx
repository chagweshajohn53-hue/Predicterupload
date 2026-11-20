import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChatPanel } from "@/components/relay/ChatPanel";
import { ChainPanel } from "@/components/relay/ChainPanel";
import { KeysPanel } from "@/components/relay/KeysPanel";
import { ImagePanel, VoicePanel } from "@/components/relay/MediaPanels";
import { ExportPanel } from "@/components/relay/ExportPanel";
import { SwarmPanel } from "@/components/relay/SwarmPanel";
import { cn } from "@/lib/utils";
import { AuthGate, SignOutButton } from "@/components/relay/AuthGate";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Failover Relay — Unified Free AI Playground" },
      {
        name: "description",
        content: "Chain Groq, Gemini, OpenRouter and Cloudflare free tiers with automatic rate-limit failover.",
      },
      { property: "og:title", content: "Failover Relay — Unified Free AI Playground" },
      {
        property: "og:description",
        content: "Chain free AI providers with automatic rate-limit failover, streaming chat, image and voice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const TABS = ["Swarm", "Chat", "Image", "Voice", "Router", "Keys", "Export"] as const;
type T = (typeof TABS)[number];

function Index() {
  const [tab, setTab] = useState<T>("Swarm");
  return (
    <AuthGate>
      <div className="min-h-screen">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
              <h1 className="font-mono text-sm font-semibold tracking-tight">
                failover<span className="text-primary">/</span>relay
              </h1>
            </div>
            <nav className="flex flex-wrap gap-1">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-3 py-1.5 font-mono text-xs uppercase tracking-wide",
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </nav>
            <div className="ml-auto">
              <SignOutButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          {tab === "Swarm" && <SwarmPanel />}
          {tab === "Chat" && <ChatPanel />}
          {tab === "Image" && <ImagePanel />}
          {tab === "Voice" && <VoicePanel />}
          {tab === "Router" && <ChainPanel />}
          {tab === "Keys" && <KeysPanel />}
          {tab === "Export" && <ExportPanel />}
        </main>
      </div>
    </AuthGate>
  );
}
