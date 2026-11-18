import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { MentorSidebar } from "@/components/MentorSidebar";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Menu, Radio, Send, Loader2, TrendingUp, TrendingDown, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePortalStore, botCodeFor } from "@/lib/portal-store";
import { createManualSignal, listManualSignals, deleteManualSignal } from "@/lib/manual-signals.functions";
import { getSmartSignal } from "@/lib/smart-signal.functions";
import type { SmartSignal } from "@/lib/smart-signal.server";

export const Route = createFileRoute("/signals")({
  head: () => ({
    meta: [
      { title: "Signals — AlgoVault Portal" },
      { property: "og:title", content: "Trade Signals — AlgoVault Portal" },
      { property: "og:description", content: "Manage manual trade signals for your AlgoVault bots." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "description", content: "Broadcast manual trade signals to every client connected to one of your EAs." },
    ],
  }),
  component: () => (<AuthGate><SignalsPage /></AuthGate>),
});

type Signal = {
  id: string; symbol: string; side: string; lot: number;
  stop_loss: number | null; take_profit: number | null; comment: string | null;
  consumed_at: string | null; created_at: string;
};

function magicFor(eaId: string): number {
  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(`ea.magic.${eaId}`);
    if (v && Number(v) > 0) return Number(v);
  }
  return Number(botCodeFor(eaId));
}

