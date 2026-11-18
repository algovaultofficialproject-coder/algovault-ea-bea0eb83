import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { tradeLog, useTradeJournal, type JournalRecord } from "@/lib/trade-log";
import { proActions, useProState } from "@/lib/autotrader-pro/store";
import { LIVE_ASSUME_OPEN_MS } from "@/lib/autotrader-pro/account";
import type { SymbolScan } from "@/lib/autotrader-pro/useAutoTraderPro";
import { ago, fmt, Panel, sideTone } from "./ui-bits";

const OUTCOME_TONE: Record<string, string> = { win: "text-primary", loss: "text-destructive", open: "text-foreground", signal: "text-muted-foreground" };

function Row({ r, now }: { r: JournalRecord; now: number }) {
  return (
    <li className="rounded-lg bg-secondary/40 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate"><span className={`font-bold ${sideTone(r.side === "SELL" ? "SELL" : "BUY")}`}>{r.side}</span> {r.symbol} · {r.strategy}{r.stage ? ` · ${r.stage}` : ""}</span>
        <span className={`shrink-0 font-semibold uppercase ${OUTCOME_TONE[r.outcome] ?? "text-muted-foreground"}`}>{r.mode} · {r.outcome}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
        in {fmt(r.entry)} · SL {typeof r.stopLoss === "number" ? fmt(r.stopLoss) : r.stopLoss ?? "—"} · TP {typeof r.takeProfit === "number" ? fmt(r.takeProfit) : r.takeProfit ?? "—"}
        {r.exit !== undefined && ` · out ${fmt(r.exit)}`}{r.pnl !== undefined && ` · P/L ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}`}{r.rMultiple !== undefined && ` (${r.rMultiple}R)`}
        {r.confidence !== undefined && ` · score ${r.confidence}`} · {ago(r.ts, now)}
      </div>
      {r.market && <div className="mt-1 text-[11px] text-muted-foreground">{r.market}</div>}
      {r.reasonEntry && <div className="mt-1 text-[11px]">Entry: {r.reasonEntry}</div>}
      {r.reasonExit && <div className="mt-0.5 text-[11px]">Exit: {r.reasonExit}</div>}
    </li>
  );
}

export function TradesPanel({ scans, now }: { scans: Record<string, SymbolScan>; now: number }) {
  const journal = useTradeJournal();
  const pro = useProState();
  const rows = useMemo(() => [...journal].reverse(), [journal]);
  const trades = rows.filter((r) => r.kind === "trade" && r.outcome !== "signal");
  const signals = rows.filter((r) => r.kind === "signal");
  const liveOpen = trades.filter((r) => r.mode === "live" && r.outcome === "open" && now - r.ts < LIVE_ASSUME_OPEN_MS);
  return (
    <div className="space-y-3">
      <Panel title="Active trades">
        {pro.paper.length === 0 && liveOpen.length === 0 && <p className="text-sm text-muted-foreground">No open trades.</p>}
        <ul className="space-y-2">
          {pro.paper.map((p) => {
            const price = scans[p.symbol]?.price;
            const d = p.managed.side === "BUY" ? 1 : -1;
            const open = price !== undefined ? (price - p.managed.entry) * d * p.managed.lots * p.managed.remaining * p.contract : 0;
            const total = open + p.managed.realized;
            return (
              <li key={p.journalId} className="rounded-lg border border-border px-3 py-2 text-xs">
                <div className="flex justify-between gap-2"><span><span className={`font-bold ${sideTone(p.managed.side)}`}>{p.managed.side}</span> {p.symbol} · {p.strategyName} · paper</span><span className={`font-mono font-semibold ${total >= 0 ? "text-primary" : "text-destructive"}`}>{total >= 0 ? "+" : ""}{total.toFixed(2)}</span></div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">in {fmt(p.managed.entry)} · SL {fmt(p.managed.stopLoss)} · TP {fmt(p.managed.takeProfit)} · {p.managed.lots} lots · {Math.round(p.managed.remaining * 100)}% open</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{[p.managed.breakEven && "break-even set", p.managed.partialTaken && "partial taken", p.managed.trailing && "trailing"].filter(Boolean).join(" · ") || "initial stop"}</div>
              </li>
            );
          })}
          {liveOpen.map((r) => <Row key={r.id} r={r} now={now} />)}
        </ul>
        {liveOpen.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Live trades are closed by the broker at their stop or target; check MetaTrader for the final result.</p>}
      </Panel>

      <Panel title="Trade history" right={trades.length > 0 ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { if (confirm("Clear the saved signal and trade history on this device?")) { tradeLog.clearJournal(); proActions.setPaper([]); } }}>Clear</Button> : undefined}>
        {trades.length === 0 ? <p className="text-sm text-muted-foreground">No trades recorded yet.</p> : <ul className="space-y-2">{trades.slice(0, 40).map((r) => <Row key={r.id} r={r} now={now} />)}</ul>}
      </Panel>

      <Panel title="Recent signals">
        {signals.length === 0 ? <p className="text-sm text-muted-foreground">No signals recorded yet.</p> : <ul className="space-y-2">{signals.slice(0, 40).map((r) => <Row key={r.id} r={r} now={now} />)}</ul>}
      </Panel>
    </div>
  );
}
