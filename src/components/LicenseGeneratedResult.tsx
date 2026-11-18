import { useState } from "react";
import { ArrowLeft, Check, Copy, KeyRound, Loader2, Mail, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GeneratedLicenseResult {
  key: string;
  image: string | null;
  botName: string;
  email: string;
  duration: string;
  status: "pending" | "sent" | "not-requested" | "email-failed" | "sync-failed";
}

const STATUS_TEXT: Record<GeneratedLicenseResult["status"], string> = {
  pending: "Saving licence…",
  sent: "Emailed to client",
  "not-requested": "No client email provided",
  "email-failed": "Created · email not sent",
  "sync-failed": "Cloud sync failed · key saved locally",
};

/** "Key created" card. Always light, whatever the site theme. */
export function LicenseGeneratedResult({ result, total, onAnother }: { result: GeneratedLicenseResult; total: number; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.key);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { setCopyError(true); }
  }
  const pending = result.status === "pending";
  const pill = "rounded-full border border-primary/70 bg-secondary px-5 py-2.5 text-base text-muted-foreground";
  return <section className="license-result relative rounded-[2rem] border border-border bg-card px-6 pb-8 pt-6 shadow-card" aria-label="Generated licence">
    <button type="button" onClick={onAnother} disabled={pending} aria-label="Back to the licence form" className="grid size-11 place-items-center rounded-full border border-border bg-secondary text-muted-foreground disabled:opacity-50">
      <ArrowLeft className="size-5" />
    </button>
    <div className="-mt-4 flex flex-col items-center text-center">
      <span className="license-key-tile grid size-24 place-items-center rounded-3xl bg-primary/10 text-primary">
        <KeyRound className="size-11" strokeWidth={2.4} />
      </span>
      <h1 className="mt-6 font-display text-3xl font-bold text-foreground">Generate License</h1>
      <p className="mt-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">Key created</p>
    </div>
    <div className="mt-8 flex items-center gap-3 rounded-full border border-primary bg-secondary py-3 pl-6 pr-3">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-base tracking-[0.08em] sm:text-lg text-foreground" aria-label="Licence key">{result.key}</code>
      <Button variant="ghost" size="icon" onClick={copy} aria-label={copied ? "Key copied" : "Copy licence key"} title={copied ? "Copied" : "Copy licence key"} className="shrink-0 text-muted-foreground hover:text-primary">{copied ? <Check className="size-6" /> : <Copy className="size-6" />}</Button>
    </div>
    {copyError && <p role="alert" className="mt-2 text-center text-sm text-muted-foreground">Could not copy. Select the key to copy it.</p>}
    <div className="mt-4 flex flex-wrap justify-center gap-3 text-center">
      {result.email && <p className={`${pill} max-w-full break-all`}>{result.email}</p>}
      <div className="flex w-full flex-wrap justify-center gap-3">
        <p className={pill}>{result.duration}</p>
        <p className={`${pill} max-w-full break-words`}>{result.botName}</p>
      </div>
    </div>
    <p role="status" aria-live="polite" className="mt-5 flex items-center justify-center gap-2 text-center text-base text-primary">
      {pending ? <Loader2 className="size-5 shrink-0 animate-spin" /> : result.status === "sent" ? <Mail className="size-5 shrink-0" /> : <MailWarning className="size-5 shrink-0" />}{STATUS_TEXT[result.status]}
    </p>
    <Button onClick={onAnother} disabled={pending} className="license-another mt-8 h-auto min-h-16 w-full whitespace-normal rounded-2xl px-6 py-4 text-xl font-bold text-primary-foreground">Generate Another License</Button>
    <p className="mt-10 text-center text-base text-muted-foreground">Total keys generated: <span className="font-bold text-foreground">{total}</span></p>
  </section>;
}
