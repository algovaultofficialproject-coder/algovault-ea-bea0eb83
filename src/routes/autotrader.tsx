import { createFileRoute, Link } from "@tanstack/react-router";
import { usePositionGuard } from "@/lib/usePositionGuard";
import { useEffect, useState } from "react";
import { ArrowLeft, Pause, Play, Plus, Radar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FloatingLog } from "@/components/TradeLog";
import { MarketPanel } from "@/components/autotrader/MarketPanel";
import { MtfPanel } from "@/components/autotrader/MtfPanel";
import { MarketChangePanel } from "@/components/autotrader/MarketChangePanel";
import { TpSlSettingsPanel } from "@/components/autotrader/TpSlPanel";
import { TradesPanel } from "@/components/autotrader/TradesPanel";
import { PerformancePanel } from "@/components/autotrader/PerformancePanel";
import { ProSettings } from "@/components/autotrader/ProSettings";
import { ScannerBoard } from "@/components/autotrader/ScannerBoard";
import { DEFAULT_WATCHLIST } from "@/lib/autotrader-pro/scanner-board";
import { sideTone } from "@/components/autotrader/ui-bits";
import { usePortalStore } from "@/lib/portal-store";
import { useAuth } from "@/hooks/useAuth";
import { usePortalSync } from "@/lib/usePortalSync";
import { tradeLog } from "@/lib/trade-log";
import { cleanSymbols, hasSymbol, liveAuthorized, proActions, useProState } from "@/lib/autotrader-pro/store";
import { useAutoTraderPro } from "@/lib/autotrader-pro/useAutoTraderPro";
import { saveProShared } from "@/lib/autotrader-pro/shared-config.functions";
import { sharedFromState } from "@/lib/autotrader-pro/shared-config";
import { SCAN_INTERVALS } from "@/lib/autotrader-pro/timeframes";
import type { TradingMode } from "@/lib/autotrader-pro/types";

