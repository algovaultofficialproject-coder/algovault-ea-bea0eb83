import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { devTestMtapi } from "@/lib/dev-mtapi-test.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/dev/mtapi-test")({
  component: DevMtapiTest,
  head: () => ({ meta: [
    { title: "Broker Connection Diagnostics — AlgoVault" },
    { name: "description", content: "Test AlgoVault MetaTrader broker connectivity." },
    { property: "og:title", content: "Broker Connection Diagnostics — AlgoVault" },
    { property: "og:description", content: "Test AlgoVault MetaTrader broker connectivity." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  errorComponent: ({ error }) => <div className="p-6 text-destructive">Error: {String(error)}</div>,
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function DevMtapiTest() {
  const run = useServerFn(devTestMtapi);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [form, setForm] = useState({
    login: "",
    password: "",
    server: "",
    platform: "MT5" as "MT4" | "MT5",
    symbol: "EURUSD",
    side: "BUY" as "BUY" | "SELL",
    volume: 0.01,
    execute: false,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await run({ data: form });
      setResult(r);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">MT5 API End-to-End Test</h1>
        <p className="text-muted-foreground text-sm">
          Dev-only. Starts a metatraderapi.cloud session, pings, fetches account-info, and shows
          the exact trade payload we would send. Toggle <b>Execute real trade</b> to place a live micro-lot order.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Credentials</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Login"><Input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required /></Field>
            <Field label="Password"><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></Field>
            <Field label="Server"><Input value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} required /></Field>
            <Field label="Platform">
              <select className="h-10 rounded-md border bg-background px-3" value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value as "MT4" | "MT5" })}>
                <option value="MT5">MT5</option><option value="MT4">MT4</option>
              </select>
            </Field>
            <Field label="Symbol"><Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></Field>
            <Field label="Side">
              <select className="h-10 rounded-md border bg-background px-3" value={form.side}
                onChange={(e) => setForm({ ...form, side: e.target.value as "BUY" | "SELL" })}>
                <option value="BUY">BUY</option><option value="SELL">SELL</option>
              </select>
            </Field>
            <Field label="Volume">
              <Input type="number" step="0.01" min="0.01" max="1" value={form.volume}
                onChange={(e) => setForm({ ...form, volume: Number(e.target.value) })} />
            </Field>
            <div className="flex items-center gap-3 pt-6">
              <Switch checked={form.execute} onCheckedChange={(v) => setForm({ ...form, execute: v })} />
              <Label>Execute real trade (otherwise dry-run)</Label>
            </div>
            <div className="sm:col-span-2 flex gap-3">
              <Button type="submit" disabled={busy}>{busy ? "Running…" : "Run test"}</Button>
              <Button type="button" variant="ghost" onClick={() => router.history.back()}>Back</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className={result.ok ? "text-green-600" : "text-destructive"}>
              {result.ok ? "All steps OK" : "Failed"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
{JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
