import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { FundamentalsPanel, calendarQuery } from "@/components/trading/FundamentalsPanel";

export const Route = createFileRoute("/fundamentals")({
  head: () => ({
    meta: [
      { title: "Fundamentals & Market News — Algo Vault EA" },
      { name: "description", content: "This week's economic calendar: upcoming and passed market news, forecasts and previous figures." },
      { property: "og:title", content: "Fundamentals & Market News — Algo Vault EA" },
      { property: "og:description", content: "Upcoming and passed market events with forecasts, previous figures and live countdowns." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(calendarQuery),
  component: FundamentalsPage,
});

function FundamentalsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[480px] mx-auto">
        <div className="px-4 pt-4">
          <Link to="/ios" search={{ email: undefined, mentorId: undefined }} aria-label="Back to the app" className="size-10 grid place-items-center rounded-full bg-card border border-border">
            <ArrowLeft className="size-5" />
          </Link>
        </div>
        <FundamentalsPanel />
      </div>
    </div>
  );
}
