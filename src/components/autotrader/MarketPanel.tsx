import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CircleCheck, CircleDashed, Eye, Link2, Loader2, Radar, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usePortalStore } from "@/lib/portal-store";
import { connectedAccount, MAX_TRADES_PER_EXECUTION, parseTradeCount } from "@/lib/autotrader-pro/execution";
import { proActions, useProState } from "@/lib/autotrader-pro/store";
import { REGIME_LABEL } from "@/lib/autotrader-pro/regime";
import { strategyById } from "@/lib/autotrader-pro/strategies";
import type { ScanResult } from "@/lib/autotrader-pro/engine";
import type { FrameSummary } from "@/lib/autotrader-pro/timeframes";
import type { SymbolScan } from "@/lib/autotrader-pro/useAutoTraderPro";
import type { Signal } from "@/lib/autotrader-pro/types";
import { ago, fmt, Panel, pct, sideTone, StageBadge, Stat, Strength } from "./ui-bits";

export type ExecuteFn = (symbol: string, s: Signal, count: number) => Promise<{ ok: boolean; message: string }>;

/**
 * Execution controls in the market condition card: the MetaTrader account sensed from the Metatrader tab,
 * the number of trades (required before anything is sent), and the single Execute button.
 */
function ExecutionBox({ s, symbol, lots, onExecute }: { s?: Signal; symbol: string; lots?: number; onExecute: ExecuteFn }) {
  const portal = usePortalStore();
  const { tradeCount } = useProState();
  const account = connectedAccount(portal);
  const [countText, setCountText] = useState(tradeCount ? String(tradeCount) : "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const count = parseTradeCount(countText);
  // A new signal always needs a fresh confirmation.
  useEffect(() => setConfirm(false), [s?.id]);
  const buy = s?.side === "BUY";
  const tone = buy ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground";
  const onCount = (v: string) => { setCountText(v); setConfirm(false); proActions.setTradeCount(parseTradeCount(v)); };
  const run = async () => {
    if (!s || !count) return;
    setBusy(true); setRes(null);
    try { setRes(await onExecute(symbol, s, count)); } finally { setBusy(false); setConfirm(false); }
  };
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground">MetaTrader account</span>
        {account
          ? <span className="flex min-w-0 items-center gap-1.5 font-semibold text-primary"><Link2 className="size-3.5 shrink-0" /><span className="truncate">{account.label}</span></span>
          : <Link to="/ios" className="font-semibold text-destructive underline">Not connected — connect it</Link>}
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">Number of trades</span>
        <Input type="number" inputMode="numeric" min={1} max={MAX_TRADES_PER_EXECUTION} step={1} value={countText} onChange={(e) => onCount(e.target.value)}
          placeholder={`1–${MAX_TRADES_PER_EXECUTION}`} aria-label="Number of trades" className="h-9 w-24 text-center font-mono" />
      </label>
      {!count && <p className="text-[11px] text-muted-foreground">Enter how many trades to open (1–{MAX_TRADES_PER_EXECUTION}) before executing. Live mode uses the same number.</p>}
      {!s ? (
        <p className="text-xs text-muted-foreground">Waiting for a signal to execute…</p>
      ) : !confirm ? (
        <button type="button" disabled={busy || !count || !account} onClick={() => { setRes(null); setConfirm(true); }}
          className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold ${tone} disabled:opacity-50`}>
          <Zap className="size-4" /> Execute {count ?? ""} {s.side} {symbol}
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-background/60 p-2.5">
          <p className="text-xs">Send <span className="font-bold">{count} real {s.side}</span> order{count === 1 ? "" : "s"} for {symbol}{lots ? ` (${lots} lots each or your pair lot size)` : ""} to {account?.label}, with stop loss {fmt(s.stopLoss)} and take profit {fmt(s.takeProfit)}?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="rounded-lg bg-secondary py-2 text-sm font-semibold">Cancel</button>
            <button type="button" disabled={busy} onClick={run} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-bold ${tone} disabled:opacity-60`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />} Confirm
            </button>
          </div>
        </div>
      )}
      {res && <p className={`rounded-lg px-3 py-2 text-xs ${res.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>{res.message}</p>}
    </div>
  );
}

function SignalDetail({ s, now, primary }: { s: Signal; now: number; primary?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${primary ? "border-primary/60 bg-secondary/60" : "border-border bg-secondary/30"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StageBadge stage={s.stage} side={s.side} />
          <span className="text-sm font-semibold">{s.strategyName}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Strength value={s.strength} /> score {s.confidence}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Entry" value={fmt(s.entry)} />
        <Stat label="Stop loss" value={fmt(s.stopLoss)} tone="text-destructive" />
        <Stat label="Take profit" value={fmt(s.takeProfit)} tone="text-primary" />
        <Stat label="Risk : reward" value={`1 : ${s.rr.toFixed(2)}`} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Entry zone {fmt(s.entryZone[0])} – {fmt(s.entryZone[1])} · {ago(s.timestamp, now)} · expires {new Date(s.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      <p className="mt-2 text-sm">{s.reason}</p>
      <ul className="mt-2 space-y-1 text-xs">
        {s.confirmations.map((c) => <li key={c} className="flex gap-1.5"><CircleCheck className="size-3.5 shrink-0 text-primary mt-px" />{c}</li>)}
        {s.missing.map((c) => <li key={c} className="flex gap-1.5 text-muted-foreground"><CircleDashed className="size-3.5 shrink-0 mt-px" />{c}</li>)}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">Invalidation:</span> {s.invalidation}</p>
    </div>
  );
}

/** Each strategy votes once (its strongest setup); the side most strategies agree on leads, using its best-scored plan. */
export function strategyConsensus(cands: Signal[]) {
  const per = new Map<string, Signal>();
  for (const c of cands) { const cur = per.get(c.strategy); if (!cur || c.confidence > cur.confidence) per.set(c.strategy, c); }
  const votes = [...per.values()];
  const buy = votes.filter((v) => v.side === "BUY"), sell = votes.filter((v) => v.side === "SELL");
  const side: Signal["side"] | null = buy.length > sell.length ? "BUY" : sell.length > buy.length ? "SELL" : null;
  const group = side === "BUY" ? buy : side === "SELL" ? sell : [];
  const plan = [...group].sort((a, b) => (a.stage === b.stage ? b.confidence - a.confidence : a.stage === "confirmed" ? -1 : 1))[0];
  return { side, buy: buy.length, sell: sell.length, total: votes.length, plan };
}

/** The one signal the market-condition card can execute: the engine's lead signal, else the agreed plan; never an expired one. */
export function marketSignal(r: Pick<ScanResult, "best" | "candidates">, now: number): Signal | undefined {
  const s = r.best ?? strategyConsensus(r.candidates).plan;
  return s && now <= s.expiresAt ? s : undefined;
}

function ConsensusBox({ cands }: { cands: Signal[] }) {
  const c = strategyConsensus(cands);
  const pctBuy = c.total ? Math.round((c.buy / c.total) * 100) : 0;
  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Strategy agreement</span>
        {c.side ? <span className={`text-sm font-black ${sideTone(c.side)}`}>{c.side}</span> : <span className="text-sm font-semibold text-muted-foreground">Split</span>}
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="bg-primary" style={{ width: `${pctBuy}%` }} />
        <div className="bg-destructive" style={{ width: `${c.total ? 100 - pctBuy : 0}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{c.total ? `${c.buy} BUY · ${c.sell} SELL out of ${c.total} strategies with a setup` : "No strategy has a setup on this scan yet"}</p>
      {c.plan && (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat label="Entry" value={fmt(c.plan.entry)} />
            <Stat label="Stop loss" value={fmt(c.plan.stopLoss)} tone="text-destructive" />
            <Stat label="Take profit" value={fmt(c.plan.takeProfit)} tone="text-primary" />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">{c.plan.stage === "confirmed" ? "Confirmed" : "Early"} plan from {c.plan.strategyName} · score {c.plan.confidence} · 1 : {c.plan.rr.toFixed(2)}</p>
        </>
      )}
    </div>
  );
}

/** Every timeframe scanned automatically, with the one the scanner is acting on highlighted. */
function FrameStrip({ frames, chosen }: { frames: FrameSummary[]; chosen?: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Timeframes scanned">
      {frames.map((f) => (
        <span key={f.interval} title={f.error} className={`rounded-full border px-2 py-0.5 text-[11px] ${f.interval === chosen ? "border-primary bg-primary/10 font-semibold" : "border-border text-muted-foreground"}`}>
          {f.interval} {f.error ? "· no data" : f.side ? <span className={sideTone(f.side)}>{f.side} {f.confidence}</span> : "· no setup"}
        </span>
      ))}
    </div>
  );
}

export function MarketPanel({ scan, now, onExecute }: { scan?: SymbolScan; now: number; onExecute?: ExecuteFn }) {
  if (!scan) return <Panel title="Market scan"><p className="text-sm text-muted-foreground">Press Start scanning to read the market.</p></Panel>;
  if (scan.error || !scan.result) {
    return (
      <Panel title={`${scan.symbol} · market scan`}>
        <div className="flex gap-2 text-sm"><AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" /><p>{scan.error ?? "No data"}</p></div>
        {scan.tv && <p className="mt-3 text-xs text-muted-foreground">TradingView technical rating (cross-check only): <span className="font-semibold text-foreground">{scan.tv.label}</span></p>}
      </Panel>
    );
  }
  const r = scan.result, m = r.market;
  const best = r.best;
  const toExecute = onExecute ? marketSignal(r, now) : undefined;
  return (
    <div className="space-y-3">
      <Panel title={`${scan.symbol} · market condition`} right={<span className="text-[10px] text-muted-foreground">{scan.source} · {ago(scan.at, now)}</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Timeframe" value={scan.interval ? `${scan.interval} · auto` : "auto"} />
          <Stat label="Condition" value={REGIME_LABEL[m.regime]} />
          <Stat label="Trend" value={m.trend} tone={m.trend === "bullish" ? "text-primary" : m.trend === "bearish" ? "text-destructive" : ""} />
          <Stat label="Volatility" value={`${m.volatility} · ${pct(m.atrRank)}`} />
          <Stat label="Price" value={fmt(scan.price)} />
          <Stat label="ATR" value={fmt(m.atr)} />
          <Stat label="ADX" value={m.adx.toFixed(1)} />
          <Stat label="Spread" value={scan.spread !== undefined ? fmt(scan.spread) : "n/a"} />
          <Stat label="TradingView" value={scan.tv?.label ?? "—"} />
        </div>
        {scan.frames && <FrameStrip frames={scan.frames} chosen={scan.interval} />}
        {m.notes.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{m.notes.join(" · ")}</p>}
        <ConsensusBox cands={r.candidates} />
        {onExecute && <ExecutionBox s={toExecute} symbol={scan.symbol} lots={scan.size?.lots} onExecute={onExecute} />}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {r.active.map((id) => <span key={id} className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{strategyById(id).letter} · {strategyById(id).name}</span>)}
          {r.inactive.map((x) => <span key={x.id} title={x.why} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{strategyById(x.id).letter} · {strategyById(x.id).name}</span>)}
        </div>
      </Panel>

      <Panel title="Signal" right={<span className="text-[10px] text-muted-foreground">Score = setup quality, not a win probability</span>}>
        <p className="mb-3 text-sm">{r.summary}</p>
        {r.conflict && <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs">{r.conflict}</p>}
        {best ? <SignalDetail s={best} now={now} primary /> : (
          <div className="rounded-xl border border-dashed border-border p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold"><Radar className="size-4 text-primary" />No confirmed entry yet — what is holding it back:</div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(r.candidates[0]?.missing ?? []).slice(0, 4).map((x) => <li key={x}>• {x}</li>)}
              {r.blockers.slice(0, 5).map((b) => <li key={b.strategy + b.text}>• {strategyById(b.strategy).letter}: {b.text}</li>)}
            </ul>
          </div>
        )}
        {scan.gate && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${scan.gate.ok ? "bg-primary/10" : "bg-destructive/10"}`}>
            <span className="font-semibold">{scan.gate.ok ? "Risk checks passed" : "Entry blocked by risk controls"}</span>
            {scan.size && <span className="text-muted-foreground"> · size {scan.size.lots} lots ({scan.size.note})</span>}
            {scan.gate.reasons.map((x) => <div key={x}>• {x}</div>)}
          </div>
        )}
      </Panel>

      {(r.early.length > 0 || r.watchlist.length > 0) && (
        <Panel title="Early signals & watchlist" right={<Eye className="size-4 text-muted-foreground" />}>
          <div className="space-y-2">
            {r.early.map((s) => <SignalDetail key={s.id} s={s} now={now} />)}
            {r.watchlist.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
                <span><span className={`font-bold ${sideTone(s.side)}`}>{s.side}</span> · {s.strategyName} <span className="text-muted-foreground">— potential setup: {s.missing[0] ?? "score below threshold"}</span></span>
                <span className="flex items-center gap-1.5 shrink-0"><Strength value={s.strength} />{s.confidence}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
