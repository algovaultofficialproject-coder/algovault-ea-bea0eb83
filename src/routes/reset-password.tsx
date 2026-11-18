import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { MentorAuthLayout } from "@/components/MentorAuthLayout";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Choose a new password — Algo Vault EA" },
      { name: "description", content: "Choose a new password for your Algo Vault EA mentor account." },
      { property: "og:title", content: "Choose a new password — Algo Vault EA" },
      { property: "og:description", content: "Choose a new password for your Algo Vault EA mentor account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

const strong = (pw: string) => pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);

function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!strong(pw)) { setErr("Use at least 8 characters with an uppercase letter, a lowercase letter and a number."); return; }
    if (pw !== confirm) { setErr("Passwords do not match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    navigate({ to: "/dashboard" });
  }

  return <MentorAuthLayout title="Choose a new password." subtitle="This replaces any previous password on your account." footer={<>Link expired? <Link to="/forgot-password" className="text-primary font-semibold">Send a new one <ArrowRight className="inline size-4" /></Link></>}>
    {!ready ? (
      <p className="text-sm text-muted-foreground">Open this page from the link in your email to continue.</p>
    ) : (
      <form onSubmit={submit} className="space-y-5">
        <div><label htmlFor="reset-password" className="text-sm font-medium">New password</label><div className="relative mt-2"><Lock className="absolute left-3 top-4 size-4 text-muted-foreground" /><Input id="reset-password" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} className="h-12 rounded-lg pl-10 bg-input" /></div></div>
        <div><label htmlFor="reset-confirm" className="text-sm font-medium">Confirm password</label><Input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-2 h-12 rounded-lg bg-input" /></div>
        {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full h-12 rounded-lg font-semibold">{busy ? "Saving…" : "Save password"}<ArrowRight className="size-4" /></Button>
      </form>
    )}
  </MentorAuthLayout>;
}
