import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useState } from "react";
import { Menu, Calendar, Key, KeyRound, Zap, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MentorSidebar } from "@/components/MentorSidebar";
import { usePortalStore, portalActions } from "@/lib/portal-store";
import { useServerFn } from "@tanstack/react-start";
import { publishLicense } from "@/lib/licenses.functions";
import { LicenseGeneratedResult, type GeneratedLicenseResult } from "@/components/LicenseGeneratedResult";

export const Route = createFileRoute("/generate-key")({
  head: () => ({
    meta: [
      { title: "Generate License Key — Algo Vault EA Mentor" },
      { property: "og:title", content: "Generate Licence Keys — Algo Vault EA" },
      { property: "og:description", content: "Issue AlgoVault bot licence keys for your clients." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content: "Generate licence keys for your MT4/MT5 Expert Advisors.",
      },
    ],
  }),
  component: () => (<AuthGate><GenerateKey /></AuthGate>),
});


const DURATIONS = [
  { id: "3d", value: "3", unit: "DAYS" },
  { id: "5d", value: "5", unit: "DAYS" },
  { id: "30d", value: "30", unit: "DAYS" },
  { id: "3m", value: "3", unit: "MONTHS" },
  { id: "6m", value: "6", unit: "MONTHS" },
  { id: "1y", value: "1", unit: "YEAR" },
  { id: "lifetime", value: "∞", unit: "LIFETIME" },
];

function durationLabel(d: (typeof DURATIONS)[number]) {
  if (d.id === "lifetime") return "Lifetime";
  const unit = d.unit.charAt(0) + d.unit.slice(1).toLowerCase();
  return `${d.value} ${d.value === "1" ? unit.replace(/s$/, "") : unit.endsWith("s") ? unit : `${unit}s`}`;
}

function GenerateKey() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userName, setUserName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [ea, setEa] = useState("");
  const [duration, setDuration] = useState("30d");
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<GeneratedLicenseResult | null>(null);
  const { eas, licenses } = usePortalStore();
  const publish = useServerFn(publishLicense);


  const canSubmit = userName.trim() && ea && duration && confirmed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const d = DURATIONS.find((x) => x.id === duration);
    const bot = eas.find((x) => x.name === ea);
    if (!d || !bot || result?.status === "pending") return;
    const license = portalActions.addLicense({
      userName: userName.trim(),
      ea,
      duration: `${d.value} ${d.unit}`,
    });
    // Push to the cloud so the client can redeem it on any device, logged in or not.
    const recipient = clientEmail.trim();
    setResult({ key: license.key, image: bot.image ?? null, botName: bot.name, email: recipient, duration: d.id === "lifetime" ? "Lifetime" : `${d.value} ${d.unit.toLowerCase()}`, status: "pending" });
    if (bot) {
      publish({
        data: {
          key: license.key,
          userName: license.userName,
          duration: license.duration,
          clientEmail: clientEmail.trim() || null,
          ea: {
            id: bot.id,
            name: bot.name,
            image: bot.image ?? null,
            backgroundVideo: bot.backgroundVideo ?? null,
            symbols: bot.symbols ?? [],
          },
        },
      })
        .then((r) => setResult((current) => current?.key === license.key ? { ...current, status: recipient ? (r.emailed ? "sent" : "email-failed") : "not-requested" } : current))
        .catch(() => setResult((current) => current?.key === license.key ? { ...current, status: "sync-failed" } : current));
    }
    setUserName("");
    setClientEmail("");
    setEa("");
    setDuration("30d");
    setConfirmed(false);
  };



  return (
    <div className={`min-h-screen bg-background bg-hero-glow ${result ? "license-result-page" : ""}`}>
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button
          onClick={() => setMenuOpen(true)}
          className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <button className="size-11 rounded-xl border border-primary/40 bg-card/60 grid place-items-center text-primary">
          <Calendar className="size-5" />
        </button>
      </header>

      {result ? <main className="mx-auto max-w-md px-4 pb-16 pt-6"><LicenseGeneratedResult result={result} total={licenses.length} onAnother={() => setResult(null)} /></main> : <main className="px-4 pt-6 pb-16 max-w-md mx-auto">
        <form onSubmit={handleSubmit} className="rounded-[2rem] border border-border bg-gradient-card px-5 pb-7 pt-8 shadow-card">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-3xl border border-primary/30 bg-primary/10 text-primary shadow-glow">
              <KeyRound className="size-9" strokeWidth={2.4} />
            </span>
            <h1 className="mt-5 font-display text-3xl font-bold">Generate License</h1>
            <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Create a new licence key</p>
          </div>

          <div className="mt-7 space-y-3">
            <Input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Client name" aria-label="Client name" className="h-13 rounded-2xl border-border bg-background/50 px-4 text-base" />
            <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="Client email (optional — key is sent here)" aria-label="Client email" className="h-13 rounded-2xl border-border bg-background/50 px-4 text-base" />
            <Select value={ea} onValueChange={setEa}>
              <SelectTrigger aria-label="Select an EA" className="h-13 rounded-2xl border-border bg-background/50 px-4 text-base">
                <SelectValue placeholder="Select an EA" />
              </SelectTrigger>
              <SelectContent>
                {eas.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="mt-6 mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-3.5" /> Duration
          </p>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => {
              const selected = duration === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDuration(d.id)}
                  aria-pressed={selected}
                  className={`rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition ${
                    selected ? "border-primary bg-primary text-primary-foreground shadow-glow" : "border-border bg-background/50 hover:border-primary/40"
                  }`}
                >
                  {durationLabel(d)}
                </button>
              );
            })}
          </div>

          <label className="mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border border-border bg-background/50 px-4 py-3">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
            <span className="text-sm">I confirm I want to generate this key</span>
          </label>

          <Button type="submit" disabled={!canSubmit} className="mt-5 h-14 w-full gap-2 rounded-2xl bg-primary text-base font-semibold shadow-glow hover:bg-primary/90 disabled:opacity-50 disabled:shadow-none">
            <Key className="size-5" />
            Generate Key
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Total keys generated: <span className="font-bold text-foreground">{licenses.length}</span>
          </p>
        </form>

        <Footer />
      </main>}
    </div>
  );
}

function Footer() {
  return (
    <div className="pt-6 flex flex-col items-center gap-3 text-center">
      <div className="flex items-center gap-2 font-display font-semibold">
        <Zap className="size-4 text-primary" fill="currentColor" />
        Algo <span className="text-primary">Vault</span> EA
      </div>
      <p className="text-sm text-muted-foreground">© 2026 All rights reserved.</p>
    </div>
  );
}
