import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useState } from "react";
import { Menu, Zap, Trash2, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MentorSidebar } from "@/components/MentorSidebar";
import { usePortalStore, portalActions } from "@/lib/portal-store";

export const Route = createFileRoute("/activate")({
  head: () => ({
    meta: [
      { title: "Activate Mentor IDs — Algo Vault EA" },
      { property: "og:title", content: "Activate Mentor IDs — Algo Vault EA" },
      { property: "og:description", content: "Manage mentor IDs and client access to AlgoVault." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Create mentor IDs and emails that authorize users to access the Algo Vault EA app." },
    ],
  }),
  component: () => (<AuthGate><ActivatePage /></AuthGate>),
});

function ActivatePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mentorId, setMentorId] = useState("");
  const [email, setEmail] = useState("");
  const [ok, setOk] = useState(false);
  const { mentorAccounts } = usePortalStore();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mentorId.trim() || !email.trim()) return;
    portalActions.addMentorAccount(mentorId.trim(), email);
    setMentorId(""); setEmail("");
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  }

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button onClick={() => setMenuOpen(true)} className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center"><Menu className="size-5" /></button>
        <span className="font-display font-bold tracking-wider">EA CONVERTER LOGIN</span>
        <span className="size-11" />
      </header>

      <main className="px-5 pt-6 pb-16 space-y-6 max-w-md mx-auto">
        <section className="rounded-3xl border border-primary/40 bg-gradient-to-b from-card to-background p-6 shadow-glow text-center">
          <div className="mx-auto size-20 rounded-2xl bg-gradient-primary grid place-items-center shadow-glow mb-4">
            <Zap className="size-9 text-primary-foreground" fill="currentColor" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-wide">EA Converter Login</h1>
          <p className="mt-2 text-sm text-muted-foreground">Issue Mentor IDs that users will use to sign into the Algo Vault EA app.</p>

          <form onSubmit={submit} className="mt-6 space-y-3 text-left">
            <div>
              <label className="text-xs font-bold tracking-wider uppercase text-muted-foreground">Mentor ID</label>
              <Input value={mentorId} onChange={(e) => setMentorId(e.target.value)} placeholder="e.g. MENTOR-001" className="mt-2 h-12 rounded-xl bg-background/60 border-border" />
            </div>
            <div>
              <label className="text-xs font-bold tracking-wider uppercase text-muted-foreground">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="user@email.com" className="mt-2 h-12 rounded-xl bg-background/60 border-border" />
            </div>
            <Button type="submit" className="w-full h-12 rounded-xl bg-gradient-primary shadow-glow font-semibold">
              <Plus className="size-4 mr-2" /> Proceed
            </Button>
            {ok && <p className="text-sm text-green-400 text-center flex items-center justify-center gap-1"><Check className="size-4" /> Mentor login issued</p>}
          </form>
        </section>

        <section className="rounded-3xl border border-border bg-gradient-card p-5">
          <h2 className="font-display text-lg font-bold mb-3">Issued Logins</h2>
          {mentorAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No mentor logins yet.</p>
          ) : (
            <ul className="space-y-2">
              {mentorAccounts.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{m.mentorId}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full ${m.active ? "bg-green-500/15 text-green-400" : "bg-muted text-muted-foreground"}`}>{m.active ? "Active" : "Inactive"}</span>
                    <button onClick={() => portalActions.removeMentorAccount(m.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Link to="/ios" className="block text-center text-sm text-primary underline">Preview Algo Vault EA app →</Link>
      </main>
    </div>
  );
}
