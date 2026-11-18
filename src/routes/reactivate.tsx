import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useCallback, useEffect, useState } from "react";
import { Menu, Check, Smartphone, Trash2, Clock, Loader2, RotateCcw } from "lucide-react";
import { accessExpired, accessUntilFromDays, daysLeft } from "@/lib/app-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { MentorSidebar } from "@/components/MentorSidebar";
import { portalActions, usePortalStore } from "@/lib/portal-store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reactivate")({
  head: () => ({
    meta: [
      { title: "Restore Client Access — AlgoVault" },
      { name: "description", content: "Restore a client email's access to the AlgoVault app." },
      { property: "og:title", content: "Restore Client Access — AlgoVault" },
      { property: "og:description", content: "Restore client email access to AlgoVault." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AuthGate><ReactivatePage /></AuthGate>),
});

type AccessRow = { email: string; approved: boolean; access_until: string | null; session_id: string | null; used_at: string | null };

export function ReactivatePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("30");
  const [confirm, setConfirm] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { reactivatedEmails } = usePortalStore();
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAccess = useCallback(async () => {
    const { data } = await supabase
      .from("activated_emails")
      .select("email, approved, access_until, session_id, used_at")
      .or("approved.eq.true,session_id.not.is.null")
      .order("email");
    setRows((data ?? []) as AccessRow[]);
  }, []);
  useEffect(() => { void loadAccess(); }, [loadAccess]);

  async function removeAccess(target: string) {
    if (!window.confirm(`Remove ${target}? Their phone is signed out of the trading app within a minute.`)) return;
    setBusy(target);
    const { error } = await supabase.from("activated_emails")
      .update({ approved: false, session_id: null, access_until: null, reactivation_pending: false })
      .eq("email", target);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    void loadAccess();
  }

  async function removeAllPhones() {
    if (!window.confirm("Sign every phone out of the trading app? Each client must be reactivated to sign in again.")) return;
    setBusy("*");
    const { error } = await supabase.from("activated_emails")
      .update({ approved: false, session_id: null, reactivation_pending: false })
      .neq("email", "");
    setBusy(null);
    if (error) { setErr(error.message); return; }
    void loadAccess();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email.trim() || !confirm) return;
    const e2 = email.trim().toLowerCase();
    const life = days === "life";
    const n = Number(days);
    if (!life && (!Number.isFinite(n) || n < 1)) { setErr("Enter how many days (1 or more)."); return; }
    const { error } = await supabase.from("activated_emails").upsert(
      { email: e2, approved: true, reactivation_pending: false, used_at: null, access_until: life ? null : accessUntilFromDays(n, Date.now()) },
      { onConflict: "email" },
    );
    if (error) { setErr(error.message); return; }
    portalActions.reactivateEmail(e2);
    setEmail(""); setConfirm(false); setOk(true);
    void loadAccess();
    setTimeout(() => setOk(false), 1800);
  }

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button onClick={() => setMenuOpen(true)} className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center"><Menu className="size-5" /></button>
        <span className="font-display font-bold tracking-wider">REACTIVATE EMAIL</span>
        <span className="size-11" />
      </header>

      <main className="px-5 pt-6 pb-16 max-w-md mx-auto">
        <section className="rounded-2xl bg-white text-neutral-800 p-6 shadow-card">
          <h2 className="font-bold tracking-wider uppercase text-sm">Reactivate Email Address</h2>
          <p className="mt-2 text-sm text-neutral-600">Enter the Email you want to reactivate</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="User Email"
              className="h-12 rounded-xl border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400"
            />
            <div>
              <label htmlFor="access-days" className="text-xs font-bold uppercase tracking-wider text-neutral-500">Access for how many days</label>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  id="access-days"
                  value={days === "life" ? "Lifetime" : days}
                  onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
                  inputMode="numeric"
                  placeholder="Days"
                  className="h-12 w-28 rounded-xl border-neutral-300 bg-white text-neutral-900"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {[7, 14, 30, 90].map((d) => (
                    <button key={d} type="button" onClick={() => setDays(String(d))}
                      className={`h-9 px-3 rounded-full text-xs font-bold border ${days === String(d) ? "bg-emerald-500 text-white border-emerald-500" : "border-neutral-300 text-neutral-600"}`}>{d}d</button>
                  ))}
                  <button type="button" onClick={() => setDays("life")}
                    className={`h-9 px-3 rounded-full text-xs font-bold border ${days === "life" ? "bg-emerald-500 text-white border-emerald-500" : "border-neutral-300 text-neutral-600"}`}>Lifetime</button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-neutral-500">{days === "life" ? "Lifetime access — the email never expires." : "After these days the email is removed from the trading app automatically."}</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} /> I confirm
            </label>
            <Button
              type="submit"
              disabled={!email.trim() || !confirm || !days}
              className="rounded-xl px-6 text-white font-semibold"
              style={{ background: "linear-gradient(180deg,#34d3a0,#22b58a)" }}
            >
              Re-Activate
            </Button>
            {ok && <p className="text-sm text-emerald-600 flex items-center gap-1"><Check className="size-4" /> Email reactivated</p>}
            {err && <p className="text-sm text-destructive">{err}</p>}
          </form>
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-gradient-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold">Emails with access</h3>
            {rows === null && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Remove an email to take away its access and sign its phone out.</p>
          <ul className="mt-4 space-y-2">
            {rows?.length === 0 && <li className="text-sm text-muted-foreground">No emails have access right now.</li>}
            {rows?.map((r) => {
              const now = Date.now();
              const expired = accessExpired(r.access_until, now);
              const left = daysLeft(r.access_until, now);
              return (
                <li key={r.email} className="rounded-2xl border border-border bg-card/60 p-3 flex items-center gap-3">
                  <span className={`size-9 shrink-0 rounded-full grid place-items-center ${r.session_id && !expired ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Smartphone className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{r.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full bg-muted px-2 py-0.5">{expired ? "Expired" : r.session_id ? "Phone connected" : "Waiting to sign in"}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 flex items-center gap-1"><Clock className="size-3" />{left === null ? "No time limit" : expired ? "0 days left" : `${left} day${left === 1 ? "" : "s"} left`}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="destructive" className="rounded-full" disabled={busy !== null} onClick={() => removeAccess(r.email)} aria-label={`Remove ${r.email}`}>
                    {busy === r.email ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button variant="outline" className="mt-4 w-full rounded-full" disabled={busy !== null} onClick={removeAllPhones}>
            {busy === "*" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}Sign out every phone
          </Button>
        </section>

        {reactivatedEmails.length > 0 && (
          <section className="mt-6 rounded-3xl border border-border bg-gradient-card p-5">
            <h3 className="font-display text-lg font-bold mb-2">Recently Reactivated</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              {reactivatedEmails.map((e) => <li key={e}>• {e}</li>)}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
