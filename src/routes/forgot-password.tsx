import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { MentorAuthLayout } from "@/components/MentorAuthLayout";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Set or reset your password — Algo Vault EA" },
      { name: "description", content: "Verify your email to set a new Algo Vault EA mentor password." },
      { property: "og:title", content: "Set or reset your password — Algo Vault EA" },
      { property: "og:description", content: "Verify your email to set a new Algo Vault EA mentor password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setSent(true);
  }

  return <MentorAuthLayout title="Set a new password." subtitle="Returning mentor? Confirm your email and choose a new password." footer={<>Remembered it? <Link to="/login" className="text-primary font-semibold">Sign in <ArrowRight className="inline size-4" /></Link></>}>
    {sent ? (
      <p role="status" className="text-sm">If an account exists for <strong>{email}</strong>, a link to set your password is on its way. Check your inbox and spam folder.</p>
    ) : (
      <form onSubmit={submit} className="space-y-5">
        <div><label htmlFor="forgot-email" className="text-sm font-medium">Email address</label><div className="relative mt-2"><Mail className="absolute left-3 top-4 size-4 text-muted-foreground" /><Input id="forgot-email" autoComplete="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-12 rounded-lg pl-10 bg-input" /></div></div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full h-12 rounded-lg font-semibold">{busy ? "Sending…" : "Email me a link"}<ArrowRight className="size-4" /></Button>
      </form>
    )}
  </MentorAuthLayout>;
}
