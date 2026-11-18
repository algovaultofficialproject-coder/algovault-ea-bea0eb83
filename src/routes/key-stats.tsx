import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Menu, LineChart, KeyRound, CheckCircle2, CalendarDays, Users, Plus, Bot, Clock } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { MentorSidebar } from "@/components/MentorSidebar";
import { usePortalStore } from "@/lib/portal-store";
import { durationName, keyStats } from "@/lib/key-stats";

export const Route = createFileRoute("/key-stats")({
  head: () => ({
    meta: [
      { title: "Key Stats — Algo Vault EA Mentor" },
      { name: "description", content: "See how many licence keys you've issued, which bots sell most and recent activity." },
      { property: "og:title", content: "Key Stats — Algo Vault EA" },
      { property: "og:description", content: "Licence key statistics for AlgoVault mentors." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AuthGate><KeyStats /></AuthGate>),
});

function KeyStats() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { licenses } = usePortalStore();
  const s = useMemo(() => keyStats(licenses), [licenses]);
  const peak = Math.max(1, ...s.days.map((d) => d.count));
  const activePct = s.total ? Math.round((s.active / s.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/40 bg-background/70 px-5 py-4 backdrop-blur-xl">
        <button onClick={() => setMenuOpen(true)} className="grid size-11 place-items-center rounded-xl border border-border bg-card/60" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Link to="/generate-key" className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow">
          <Plus className="size-4" /> New key
        </Link>
      </header>

      <main className="mx-auto max-w-md space-y-5 px-4 pb-16 pt-6">
        <section className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-glow">
            <LineChart className="size-6" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight">Key Stats</h1>
            <p className="text-sm text-muted-foreground">Your licence keys at a glance</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Tile icon={KeyRound} label="Total keys" value={s.total} />
          <Tile icon={CheckCircle2} label="Active" value={s.active} hint={`${activePct}% of keys`} />
          <Tile icon={CalendarDays} label="This month" value={s.thisMonth} hint={`${s.today} today`} />
          <Tile icon={Users} label="Clients" value={s.clients} />
        </section>

        <Card title="Last 7 days" right={`${s.last7} keys`}>
          <div className="flex h-36 items-end gap-2">
            {s.days.map((d) => (
              <div key={d.start} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">{d.count || ""}</span>
                <div className="flex h-24 w-full items-end">
                  <div className="w-full rounded-t-lg bg-primary/80" style={{ height: `${Math.max(4, (d.count / peak) * 100)}%`, opacity: d.count ? 1 : 0.25 }} />
                </div>
                <span className="text-[11px] text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Keys by bot" icon={Bot}>
          <Bars rows={s.byEa} total={s.total} empty="No keys yet" />
        </Card>

        <Card title="Keys by duration" icon={Clock}>
          <Bars rows={s.byDuration} total={s.total} empty="No keys yet" />
        </Card>

        <Card title="Recent keys">
          {s.recent.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground">You haven't generated any keys yet.</p>
              <Link to="/generate-key" className="mt-3 inline-block text-sm font-semibold text-primary">Generate your first key →</Link>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {s.recent.map((k) => (
                <li key={k.key} className="flex items-center gap-3 py-3">
                  <span className={`size-2 shrink-0 rounded-full ${k.active ? "bg-primary" : "bg-muted-foreground/40"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{k.userName || "Client"}</p>
                    <p className="truncate text-xs text-muted-foreground">{k.ea} · {durationName(k.duration)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(k.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}

function Tile({ icon: Icon, label, value, hint }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-3xl border border-border bg-gradient-card p-4 shadow-card">
      <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span>
      <p className="mt-3 font-display text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Card({ title, right, icon: Icon, children }: { title: string; right?: string; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-gradient-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-base font-bold">{Icon && <Icon className="size-4 text-primary" />}{title}</h2>
        {right && <span className="text-xs font-semibold text-muted-foreground">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Bars({ rows, total, empty }: { rows: { label: string; count: number }[]; total: number; empty: string }) {
  if (!rows.length) return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-sm"><span className="truncate pr-2 font-medium">{r.label}</span><span className="text-muted-foreground">{r.count}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(r.count / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
