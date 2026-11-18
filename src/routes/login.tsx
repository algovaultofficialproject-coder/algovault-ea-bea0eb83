import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { MentorAuthLayout, AuthField } from "@/components/MentorAuthLayout";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Algo Vault EA" },
      { name: "description", content: "Sign in to your Algo Vault EA mentor account." },
      { property: "og:title", content: "Mentor Sign In — Algo Vault EA" },
      { property: "og:description", content: "Sign in to your Algo Vault EA mentor account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setErr(error.message);
      return;
    }
    // Navigate immediately; AuthGate handles approval/admin checks on the destination.
    navigate({ to: "/dashboard" });
  }


  const eye = <Button variant="ghost" size="icon" type="button" aria-label={show ? "Hide password" : "Show password"} className="rounded-xl" onClick={() => setShow((v) => !v)}>{show ? <EyeOff /> : <Eye />}</Button>;

  return <MentorAuthLayout mode="signin" title="Welcome back" subtitle="Sign in to manage your bots and licences." footer={<>New to Algo Vault? <Link to="/signup" className="font-semibold text-foreground hover:text-primary">Create an account</Link></>}>
    <form onSubmit={handleSubmit} className="space-y-3.5">
      <AuthField id="login-email" label="Email address" icon={<Mail />} autoComplete="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" />
      <AuthField id="login-password" label="Password" icon={<Lock />} autoComplete="current-password" type={show ? "text" : "password"} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" trailing={eye} />
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <Button type="submit" variant="glow" disabled={busy} className="!mt-6 w-full h-14 rounded-2xl text-base font-semibold">{busy ? "Signing in…" : "Sign in"}<ArrowRight /></Button>
      <div className="pt-1 text-center"><Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-primary">Forgot password or returning mentor?</Link></div>
    </form>
  </MentorAuthLayout>;
}
