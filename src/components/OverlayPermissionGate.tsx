import { useEffect, useState } from "react";
import { Layers, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { overlayActions, useNativeOverlay } from "@/lib/native-overlay";
import botLogo from "@/assets/bot-logo.jpg";

const STEPS = [
  { title: "Tap the button below", text: "Android opens the \"Display over other apps\" page." },
  { title: "Switch AlgoVault on", text: "Turn on \"Allow display over other apps\" for AlgoVault." },
  { title: "Come back here", text: "AlgoVault continues to sign in by itself." },
];

/**
 * Android app only: a required first page. Users must allow "Display over other apps" before the
 * mentor ID / email entry, so the bot circle and its Trade Log can float while the bot runs.
 * Display permission only — it never reads other apps or places trades.
 */
export function OverlayPermissionGate() {
  const o = useNativeOverlay();
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    // Re-check whenever the user returns from Android settings.
    const onShow = () => { if (document.visibilityState === "visible") void overlayActions.recheck(); };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, []);

  async function allow() {
    setWaiting(true);
    await overlayActions.requestPermission();
  }
  async function check() {
    setChecking(true);
    await overlayActions.recheck();
    setChecking(false);
  }

  return (
    <div className="app-access min-h-screen bg-background text-foreground flex flex-col items-center px-5 pt-10 pb-10">
      <div className="overlay-gate-stage relative grid size-56 place-items-center" aria-hidden="true">
        <span className="overlay-gate-ring absolute inset-6 rounded-full border border-primary/40" />
        <span className="overlay-gate-ring overlay-gate-ring--late absolute inset-0 rounded-full border border-primary/25" />
        <div className="access-logo relative h-40 w-24 rounded-[22px] bg-card p-2">
          <div className="h-full w-full rounded-[16px] border border-border bg-input/60 p-2">
            <div className="h-1.5 w-8 rounded-full bg-muted-foreground/40" />
            <div className="mt-3 space-y-1.5">
              <div className="h-1.5 w-full rounded-full bg-muted-foreground/25" />
              <div className="h-1.5 w-4/5 rounded-full bg-muted-foreground/25" />
              <div className="h-1.5 w-3/5 rounded-full bg-muted-foreground/25" />
            </div>
          </div>
        </div>
        <img src={botLogo} alt="" draggable={false} className="overlay-gate-bubble absolute right-6 top-10 size-16 rounded-full border-2 border-primary object-cover" />
      </div>

      <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-primary/40 px-3 py-1 text-xs font-bold tracking-widest text-primary">
        <Layers className="size-3.5" /> STEP 1 OF 2
      </p>
      <h1 className="mt-4 text-center font-display text-3xl font-bold sm:text-4xl">Allow your bot to float</h1>
      <p className="mt-3 max-w-sm text-center text-base text-muted-foreground">
        AlgoVault needs <strong className="text-foreground">Display over other apps</strong> so your bot circle and live Trade Log can stay on screen while you use MetaTrader or any other app.
      </p>

      <ol className="access-form mt-8 w-full max-w-sm space-y-4 rounded-[28px] bg-card px-6 py-6">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/60 text-sm font-bold text-primary">{i + 1}</span>
            <div>
              <p className="font-bold">{s.title}</p>
              <p className="text-sm text-muted-foreground">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 w-full max-w-sm space-y-3">
        <Button onClick={() => void allow()} className="access-button h-16 w-full rounded-full text-base font-bold">
          {waiting ? <><Loader2 className="size-5 animate-spin" />Waiting for permission…</> : "Allow display over other apps"}
        </Button>
        <Button variant="outline" onClick={() => void check()} disabled={checking} className="h-14 w-full rounded-full text-base font-bold">
          {checking ? <Loader2 className="size-5 animate-spin" /> : <RefreshCw className="size-5" />}I've turned it on — continue
        </Button>
        <p role="status" className="text-center text-sm font-semibold">
          Permission: <span className={o.permission ? "text-primary" : "text-destructive"}>{o.permission ? "Allowed" : "Not allowed yet"}</span>
        </p>
      </div>

      <p className="mt-6 flex max-w-sm items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        AlgoVault only uses this to draw your bot circle and Trade Log. It can't read, tap or change anything in other apps.
      </p>
    </div>
  );
}
