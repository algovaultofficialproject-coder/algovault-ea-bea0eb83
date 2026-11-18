import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { ReactivatePage } from "./reactivate";

// /ndmemail shows the same reactivation page as /reactivate (days of access, email list, remove).
export const Route = createFileRoute("/ndmemail")({
  head: () => ({
    meta: [
      { title: "Reactivate Email — Algo Vault EA" },
      { property: "og:title", content: "Client Email Approval — Algo Vault EA" },
      { property: "og:description", content: "Approve client email access to the AlgoVault trading app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Approve a client email for Algo Vault EA mobile access for a set number of days." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: () => (<AuthGate><ReactivatePage /></AuthGate>),
});
