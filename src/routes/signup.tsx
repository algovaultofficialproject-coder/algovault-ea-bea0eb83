import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Mail, Lock, Phone, Eye, EyeOff, ArrowRight, Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { MentorAuthLayout, AuthField } from "@/components/MentorAuthLayout";
import { useServerFn } from "@tanstack/react-start";
import { registerMentor } from "@/lib/registration.functions";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Register as Mentor — Algo Vault EA" },
      { name: "description", content: "Create your Algo Vault EA mentor account." },
      { property: "og:title", content: "Mentor Registration — Algo Vault EA" },
      { property: "og:description", content: "Create your Algo Vault EA mentor account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignUp,
});

function SignUp() {
  const register = useServerFn(registerMentor);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checks = useMemo(() => ({
    len: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num: /\d/.test(pw),
    match: pw.length > 0 && pw === pw2,
  }), [pw, pw2]);
  const valid = Object.values(checks).every(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setErr(null); setBusy(true);
    try {
      const result = await register({ data: { email, password: pw, phone, redirectTo: window.location.origin } });
      if (result.session) {
        const { error } = await supabase.auth.setSession(result.session);
        if (error) throw error;
        await navigate({ to: "/dashboard" });
      } else {
        // No session means the address is already registered; sign in instead.
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) { setCreated(true); return; }
        await navigate({ to: "/dashboard" });
      }
    } catch (error) { setErr(error instanceof Error ? error.message : "Registration failed. Please try again."); }
    finally { setBusy(false); }
  }




  const eye = <Button type="button" variant="ghost" size="icon" aria-label={show ? "Hide password" : "Show password"} className="rounded-xl" onClick={() => setShow((v) => !v)}>{show ? <EyeOff /> : <Eye />}</Button>;

  return <MentorAuthLayout mode="signup" title="Become a mentor" subtitle="Your workspace is approved instantly." footer={<>Already registered? <Link to="/login" className="font-semibold text-foreground hover:text-primary">Sign in</Link></>}>
    {created ? <div role="status" className="text-center"><Check className="mx-auto size-8 text-primary mb-3" /><h2 className="text-xl font-bold">This email is already registered</h2><p className="mt-2 text-sm text-muted-foreground">Sign in with your password, or use “Forgot password” on the sign-in page.</p><Button asChild variant="glow" className="mt-5 h-12 rounded-2xl px-6"><Link to="/login">Go to sign in</Link></Button></div> : <form onSubmit={submit} className="space-y-3.5">
      <AuthField id="signup-email" label="Email address" icon={<Mail />} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
      <AuthField id="signup-phone" label="Contact number" icon={<Phone />} type="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Contact number (e.g. +27…)" />
      <AuthField id="signup-password" label="Password" icon={<Lock />} type={show ? "text" : "password"} autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Create a password" trailing={eye} />
      <AuthField id="signup-confirm" label="Confirm password" icon={<KeyRound />} type={show ? "text" : "password"} autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" />
      <ul aria-label="Password requirements" className="flex flex-wrap gap-1.5 pt-1 text-[11px]"><Req ok={checks.len} label="8+ characters" /><Req ok={checks.upper} label="Uppercase" /><Req ok={checks.lower} label="Lowercase" /><Req ok={checks.num} label="Number" /><Req ok={checks.match} label="Passwords match" /></ul>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <Button type="submit" variant="glow" disabled={!valid || busy} className="!mt-6 w-full h-14 rounded-2xl text-base font-semibold">{busy ? "Creating account…" : "Create mentor account"}<ArrowRight /></Button>
    </form>}
  </MentorAuthLayout>;
}

function Req({ ok, label }: { ok: boolean; label: string }) {
  return <li data-ok={ok} className="auth-check inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors"><Check className="size-3" />{label}</li>;
}
