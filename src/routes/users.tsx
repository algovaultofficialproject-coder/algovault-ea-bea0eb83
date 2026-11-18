import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Check, Shield, X, KeyRound, Mail, Clock, Crown, Loader2, Copy } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { listAuthUsers, sendPasswordReset } from "@/lib/admin.functions";
import apkAsset from "@/assets/downloads/algo-thunder.apk.asset.json";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [
    { title: "User Administration — AlgoVault" },
    { name: "description", content: "Manage AlgoVault user approvals and account access." },
    { property: "og:title", content: "User Administration — AlgoVault" },
    { property: "og:description", content: "Manage AlgoVault user approvals and account access." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (<AuthGate adminOnly><UsersPage /></AuthGate>),
});

interface Row {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  approved: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

function UsersPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "approved">("pending");
  const [resetLink, setResetLink] = useState<{ email: string; link: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listFn = useServerFn(listAuthUsers);
  const resetFn = useServerFn(sendPasswordReset);

  async function load() {
    setLoading(true);
    try {
      const data = await listFn({ data: {} } as any);
      setRows(data as Row[]);
    } catch {
      const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      setRows(((data ?? []) as any[]).map((p) => ({ ...p, last_sign_in_at: null })) as Row[]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function setApproved(id: string, approved: boolean) {
    const row = rows.find((r) => r.id === id);
    await supabase.from("profiles").update({ approved }).eq("id", id);
    if (row?.email) {
      if (approved) {
        // Grant portal access: insert into activated_emails so AuthGate / EmailGate unlocks.
        await supabase.from("activated_emails").upsert(
          { email: row.email.toLowerCase(), approved: true, reactivation_pending: false } as never,
          { onConflict: "email" },
        );
      } else {
        await supabase.from("activated_emails").update({ approved: false } as never).eq("email", row.email.toLowerCase());
      }
    }
    load();
  }
  async function reset(email: string) {
    setBusyId(email);
    try {
      const r = await resetFn({ data: { email, origin: window.location.origin } } as any);
      setResetLink({ email, link: (r as any).link ?? "" });
    } catch (e: any) {
      alert(e.message || "Reset failed");
    } finally {
      setBusyId(null);
    }
  }

  const pending = rows.filter((r) => !r.approved);
  const approved = rows.filter((r) => r.approved);
  const visible = tab === "pending" ? pending : approved;

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <div className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-3xl" />
        <div className="relative px-6 py-10 max-w-5xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Shield className="size-3.5" /> Admin Console
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-bold tracking-tight">Mission Control</h1>
          <p className="mt-2 text-muted-foreground">Approve mentor registrations, audit activity, and manage credentials.</p>
          <div className="mt-6 grid grid-cols-3 gap-3 max-w-xl">
            <Stat label="Total" value={rows.length} />
            <Stat label="Pending" value={pending.length} accent />
            <Stat label="Approved" value={approved.length} />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="inline-flex rounded-full border border-border bg-card/60 p-1">
          {(["pending", "approved"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-semibold rounded-full capitalize ${tab === t ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground"}`}>
              {t} ({t === "pending" ? pending.length : approved.length})
            </button>
          ))}
        </div>

        {loading && <p className="mt-8 text-muted-foreground">Loading…</p>}

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {visible.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground col-span-2">Nothing here yet.</p>
          )}
          {visible.map((u) => (
            <article key={u.id} className="group rounded-2xl border border-border/60 bg-gradient-card p-5 shadow-card hover:border-primary/50 transition">
              <div className="flex items-start gap-3">
                <div className="size-12 rounded-xl bg-gradient-primary grid place-items-center text-primary-foreground font-bold text-lg shadow-glow">
                  {(u.full_name || u.email)[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate flex items-center gap-2">
                    {u.full_name || u.email.split("@")[0]}
                    {u.is_admin && <Crown className="size-4 text-primary" />}
                  </p>
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1"><Mail className="size-3" />{u.email}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="size-3" />
                    {u.last_sign_in_at ? `Last seen ${new Date(u.last_sign_in_at).toLocaleString()}` : "Never signed in"}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {!u.approved && (
                  <Button size="sm" onClick={() => setApproved(u.id, true)} className="bg-gradient-primary gap-1">
                    <Check className="size-4" /> Approve
                  </Button>
                )}
                {u.approved && !u.is_admin && (
                  <Button size="sm" variant="outline" onClick={() => setApproved(u.id, false)} className="gap-1">
                    <X className="size-4" /> Revoke
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={busyId === u.email} onClick={() => reset(u.email)} className="gap-1">
                  {busyId === u.email ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Reset Password
                </Button>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm">
          <p className="font-semibold text-amber-200">About passwords</p>
          <p className="mt-1 text-muted-foreground">
            Passwords are stored as one-way hashes and cannot be displayed — not even to admins.
            Use <strong>Reset Password</strong> to send the user a secure recovery link.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-primary/30 bg-card/60 p-5 text-sm">
          <p className="font-semibold text-primary">Admin downloads</p>
          <p className="mt-1 text-muted-foreground">
            Distribute the hidden execution engine + signal EAs to mentors. End-users never see these on the marketing site.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {[
              { href: apkAsset.url, label: "MT4 Engine APK (hidden executor)" },
              { href: "/downloads/Selfhost-Algohost.ex5", label: "Selfhost-Algohost.ex5" },
              { href: "/downloads/Self_Host_EA_Merge.ex5", label: "Self_Host_EA_Merge.ex5" },
              { href: "/downloads/Self_Host_EA_Merge_v2.ex5", label: "Self_Host_EA_Merge v2.ex5" },
            ].map((d) => (
              <a key={d.href} href={d.href} download className="rounded-xl border border-border bg-background/40 px-4 py-3 hover:border-primary/50 transition">
                {d.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {resetLink && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setResetLink(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-card border border-primary/40 p-6 shadow-glow">
            <h3 className="font-display text-xl font-bold">Reset link generated</h3>
            <p className="mt-1 text-sm text-muted-foreground">Share this link with {resetLink.email}. It opens the password reset flow.</p>
            <div className="mt-4 rounded-xl bg-background/60 border border-border p-3 break-all text-xs font-mono">
              {resetLink.link || "(no link returned)"}
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="outline" onClick={() => resetLink.link && navigator.clipboard.writeText(resetLink.link)} className="gap-1"><Copy className="size-4" /> Copy</Button>
              <Button onClick={() => setResetLink(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-primary/50 bg-primary/10 shadow-glow" : "border-border bg-card/60"}`}>
      <div className="text-2xl font-bold font-display">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
