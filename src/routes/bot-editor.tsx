import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { EaManager } from "@/components/mentor/EaManager";

export const Route = createFileRoute("/bot-editor")({
  head: () => ({
    meta: [
      { title: "Bot Editor — Algo Vault EA" },
      { name: "description", content: "Manage your AlgoVault bot profile picture and trading symbols." },
      { property: "og:title", content: "Bot Editor — Algo Vault EA" },
      { property: "og:description", content: "Manage your AlgoVault bot artwork and trading symbols." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AuthGate><EaManager title="Bot Editor" /></AuthGate>),
});
