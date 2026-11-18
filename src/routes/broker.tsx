import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Server, Plug, RefreshCw, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalStore } from "@/lib/portal-store";
import { connectBroker, listBrokerAccounts, syncAccount, removeBrokerAccount } from "@/lib/broker.functions";
import { mtapiOnlineTestConnection } from "@/lib/mtapi-online.functions";

export const Route = createFileRoute("/broker")({
  head: () => ({
    meta: [
      { title: "Connect Broker — Algo Vault EA" },
      { name: "description", content: "Connect MT4 and MT5 broker accounts via mtapi.io." },
      { property: "og:title", content: "Connect Broker — Algo Vault EA" },
      { property: "og:description", content: "Connect MT4 and MT5 broker accounts via mtapi.io." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Connect Broker — Algo Vault EA" },
      { name: "twitter:description", content: "Connect MT4 and MT5 broker accounts via mtapi.io." },
    ],
  }),
  component: BrokerPage,
});

type Account = {
  id: string; broker: string; platform: string; account_number: string;
  server: string; status: string; balance: number | null; equity: number | null;
  currency: string | null; leverage: number | null; last_sync: string | null; bridge_url: string | null;
};

function BrokerPage() {
  const { activatedEmail, bridgeUrl } = usePortalStore();
  const connect = useServerFn(connectBroker);
  const list = useServerFn(listBrokerAccounts);
  const sync = useServerFn(syncAccount);
  const remove = useServerFn(removeBrokerAccount);
  const testMt4 = useServerFn(mtapiOnlineTestConnection);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ broker: "", platform: "MT4" as "MT4" | "MT5", login: "", password: "", server: "", bridgeUrl: bridgeUrl });
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    if (!activatedEmail) return;
    const rows = await list({ data: { ownerEmail: activatedEmail } });
    setAccounts(rows as Account[]);
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activatedEmail]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activatedEmail) { setMsg("Activate your email first in the trading app"); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await connect({ data: { ownerEmail: activatedEmail, ...form } });
      if (!res.ok) setMsg("❌ " + (res.error ?? "Failed"));
      else { setMsg("✅ Connected · balance " + (res.info?.balance ?? "?")); setForm({ ...form, password: "" }); await refresh(); }
    } catch (e: unknown) { setMsg("❌ " + (e instanceof Error ? e.message : "Error")); }
    setBusy(false);
  }

  async function runTest() {
    if (!form.broker || !form.login || !form.password || !form.server) {
      setMsg("Fill broker, login, password and server first.");
      return;
    }
    setTesting(true); setMsg(`⏳ Verifying via ${form.platform.toLowerCase()}.mtapi.io…`);
    try {
      const res = await testMt4({ data: { platform: form.platform, login: form.login, password: form.password, server: form.server } });
      if (!res.ok) setMsg(`❌ ${form.platform.toLowerCase()}.mtapi.io: ` + res.error);
      else setMsg(`✅ Verified · balance ${res.balance ?? 0} ${res.currency ?? ""}`);
    } catch (e: unknown) {
      setMsg("❌ " + (e instanceof Error ? e.message : "Error"));
    } finally { setTesting(false); }
  }


  if (!activatedEmail) {
    return (
      <div className="min-h-screen bg-background grid place-items-center p-6 text-center">
        <div>
          <p className="text-muted-foreground">Activate your email in the app first.</p>
          <Link to="/ios" className="text-primary underline mt-2 inline-block">Open the trading app</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 flex items-center gap-3 px-5 py-4 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <Link to="/ios" className="size-10 rounded-xl border border-border grid place-items-center"><ArrowLeft className="size-4" /></Link>
        <h1 className="font-display text-xl font-bold">Broker Connections</h1>
      </header>

      <main className="max-w-md mx-auto px-5 py-6 space-y-6">
        <section className="rounded-3xl border border-primary/30 bg-gradient-card p-6 shadow-card">
          <h2 className="font-display text-2xl font-bold flex items-center gap-2"><Plug className="size-5 text-primary" /> Add Broker Account</h2>
          <p className="text-sm text-muted-foreground mt-1">Credentials are encrypted before storage and sent only to your bridge.</p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {(["MT4", "MT5"] as const).map((pf) => (
                <button key={pf} type="button" onClick={() => setForm({ ...form, platform: pf })}
                  className={`h-12 rounded-xl border font-semibold ${form.platform === pf ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground"}`}>{pf}</button>
              ))}
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
              <span className="text-primary font-semibold">MT4:</span> connected via <code>mt4.mtapi.io</code>.
              <br />
              <span className="text-primary font-semibold">MT5:</span> connected via <code>https://mt5.mtapi.io/ConnectEx</code> using your login, password and server name. Enter the exact server name from your terminal (e.g. <code>JustMarkets-Demo3</code>).
            </div>



            <Input placeholder="Broker (e.g. Exness)" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} className="h-12 rounded-xl bg-background/40" />
            <Input placeholder="Login number" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} className="h-12 rounded-xl bg-background/40" />
            <Input placeholder="Trading password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-12 rounded-xl bg-background/40" />
            <Input placeholder="Server (e.g. Exness-Real5)" value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} className="h-12 rounded-xl bg-background/40" />
            <p className="text-[10px] text-muted-foreground text-center">Connected via mtapi.io · bridge auto-configured · <span className="text-primary font-semibold">any balance accepted</span></p>
            {msg && <p className="text-sm text-center">{msg}</p>}
            <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 font-semibold">
              {busy ? "Connecting…" : "Authenticate & Connect"}
            </Button>
            <Button type="button" onClick={runTest} disabled={testing || busy} variant="outline" className="w-full h-12 rounded-xl border-primary/40 text-primary font-semibold">
              {testing ? "Testing…" : "Test Broker Connection"}
            </Button>
          </form>
        </section>

        <section className="space-y-3">
          <h3 className="font-display text-lg font-bold flex items-center gap-2"><Server className="size-4 text-primary" /> Connected Accounts</h3>
          {accounts.length === 0 && <p className="text-sm text-muted-foreground">No broker accounts yet.</p>}
          {accounts.map((a) => (
            <div key={a.id} className="rounded-2xl border border-border bg-card/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold flex items-center gap-2">{a.platform} · {a.broker}
                    {a.status === "connected" && <CheckCircle2 className="size-4 text-green-400" />}
                  </p>
                  <p className="text-xs text-muted-foreground">#{a.account_number} · {a.server}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={async () => { await sync({ data: { accountId: a.id } }); refresh(); }} className="size-9 rounded-lg border border-border grid place-items-center" aria-label="Sync"><RefreshCw className="size-4" /></button>
                  <button onClick={async () => { await remove({ data: { accountId: a.id } }); refresh(); }} className="size-9 rounded-lg border border-destructive/40 text-destructive grid place-items-center" aria-label="Remove"><Trash2 className="size-4" /></button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <Stat label="Balance" value={a.balance != null ? `${a.balance} ${a.currency ?? ""}` : "—"} />
                <Stat label="Equity" value={a.equity != null ? `${a.equity}` : "—"} />
                <Stat label="Leverage" value={a.leverage ? `1:${a.leverage}` : "—"} />
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/40 border border-border/40 p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold mt-0.5">{value}</p>
    </div>
  );
}