function SignalsPage() {
  const { eas } = usePortalStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [eaId, setEaId] = useState<string>("");
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [lot, setLot] = useState("0.01");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [feed, setFeed] = useState<Signal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<SmartSignal | null>(null);

  const create = useServerFn(createManualSignal);
  const list = useServerFn(listManualSignals);
  const del = useServerFn(deleteManualSignal);
  const smartScan = useServerFn(getSmartSignal);

  const activeEA = useMemo(() => eas.find((e) => e.id === eaId) ?? null, [eas, eaId]);
  const magic = activeEA ? magicFor(activeEA.id) : 0;
  const symbolOptions = activeEA?.symbols.map((s) => s.symbol) ?? [];

  useEffect(() => {
    if (!activeEA) { setFeed([]); return; }
    let alive = true;
    const load = async () => {
      try { const rows = await list({ data: { magic } }); if (alive) setFeed(rows as Signal[]); } catch { /* noop */ }
    };
    load();
    const t = setInterval(load, 1200);
    return () => { alive = false; clearInterval(t); };
  }, [magic, activeEA, list]);

  async function send() {
    setMsg(null);
    if (!activeEA) { setMsg("Choose an Expert Advisor first."); return; }
    const s = symbol.trim();
    if (!s) { setMsg("Enter a symbol."); return; }
    setBusy(true);
    // Optimistic row so the mentor sees the signal instantly.
    const tempId = `temp-${Date.now()}`;
    setFeed((f) => [{ id: tempId, symbol: s, side, lot: Number(lot) || 0.01, stop_loss: sl ? Number(sl) : null, take_profit: tp ? Number(tp) : null, comment: null, consumed_at: null, created_at: new Date().toISOString() }, ...f]);
    try {
      await create({ data: {
        magic,
        symbol: s,
        side,
        lot: Number(lot) || 0.01,
        stop_loss: sl ? Number(sl) : null,
        take_profit: tp ? Number(tp) : null,
        comment: `AlgoVault ${activeEA.name}`,
      }});
      setMsg("⚡ SIGNALS DELIVERED — executing on connected clients now.");
      setSymbol(""); setSl(""); setTp("");
      const rows = await list({ data: { magic } });
      setFeed(rows as Signal[]);
    } catch (e: unknown) {
      setFeed((f) => f.filter((x) => x.id !== tempId));
      setMsg("✗ " + (e instanceof Error ? e.message : "failed"));
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await del({ data: { id } }); setFeed((f) => f.filter((x) => x.id !== id)); } catch { /* noop */ }
  }

  async function aiScan() {
    const s = symbol.trim();
    if (!s) { setMsg("Enter a symbol to scan."); return; }
    setScanning(true); setMsg(null); setScan(null);
    try {
      const r = await smartScan({ data: { symbol: s } });
      setScan(r);
      if (!r.ok) setMsg("✗ " + (r.error ?? "scan failed"));
      else if (r.side !== "WAIT") {
        setSide(r.side);
        setSl(r.stopLoss ? String(r.stopLoss) : "");
        setTp(r.takeProfit ? String(r.takeProfit) : "");
      }
    } catch (e) {
      setMsg("✗ " + (e instanceof Error ? e.message : "scan failed"));
    } finally { setScanning(false); }
  }

  return (
    <div className="min-h-screen bg-background bg-hero-glow">
      <MentorSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <header className="sticky top-0 z-30 flex items-center gap-3 px-5 py-4 backdrop-blur-xl bg-background/70 border-b border-border/40">
        <button onClick={() => setMenuOpen(true)} className="size-11 rounded-xl border border-border bg-card/60 grid place-items-center" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="size-8 rounded-lg bg-gradient-primary grid place-items-center shadow-glow">
            <Radio className="size-4 text-primary-foreground" />
          </span>
          <span className="font-display text-lg font-bold text-primary">Algo Vault EA</span>
        </div>
      </header>

      <main className="px-5 pt-6 pb-16 max-w-md mx-auto">
        <p className="text-[11px] font-bold tracking-[0.25em] uppercase text-muted-foreground">Broadcast</p>
        <h1 className="mt-1 font-display text-4xl font-bold flex items-center gap-3">
          <Radio className="size-8 text-primary" /> Signals
        </h1>
        <p className="mt-2 text-muted-foreground">Send manual trade signals to all connected clients.</p>

        <div className="my-6 h-px bg-border/60" />

        <section className="rounded-3xl border border-primary/40 bg-gradient-card p-6 shadow-card">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Send className="size-4 text-primary" /> Send Signal to Clients
          </h2>

          <div className="mt-5">
            <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Send to EA</label>
            <select
              value={eaId}
              onChange={(e) => { setEaId(e.target.value); setSymbol(""); }}
              className="mt-2 w-full h-12 rounded-xl border border-border bg-background/40 px-4 text-sm"
            >
              <option value="">Choose an Expert Advisor</option>
              {eas.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Symbol</label>
            {symbolOptions.length > 0 ? (
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="mt-2 w-full h-12 rounded-xl border border-border bg-background/40 px-4 text-sm"
              >
                <option value="">Choose a symbol</option>
                {symbolOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            ) : (
              <Input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder={activeEA ? "e.g. XAUUSD" : "Select an EA first"}
                disabled={!activeEA}
                className="mt-2 h-12 rounded-xl bg-background/40"
              />
            )}
          </div>

          <Button
            onClick={aiScan}
            disabled={scanning || !symbol.trim()}
            variant="outline"
            className="mt-4 w-full h-12 rounded-xl border-primary/50 text-primary font-bold"
          >
            {scanning ? <><Loader2 className="size-4 mr-2 animate-spin" /> AI scanning TradingView…</> : <><Sparkles className="size-4 mr-2" /> AI Scan — Get Signal</>}
          </Button>

          {scan && scan.ok && (
            <div className={`mt-3 rounded-2xl border p-4 text-sm ${scan.side === "BUY" ? "border-primary/50 bg-primary/10" : scan.side === "SELL" ? "border-destructive/50 bg-destructive/10" : "border-border bg-background/40"}`}>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-lg flex items-center gap-2">
                  {scan.side === "BUY" ? <TrendingUp className="size-5 text-primary" /> : scan.side === "SELL" ? <TrendingDown className="size-5 text-destructive" /> : null}
                  {scan.side}
                </span>
                <span className="text-xs text-muted-foreground">{scan.confidence}% confidence</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{scan.reason}</p>
              {scan.timeframe && <p className="mt-2 text-xs font-bold text-primary">Recommended timeframe: {scan.timeframe} {scan.rewardRisk ? `· ${scan.rewardRisk.toFixed(1)}:1 reward/risk` : ''}</p>}
              {scan.timeframeReason && <p className="mt-1 text-xs text-muted-foreground">{scan.timeframeReason}</p>}
              {scan.side !== "WAIT" && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] font-mono">
                  <div><p className="text-muted-foreground">Entry</p><p>{scan.entry}</p></div>
                  <div><p className="text-muted-foreground">Stop</p><p>{scan.stopLoss}</p></div>
                  <div><p className="text-muted-foreground">Target</p><p>{scan.takeProfit}</p></div>
                </div>
              )}
              {scan.ruleReasons.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground">Confluences: {scan.ruleReasons.join(" · ")}</p>
              )}
            </div>
          )}

          <div className="mt-4">
            <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Direction</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setSide("BUY")}
                className={`h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${side === "BUY" ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground"}`}
              >
                <TrendingUp className="size-4" /> BUY
              </button>
              <button
                onClick={() => setSide("SELL")}
                className={`h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 ${side === "SELL" ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/40 text-muted-foreground"}`}
              >
                <TrendingDown className="size-4" /> SELL
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Take Profit</label>
              <Input value={tp} onChange={(e) => setTp(e.target.value)} inputMode="decimal" placeholder="e.g. 105000" className="mt-2 h-12 rounded-xl bg-background/40" />
            </div>
            <div>
              <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Stop Loss</label>
              <Input value={sl} onChange={(e) => setSl(e.target.value)} inputMode="decimal" placeholder="e.g. 98000" className="mt-2 h-12 rounded-xl bg-background/40" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Lot</label>
              <Input value={lot} onChange={(e) => setLot(e.target.value)} inputMode="decimal" className="mt-2 h-12 rounded-xl bg-background/40" />
            </div>
            <div>
              <label className="text-[11px] font-bold tracking-widest uppercase text-muted-foreground">Magic</label>
              <Input value={magic ? String(magic) : ""} disabled placeholder="—" className="mt-2 h-12 rounded-xl bg-background/40 font-mono" />
            </div>
          </div>

          <Button
            onClick={send}
            disabled={busy || !activeEA}
            className="mt-6 w-full h-14 rounded-xl bg-primary text-primary-foreground font-bold text-base"
          >
            {busy ? <><Loader2 className="size-4 mr-2 animate-spin" /> Sending…</> : <><Send className="size-4 mr-2" /> Send Signal</>}
          </Button>
          {msg && <p className="mt-3 text-sm text-center">{msg}</p>}
        </section>

        {activeEA && (
          <section className="mt-6 rounded-3xl border border-border bg-card/60 p-5">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">
              Recent signals for {activeEA.name} · magic {magic}
            </p>
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
                        {s.id.startsWith("temp-") ? "sending…" : "delivered"}
                      </span>
                    </div>
                    <button onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
