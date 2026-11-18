import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { listBridgeKeys, listGeminiKeys, setBridgeKey, setGeminiKey } from "@/lib/bridge-keys.functions";

export const Route = createFileRoute("/bridge-keys")({
  head: () => ({
    meta: [
      { title: "Bridge API Keys — Algo Vault EA" },
      { name: "description", content: "Rotate the MetaTrader 4 and MetaTrader 5 trading bridge keys used by every Algo Vault EA account." },
      { property: "og:title", content: "Bridge API Keys — Algo Vault EA" },
      { property: "og:description", content: "Rotate the MT4 and MT5 trading bridge keys for all Algo Vault EA accounts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<AuthGate><BridgeKeysPage /></AuthGate>),
});

const OWNER_EMAIL = "mtwentwabantwana@gmail.com";

type KeyRow = { platform: string; preview: string; length: number; updated_at: string; updated_by: string | null };

function BridgeKeysPage() {
  const { profile } = useAuth();
  const isOwner = (profile?.email ?? "").toLowerCase().trim() === OWNER_EMAIL;
  const list = useServerFn(listBridgeKeys);
  const save = useServerFn(setBridgeKey);
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [platform, setPlatform] = useState<"mt4" | "mt5">("mt4");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setRows((await list()) as KeyRow[]); } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }

  useEffect(() => { if (isOwner) void refresh(); }, [isOwner]);

  async function submit() {
    if (value.trim().length < 20) { setErr("Paste the full API key."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await save({ data: { platform, apiKey: value.trim() } });
      setValue("");
      setMsg(`${platform.toUpperCase()} key updated — connected accounts reconnect instantly.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update key");
    } finally { setBusy(false); }
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen grid place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-xl font-bold">Owner only</h1>
          <p className="mt-2 text-sm text-muted-foreground">This section is restricted to the portal owner.</p>
          <Link to="/dashboard" className="mt-4 inline-block text-primary text-sm">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
        <Link to="/dashboard" className="size-10 rounded-full border border-border grid place-items-center"><ArrowLeft className="size-4" /></Link>
        <div>
          <p className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Owner tools</p>
          <h1 className="font-display text-lg font-bold">Bridge API Keys</h1>
        </div>
      </header>

      <section className="px-5 pt-5">
        <div className="rounded-2xl border border-primary/30 bg-card/40 p-4">
          <p className="flex items-center gap-2 text-primary text-sm font-bold"><ShieldCheck className="size-4" /> Live keys</p>
          <p className="mt-1 text-xs text-muted-foreground">These keys authenticate every MT4 and MT5 connection for all users. Replace one when it expires — sessions are dropped and re-authenticated automatically.</p>
          <div className="mt-4 space-y-2">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : rows.map((r) => (
              <div key={r.platform} className="rounded-xl border border-border bg-background/60 p-3">
                <p className="text-xs font-bold tracking-widest text-primary">{r.platform.toUpperCase()}</p>
                <code className="mt-1 block text-[11px] break-all text-muted-foreground">{r.preview}</code>
                <p className="mt-1 text-[10px] text-muted-foreground">{r.length} chars · updated {new Date(r.updated_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-card/40 p-4">
          <p className="flex items-center gap-2 text-sm font-bold"><KeyRound className="size-4 text-primary" /> Replace a key</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {(["mt4", "mt5"] as const).map((p) => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`h-12 rounded-xl border-2 text-xs font-bold tracking-widest ${platform === p ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
              >{p.toUpperCase()}</button>
            ))}
          </div>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the new mtapi.io apikey"
            className="mt-3 h-12 rounded-xl bg-background/60 font-mono text-xs"
          />
          <Button onClick={submit} disabled={busy} className="mt-3 w-full h-13 h-12 rounded-xl bg-gradient-primary text-primary-foreground font-bold tracking-widest">
            {busy ? (<><Loader2 className="size-4 mr-2 animate-spin" /> UPDATING…</>) : "UPDATE KEY"}
          </Button>
          {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
          {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        </div>

        <GeminiKeys />
      </section>
    </div>
  );
}

type GeminiRow = { slot: number; preview: string; updated_at: string };

/** Owner-only Gemini keys for AutoTrader Pro scanning: key 1 is used first, key 2 when key 1 fails. */
function GeminiKeys() {
  const list = useServerFn(listGeminiKeys);
  const save = useServerFn(setGeminiKey);
  const [rows, setRows] = useState<GeminiRow[] | null>(null);
  const [slot, setSlot] = useState<1 | 2>(1);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setRows((await list()) as GeminiRow[]); } catch (e) { setErr(e instanceof Error ? e.message : "Failed to load"); }
  }
  useEffect(() => { void refresh(); }, []);

  async function submit() {
    if (value.trim().length < 20) { setErr("Paste the full Gemini key."); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      await save({ data: { slot, apiKey: value.trim() } });
      setValue("");
      setMsg(`Gemini key ${slot} updated — scanning uses it within a minute.`);
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to update key"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-5 rounded-2xl border border-primary/30 bg-card/40 p-4">
      <p className="flex items-center gap-2 text-primary text-sm font-bold"><Sparkles className="size-4" /> Gemini keys · AutoTrader Pro scanning</p>
      <p className="mt-1 text-xs text-muted-foreground">Gemini double-checks every robot signal on the 15m chart. Key 1 is used first; key 2 takes over if key 1 fails or runs out.</p>
      <div className="mt-3 space-y-2">
        {rows === null ? <p className="text-xs text-muted-foreground">Loading…</p> : [1, 2].map((n) => {
          const r = rows.find((x) => x.slot === n);
          return (
            <div key={n} className="rounded-xl border border-border bg-background/60 p-3">
              <p className="text-xs font-bold tracking-widest text-primary">GEMINI KEY {n}</p>
              <code className="mt-1 block text-[11px] break-all text-muted-foreground">{r ? r.preview : "Not set"}</code>
              {r && <p className="mt-1 text-[10px] text-muted-foreground">updated {new Date(r.updated_at).toLocaleString()}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {([1, 2] as const).map((n) => (
          <button key={n} onClick={() => setSlot(n)}
            className={`h-12 rounded-xl border-2 text-xs font-bold tracking-widest ${slot === n ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
          >KEY {n}</button>
        ))}
      </div>
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste the new Gemini API key"
        className="mt-3 h-12 rounded-xl bg-background/60 font-mono text-xs" />
      <Button onClick={submit} disabled={busy} className="mt-3 w-full h-12 rounded-xl bg-gradient-primary text-primary-foreground font-bold tracking-widest">
        {busy ? (<><Loader2 className="size-4 mr-2 animate-spin" /> UPDATING…</>) : "UPDATE GEMINI KEY"}
      </Button>
      {msg && <p className="mt-2 text-xs text-emerald-400">{msg}</p>}
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}
