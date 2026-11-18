import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  Menu, Calendar, Lock, Copy, Check, Download, Trash2, Zap, X, Play, Send, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MentorSidebar } from "@/components/MentorSidebar";
import { createManualSignal, listManualSignals, deleteManualSignal } from "@/lib/manual-signals.functions";

export const Route = createFileRoute("/manage-eas/$eaId")({
  head: () => ({
    meta: [
      { title: "Expert Advisor — Algo Vault EA" },
      { property: "og:title", content: "Expert Advisor — Algo Vault EA" },
      { property: "og:description", content: "Manage AlgoVault EA symbols, magic numbers and manual signals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Manage symbols, magic number and manual signal slot for this EA." },
    ],
  }),
  component: () => (<AuthGate><EADetail /></AuthGate>),
});

type Signal = {
  id: string; symbol: string; side: string; lot: number;
  stop_loss: number | null; take_profit: number | null; comment: string | null;
  consumed_at: string | null; created_at: string;
};

function EADetail() {
  const { eaId } = Route.useParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [custom, setCustom] = useState("");

  // Magic number (bot code) persisted per-EA in localStorage.
  const magicKey = `ea.magic.${eaId}`;
  const [magic, setMagic] = useState<string>("");
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const v = localStorage.getItem(magicKey);
    if (v) setMagic(v);
    else {
      // suggest a stable default derived from the ea id.
      const suggest = (parseInt(eaId.replace(/\D/g, "").slice(0, 6) || "0", 10) || 0) + 90000;
      setMagic(String(suggest));
    }
  }, [eaId, magicKey]);
  function saveMagic() {
    try { localStorage.setItem(magicKey, magic.trim()); } catch { /* ignore */ }
  }

  const eaName = "GAUTH MASTER V1+";
  const secret = useMemo(
    () => `3a9adf610e92cea8f7c94b2b5543fa8c${eaId.slice(0, 4)}`,
    [eaId],
  );
  const copy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const addSymbol = (s: string) => {
    const v = s.trim(); // keep exactly what was typed (upper + lower case)
    if (!v || symbols.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setSymbols((prev) => [...prev, v]);
  };

  /* ---------------- Manual signal slot ---------------- */
  const create = useServerFn(createManualSignal);
  const list = useServerFn(listManualSignals);
  const del = useServerFn(deleteManualSignal);
  const [side, setSide] = useState<"BUY" | "SELL" | "CLOSE">("BUY");
  const [msSymbol, setMsSymbol] = useState("XAUUSD");
  const [lot, setLot] = useState("0.01");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [feed, setFeed] = useState<Signal[]>([]);

  async function refresh() {
    const m = Number(magic);
    if (!Number.isFinite(m) || m <= 0) { setFeed([]); return; }
    try { setFeed((await list({ data: { magic: m } })) as Signal[]); } catch { /* noop */ }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 1200); return () => clearInterval(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [magic]);

  async function send() {
    setMsg(null);
    const m = Number(magic);
    if (!Number.isFinite(m) || m <= 0) { setMsg("Set a valid Magic Number first."); return; }
    setBusy(true);
    try {
      await create({ data: {
        magic: m,
        symbol: msSymbol.trim(),
        side,
        lot: Number(lot) || 0.01,
        stop_loss: sl ? Number(sl) : null,
        take_profit: tp ? Number(tp) : null,
        comment: "AlgoVault mentor",
      }});
      setMsg("⚡ Sent — delivering to connected terminals now.");
      await refresh();
    } catch (e: unknown) {
      setMsg("✗ " + (e instanceof Error ? e.message : "error"));
    } finally { setBusy(false); }
  }
  async function removeSignal(id: string) {
    setBusy(true);
    try { await del({ data: { id } }); await refresh(); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <header className="sticky top-0 z-30 flex items-center justify-between px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button onClick={() => setMenuOpen(true)} className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <button className="size-11 rounded-xl border border-primary/40 bg-card/60 grid place-items-center text-primary">
          <Calendar className="size-5" />
        </button>
      </header>

      <main className="px-5 pt-6 pb-16 space-y-6 max-w-md mx-auto">
        {/* Hero EA card */}
        <section className="rounded-3xl border border-primary/40 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent p-6 shadow-card">
          <p className="text-xs font-bold tracking-wider uppercase text-primary flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" /> Expert Advisor
          </p>
          <h1 className="mt-3 font-display text-3xl font-bold">{eaName}</h1>

          <button className="mt-4 inline-flex items-center gap-2 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-400">
            <Lock className="size-4" /> Keep code private
          </button>

          <div className="mt-5 flex items-stretch rounded-2xl border border-primary/30 bg-background/40 overflow-hidden">
            <code className="flex-1 p-4 font-mono text-sm break-all">{secret}</code>
            <button onClick={copy} className="px-4 flex items-center gap-2 text-xs font-bold tracking-wider uppercase text-muted-foreground border-l border-primary/30 hover:text-foreground transition">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        {/* Magic number (bot code) */}
        <section className="rounded-3xl border border-primary/40 bg-gradient-card p-6 shadow-card">
          <h2 className="font-display text-lg font-bold">Magic Number (MT5 Desktop)</h2>
          <p className="mt-1 text-xs text-muted-foreground">This is the bot code your MT5 Desktop EA polls the signal bridge with. Anything you send from this portal below is delivered only to the EA with this magic.</p>
          <div className="mt-3 flex gap-2">
            <Input inputMode="numeric" value={magic} onChange={(e) => setMagic(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 90210" className="h-12 rounded-xl bg-background/40" />
            <Button onClick={saveMagic} className="h-12 rounded-xl bg-primary text-primary-foreground font-bold">Save</Button>
          </div>
        </section>

        {/* Manual signal slot */}
        <section className="rounded-3xl border border-primary/40 bg-gradient-card p-6 shadow-card">
          <h2 className="font-display text-lg font-bold flex items-center gap-2"><Send className="size-4 text-primary" /> Send Manual Signal</h2>
          <p className="mt-1 text-xs text-muted-foreground">Only two sources reach the bot: the MT5 desktop EA itself, and this manual slot. The AI scanner does not.</p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {(["BUY", "SELL", "CLOSE"] as const).map((s) => (
              <button key={s} onClick={() => setSide(s)}
                className={`h-11 rounded-xl border font-bold text-sm ${side === s ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40"}`}>
                {s}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Input value={msSymbol} onChange={(e) => setMsSymbol(e.target.value)} placeholder="Symbol" className="h-12 rounded-xl bg-background/40" />
            <Input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="decimal" placeholder="Lot" className="h-12 rounded-xl bg-background/40" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" placeholder="Stop loss (optional)" className="h-12 rounded-xl bg-background/40" />
            <Input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="Take profit (optional)" className="h-12 rounded-xl bg-background/40" />
          </div>
          <Button onClick={send} disabled={busy} className="mt-3 w-full h-12 rounded-xl bg-primary text-primary-foreground font-bold">
            {busy ? <><Loader2 className="size-4 mr-2 animate-spin" /> Sending…</> : <><Send className="size-4 mr-2" /> Send to bot</>}
          </Button>
          {msg && <p className="mt-2 text-sm text-center">{msg}</p>}

          {/* Queue */}
          <div className="mt-5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Recent signals for magic {magic || "—"}</p>
            {feed.length === 0 ? (
              <p className="text-xs text-muted-foreground">No signals yet.</p>
            ) : (
              <ul className="space-y-2">
                {feed.map((s) => (
                  <li key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-background/40 p-3 text-xs">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-primary">{s.side}</span>
                      <span className="ml-2 font-mono">{s.symbol}</span>
                      <span className="ml-2 text-muted-foreground">{Number(s.lot)} lots</span>
                      <span className={`ml-2 text-[10px] ${s.consumed_at ? "text-muted-foreground" : "text-primary"}`}>
                        {s.consumed_at ? "delivered" : "pending"}
                      </span>
                    </div>
                    <button onClick={() => removeSignal(s.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Run robot */}
        <Link to="/robot/$eaId" params={{ eaId }}
          className="flex items-center gap-4 rounded-2xl border border-primary/40 bg-primary/10 p-5 hover:bg-primary/15 transition shadow-glow">
          <div className="size-12 rounded-xl bg-primary/20 border border-primary/40 grid place-items-center text-primary shrink-0">
            <Play className="size-5" fill="currentColor" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-primary">Open Robot Control</p>
            <p className="text-sm text-muted-foreground mt-1">Start, monitor and view logs for {eaName}</p>
          </div>
        </Link>

        {/* Delete card */}
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-5 flex items-center gap-4">
          <div className="size-12 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center text-primary shrink-0">
            <Trash2 className="size-5" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-primary">Delete this EA</p>
            <p className="text-sm text-muted-foreground mt-1">This action cannot be undone</p>
          </div>
          <Button variant="outline" className="rounded-xl border-primary/50 text-primary hover:bg-primary/10 hover:text-primary">Delete</Button>
        </div>

        {/* Symbols */}
        <section className="rounded-3xl border border-border bg-gradient-card p-6 shadow-card">
          <h2 className="font-display text-2xl font-bold">Symbols</h2>
          <p className="mt-1 text-muted-foreground">Click a symbol to add it to {eaName}</p>

          <div className="mt-4">
            <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
              {symbols.length} symbols active
            </span>
          </div>

          {symbols.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {symbols.map((s) => (
                <span key={s} className="inline-flex items-center gap-2 rounded-full bg-primary/15 border border-primary/30 px-3 py-1.5 text-sm font-medium text-primary">
                  {s}
                  <button onClick={() => setSymbols((p) => p.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="mt-6 grid grid-cols-3 gap-2">
            {["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "BTCUSD", "USDCAD"].map((s) => (
              <button key={s} onClick={() => addSymbol(s)}
                className="rounded-xl border border-border bg-background/40 px-3 py-2 text-sm font-medium hover:border-primary/50 hover:text-primary transition">
                {s}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <label className="text-sm text-muted-foreground">Custom:</label>
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. USDMXN"
              className="mt-2 h-12 rounded-xl border-border bg-background/40 px-4" />
            <Button onClick={() => { addSymbol(custom); setCustom(""); }} disabled={!custom.trim()}
              className="mt-3 h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 font-semibold">Add</Button>
          </div>
        </section>

        <div className="text-center">
          <Link to="/manage-eas" className="text-sm text-muted-foreground hover:text-foreground">← Back to Manage EAs</Link>
        </div>

        <div className="pt-6 flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2 font-display font-semibold">
            <Zap className="size-4 text-primary" fill="currentColor" />
            Algo <span className="text-primary">Vault</span> EA
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-1.5 text-xs font-semibold text-green-400">
            <span className="size-2 rounded-full bg-green-400" /> Systems Online
          </div>
        </div>
      </main>
    </div>
  );
}
