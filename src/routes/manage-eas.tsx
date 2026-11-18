import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { EaManager } from "@/components/mentor/EaManager";

export const Route = createFileRoute("/manage-eas")({
  head: () => ({
    meta: [
      { title: "Manage EAs — Algo Vault EA Mentor" },
      { name: "description", content: "Manage your mentor bot and its licences." },
      { property: "og:title", content: "Manage Your Bot — Algo Vault EA" },
      { property: "og:description", content: "Manage your mentor bot and its licences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AuthGate><EaManager title="Manage EAs" /></AuthGate>),
});
