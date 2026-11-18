import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Calendar, ShieldCheck, UserRound, Key, UserCheck, Bot, Infinity as InfinityIcon, Zap } from "lucide-react";
import { MentorSidebar } from "@/components/MentorSidebar";
import { AuthGate } from "@/components/AuthGate";
import { usePortalStore } from "@/lib/portal-store";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Algo Vault EA Mentor" },
      { property: "og:title", content: "Mentor Overview — Algo Vault EA" },
      { property: "og:description", content: "Monitor your AlgoVault licences, bots and subscriptions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Mentor dashboard: monitor licences, EAs, and active subscriptions." },
    ],
  }),
  component: () => (
    <AuthGate>
      <Dashboard />
    </AuthGate>
  ),
});

function Dashboard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { eas, licenses, maxLicenses } = usePortalStore();
  const { profile } = useAuth();
  const totalLicences = licenses.length;
  const activeSubs = licenses.filter((l) => l.active).length;
  const totalEAs = eas.length;

  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button
          onClick={() => setMenuOpen(true)}
          className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center hover:bg-card transition"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <button className="size-11 rounded-xl border border-primary/40 bg-card/60 grid place-items-center text-primary">
          <Calendar className="size-5" />
        </button>
      </header>

      <main className="px-5 pt-6 pb-16 space-y-6 max-w-md mx-auto">
        {/* Status pill */}
        <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-semibold text-green-400">
          <span className="size-2 rounded-full bg-green-400" />
          All systems running smoothly
        </div>

        {/* Date pill */}
        <div className="inline-flex items-center gap-3 rounded-2xl border border-border bg-card/40 px-4 py-3 text-sm">
          <Calendar className="size-4 text-primary" />
          Today — {today}
        </div>

        <div className="h-px bg-border/60" />

        {/* Welcome card */}
        <section className="rounded-3xl border border-border bg-gradient-card p-8 text-center shadow-card">
          <div className="mx-auto size-20 rounded-2xl border border-primary/40 bg-primary/10 grid place-items-center">
            <ShieldCheck className="size-10 text-primary" />
          </div>
          <h2 className="mt-6 font-display text-3xl font-bold">Welcome back!</h2>
          <p className="mt-3 text-muted-foreground">
            You have <span className="font-bold text-primary">{activeSubs} active licence{activeSubs === 1 ? "" : "s"}</span>
            <br />
            running on your account.
          </p>
          <button className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2 text-sm font-medium text-primary">
            <UserRound className="size-4" />
            Mentor ID: {profile?.mentor_code ?? "…"}
          </button>
        </section>

        {/* Stat cards */}
        <StatCard
          label="Total Licences"
          value={String(totalLicences)}
          sub="All time EA users"
          icon={Key}
          tone="red"
        />
        <StatCard
          label="Active Subscriptions"
          value={String(activeSubs)}
          sub="Current active EA users"
          icon={UserCheck}
          tone="green"
        />
        <StatCard
          label="Total EAs"
          value={String(totalEAs)}
          sub="EAs you are licencing"
          icon={Bot}
          tone="blue"
        />
        <StatCard
          label="Maximum Licences"
          value={String(maxLicenses)}
          sub="Total licences you can generate"
          icon={InfinityIcon}
          tone="red"
        />


        {/* Footer */}
        <div className="pt-6 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 font-display font-semibold">
            <Zap className="size-4 text-primary" fill="currentColor" />
            Algo <span className="text-primary">Vault</span> EA
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-xs font-semibold text-green-400">
            <span className="size-2 rounded-full bg-green-400" />
            Systems Online
          </div>
        </div>
      </main>
    </div>
  );
}

const tones = {
  red: "from-primary/30 via-primary/10 to-transparent border-primary/40",
  green: "from-green-700/40 via-green-900/20 to-transparent border-green-700/40",
  blue: "from-blue-800/40 via-blue-950/30 to-transparent border-blue-800/40",
};

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof tones;
}) {
  return (
    <section
      className={`relative rounded-3xl border bg-gradient-to-br ${tones[tone]} p-6 shadow-card overflow-hidden`}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-bold uppercase tracking-wider text-foreground/90">{label}</p>
        <div className="size-12 rounded-xl bg-background/40 border border-white/10 grid place-items-center">
          <Icon className="size-6 text-foreground/90" />
        </div>
      </div>
      <p className="mt-4 font-display text-5xl font-bold">{value}</p>
      <p className="mt-3 text-sm text-muted-foreground">{sub}</p>
    </section>
  );
}
