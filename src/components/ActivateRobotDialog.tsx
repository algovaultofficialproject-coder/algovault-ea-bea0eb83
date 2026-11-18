import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Key, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { portalActions } from "@/lib/portal-store";
import { redeemLicense } from "@/lib/licenses.functions";
import botLogo from "@/assets/bot-logo.jpg";

export function ActivateRobotDialog({ open, onClose, required = false }: { open: boolean; onClose: () => void; required?: boolean }) {
  const navigate = useNavigate();
  const redeem = useServerFn(redeemLicense);
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    // Local match first (mentor's own device), otherwise redeem from the cloud so
    // any client can activate on any device without logging in.
    const local = portalActions.validateLicense(key);
    if (!("error" in local)) {
      setBusy(false);
      onClose();
      navigate({ to: "/ios" });
      return;
    }
    try {
      const res = await redeem({ data: { key } });
      portalActions.importLicensedEA(res.ea, { key: res.key, userName: res.userName, duration: res.duration });
      setBusy(false);
      onClose();
      navigate({ to: "/ios" });
    } catch (e2) {
      setBusy(false);
      setErr(e2 instanceof Error && e2.message ? e2.message : "Invalid license key");
    }
  }


  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" onClick={onClose}>
      <div className="flex-1 flex flex-col justify-center w-full max-w-md mx-auto px-6" onClick={(e) => e.stopPropagation()}>
        {!required && <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 text-muted-foreground">
          <X className="size-6" />
        </button>}
        <h2 className="text-center font-display text-3xl font-bold text-primary tracking-wide">License Key</h2>
        <p className="mt-3 text-center text-sm text-muted-foreground leading-relaxed">
          Enter the license key you were given by your admin or signal provider. Each key works once.{required ? " You need a bot to use the app." : ""}
        </p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="relative rounded-2xl border-2 border-primary bg-card shadow-[0_0_24px_-6px_var(--primary)]">
            <Key className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-primary" />
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="Enter License Key"
              className="h-14 bg-transparent border-0 pl-12 focus-visible:ring-0"
            />
          </div>
          {err && <p className="text-sm text-destructive text-center">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full h-14 rounded-2xl font-bold text-base shadow-[0_0_30px_-6px_var(--primary)]">
            {busy ? "Connecting..." : "Connect Robot"}
          </Button>
          {!required && <Button type="button" variant="outline" onClick={onClose} className="w-full h-14 rounded-2xl border-2 border-primary/60 bg-transparent">
            Cancel
          </Button>}
        </form>
      </div>
      <p className="pb-6 text-center text-xs text-muted-foreground">© 2026 AlgoVault</p>
    </div>
  );
}
