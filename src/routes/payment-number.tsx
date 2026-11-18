import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Phone, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPaymentNumber, setPaymentNumber } from "@/lib/payment-number.functions";

export const Route = createFileRoute("/payment-number")({
  head: () => ({
    meta: [
      { title: "Payment Number — AlgoVault" },
      { name: "description", content: "Change the WhatsApp number clients contact for payment." },
      { property: "og:title", content: "Payment Number — AlgoVault" },
      { property: "og:description", content: "Change the WhatsApp number clients contact for payment." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentNumberPage,
});

function PaymentNumberPage() {
  const load = useServerFn(getPaymentNumber);
  const save = useServerFn(setPaymentNumber);
  const [current, setCurrent] = useState("");
  const [number, setNumber] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load().then((r) => setCurrent(r.number)).catch(() => {}); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await save({ data: { password: pw, number } });
      if (r.ok) { setCurrent(r.number); setNumber(""); setMsg({ ok: true, text: "Number saved." }); }
      else setMsg({ ok: false, text: r.error });
    } catch { setMsg({ ok: false, text: "Could not save. Try again." }); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid place-items-center px-5 py-10">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-border bg-card p-6 space-y-4">
        <h1 className="font-display text-2xl font-bold">Payment contact number</h1>
        <p className="text-sm text-muted-foreground">Current WhatsApp number: <span className="font-semibold text-foreground">{current ? `+${current}` : "…"}</span></p>
        <label className="text-sm font-semibold flex items-center gap-2"><Phone className="size-4 text-primary" /> New number</label>
        <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 0642060527" inputMode="tel" className="h-12 rounded-xl" required />
        <label className="text-sm font-semibold flex items-center gap-2"><Lock className="size-4 text-primary" /> Password</label>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="h-12 rounded-xl" required />
        {msg && <p className={msg.ok ? "text-sm text-primary" : "text-sm text-destructive"}>{msg.text}</p>}
        <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl">{busy ? "Saving…" : "Save number"}</Button>
        <Link to="/ios" className="block text-center text-sm text-primary">Back to trading app</Link>
      </form>
    </div>
  );
}