export const Route = createFileRoute("/autotrader")({
  head: () => ({
    meta: [
      { title: "AutoTrader Pro — Algo Vault EA" },
      { name: "description", content: "Multi-strategy market scanner with early and confirmed BUY/SELL signals, risk controls, paper trading and walk-forward backtests." },
      { property: "og:title", content: "AutoTrader Pro — Algo Vault EA" },
      { property: "og:description", content: "Adaptive strategy selection, ATR risk management, paper and live modes, and measured strategy performance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AutoTraderPage,
});

const MODES: Array<{ id: TradingMode; label: string; hint: string }> = [
  { id: "analysis", label: "Analysis", hint: "Scans and records signals only" },
  { id: "paper", label: "Paper", hint: "Simulated trades with full management" },
  { id: "live", label: "Live", hint: "Real orders on your connected account" },
];

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function AutoTraderPage() {
  usePortalSync(); // loads the signed-in account's bots so signals can be sent to the trading-app bot
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { profile, loading } = useAuth();
  if (!mounted || loading) return <div className="min-h-screen bg-background" />;
  if (!profile?.is_admin) {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center gap-4 p-6 text-center">
        <Radar className="size-10 text-primary" />
        <h1 className="text-2xl font-bold">AutoTrader Pro</h1>
        <p className="text-muted-foreground max-w-sm">AutoTrader Pro is in the admin mentor portal. Sign in as an admin to open it.</p>
        <Button asChild><Link to="/login">Mentor sign in</Link></Button>
      </main>
    );
  }
  return <Dashboard />;
}

function Dashboard() {
  const pro = useProState();
  const { eas, activeEAId } = usePortalStore();
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("board");
  const [focus, setFocus] = useState(pro.symbols[0] ?? "BTCUSD");
  const [adding, setAdding] = useState("");
  const [modeNote, setModeNote] = useState<string | null>(null);
  const now = useNow();
  const { scans, busy, nextAt, runBacktest, executeSignal } = useAutoTraderPro(running);
  usePositionGuard(running);
  // Publish this setup so every trading-app robot follows the admin's AutoTrader Pro.
  const shared = JSON.stringify(sharedFromState(pro));
  useEffect(() => {
    const t = setTimeout(() => { saveProShared({ data: { config: shared } }).catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [shared]);
  const robotSymbols = (eas.find((e) => e.id === activeEAId)?.symbols ?? []).map((s) => s.symbol).filter((s) => !hasSymbol(pro.symbols, s));
  const focusSym = pro.symbols.includes(focus) ? focus : pro.symbols[0] ?? "BTCUSD";

  function chooseMode(m: TradingMode) {
    setModeNote(null);
    if (m === "live" && !liveAuthorized(pro, Date.now())) { setModeNote("Authorise live trading in Settings first."); setTab("settings"); return; }
    if (m === "live" && running) tradeLog.stop(); // one executor at a time
    proActions.setMode(m);
  }
  function toggleRun() {
    if (!running && pro.mode === "live") {
      if (!liveAuthorized(pro, Date.now())) { chooseMode("live"); return; }
      // One executor at a time: the classic robot stops before AutoTrader Pro trades live.
      tradeLog.stop();
    }
    setRunning((r) => !r);
    tradeLog.info(running ? "AutoTrader Pro stopped" : `AutoTrader Pro scanning · ${pro.mode} mode`);
  }
  /** Keeps the symbol exactly as typed (capital or small letters) — that spelling is what gets executed. */
  function addSymbol(sym: string) {
    const s = sym.trim();
    if (!s) return;
    const next = cleanSymbols([...pro.symbols, s]);
    proActions.setSymbols(next);
    setFocus(next.find((x) => x.toUpperCase() === s.toUpperCase()) ?? s); setAdding("");
  }

  return (
    <div className="autotrader-pro app-ui-font min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-3 pb-28 pt-4 sm:px-6">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button asChild variant="ghost" size="icon" aria-label="Back to the mentor portal"><Link to="/dashboard"><ArrowLeft className="size-5" /></Link></Button>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold leading-tight">AutoTrader Pro</h1>
              <p className="text-[11px] text-muted-foreground truncate">
                {running ? (busy ? "Scanning markets…" : `Live scanning · next in ${Math.max(0, Math.round(((nextAt ?? now) - now) / 1000))}s`) : "Stopped"} · {pro.mode} mode
              </p>
            </div>
          </div>
          <Button onClick={toggleRun} variant={running ? "outline" : "default"} className="rounded-full">
            {running ? <Pause className="size-4" /> : <Play className="size-4" />}{running ? "Stop" : "Start scanning"}
          </Button>
        </header>

        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-secondary p-1" role="radiogroup" aria-label="Trading mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={pro.mode === m.id} onClick={() => chooseMode(m.id)}
              className={`rounded-xl px-2 py-2 text-left transition-colors ${pro.mode === m.id ? (m.id === "live" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground") : "text-muted-foreground"}`}>
              <span className="block text-sm font-bold">{m.label}</span>
              <span className="block text-[10px] leading-tight opacity-80">{m.hint}</span>
            </button>
          ))}
        </div>
        {modeNote && <p className="mt-2 text-xs text-destructive">{modeNote}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {pro.symbols.map((s) => {
            const best = scans[s]?.result?.best;
            return (
              <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${s === focusSym ? "border-primary bg-primary/10" : "border-border"}`}>
                <button type="button" onClick={() => setFocus(s)} className="font-semibold">{s}{best && <span className={`ml-1 ${sideTone(best.side)}`}>{best.side}</span>}</button>
                {pro.symbols.length > 1 && <button type="button" aria-label={`Remove ${s}`} onClick={() => proActions.setSymbols(pro.symbols.filter((x) => x !== s))}><X className="size-3" /></button>}
              </span>
            );
          })}
          <form onSubmit={(ev) => { ev.preventDefault(); addSymbol(adding); }} className="flex items-center gap-1">
            <Input value={adding} onChange={(ev) => setAdding(ev.target.value)} placeholder="Add symbol" className="h-8 w-28 text-xs" aria-label="Add symbol" />
            <Button type="submit" size="icon" variant="ghost" className="size-8" aria-label="Add symbol"><Plus className="size-4" /></Button>
          </form>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <button type="button" className="rounded-full bg-secondary px-2 py-0.5" onClick={() => proActions.setSymbols(cleanSymbols([...pro.symbols, ...DEFAULT_WATCHLIST]))}>+ Add full watchlist (gold, majors, crypto, indices)</button>
          {pro.symbols.indexOf(focusSym) > 0 && <button type="button" className="rounded-full bg-secondary px-2 py-0.5" onClick={() => proActions.setSymbols([focusSym, ...pro.symbols.filter((x) => x !== focusSym)])}>↑ Prioritise {focusSym}</button>}
        </div>
        {robotSymbols.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">Robot pairs:
            {robotSymbols.slice(0, 8).map((s) => <button key={s} type="button" onClick={() => addSymbol(s)} className="rounded-full bg-secondary px-2 py-0.5 text-foreground">+ {s}</button>)}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Timeframes: {SCAN_INTERVALS.join(" · ")} scanned automatically — the strongest setup is used.</p>

        <Tabs value={tab} onValueChange={setTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-5 [&>button]:px-1 [&>button]:text-[11px]">
            <TabsTrigger value="board">Orders</TabsTrigger>
            <TabsTrigger value="scan">Scanner</TabsTrigger>
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="perf">Performance</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="board" className="mt-3"><ScannerBoard scans={scans} symbols={pro.symbols} now={now} onMarket={executeSignal} /></TabsContent>
          <TabsContent value="scan" className="mt-3 space-y-3"><MarketChangePanel scan={scans[focusSym]} now={now} /><MtfPanel scan={scans[focusSym]} now={now} /><MarketPanel scan={scans[focusSym]} now={now} onExecute={executeSignal} /></TabsContent>
          <TabsContent value="trades" className="mt-3"><TradesPanel scans={scans} now={now} /></TabsContent>
          <TabsContent value="perf" className="mt-3 space-y-3"><PerformancePanel symbol={focusSym} runBacktest={runBacktest} /><TpSlSettingsPanel /></TabsContent>
          <TabsContent value="settings" className="mt-3"><ProSettings /></TabsContent>
        </Tabs>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">Price history: Coinbase Exchange (crypto) and Yahoo Finance free feed (forex, gold & indices; Twelve Data if a key is added). TradingView's public technical rating is shown as a cross-check. Signals are analysis, not financial advice.</p>
      </div>
      <FloatingLog />
    </div>
  );
}
