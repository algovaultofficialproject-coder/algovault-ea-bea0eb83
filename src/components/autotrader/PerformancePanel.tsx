import { useState } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strategyById } from "@/lib/autotrader-pro/strategies";
import { SCAN_BOOK } from "@/lib/autotrader-pro/strategy-policy";
import { perfKey, proActions, useProState } from "@/lib/autotrader-pro/store";
import { accountState, journalPerf } from "@/lib/autotrader-pro/account";
import { useTradeJournal } from "@/lib/trade-log";
import { SCAN_INTERVALS } from "@/lib/autotrader-pro/timeframes";
import type { Interval } from "@/lib/autotrader-pro/types";
import { Panel, pct, Stat } from "./ui-bits";

const pf = (n: number) => (n >= 99 ? "∞" : n.toFixed(2));

export function PerformancePanel({ symbol, runBacktest }: { symbol: string; runBacktest: (s: string) => Promise<void> }) {
  const pro = useProState();
  const journal = useTradeJournal();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tested = SCAN_INTERVALS.map((interval) => ({ interval, key: perfKey(symbol, interval) })).filter((x) => pro.backtests[x.key]);
  const paper = journalPerf(journal, "paper");
  const acct = accountState(journal, "paper", pro.risk, Date.now());
  const dd = acct.peakEquity > 0 ? (acct.peakEquity - acct.equity) / acct.peakEquity : 0;
  const allPaper = Object.values(paper);
  const n = allPaper.reduce((a, p) => a + p.trades, 0);
  const wins = allPaper.reduce((a, p) => a + p.winRate * p.trades, 0);

  async function run() {
    setBusy(true); setErr(null);
    try { await runBacktest(symbol); } catch (e) { setErr(e instanceof Error ? e.message : "Backtest failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <Panel title="Paper trading performance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Equity" value={acct.equity.toFixed(2)} />
          <Stat label="Trades" value={n} />
          <Stat label="Win rate" value={n ? pct(wins / n) : "—"} />
          <Stat label="Drawdown" value={pct(dd)} tone={dd > 0.05 ? "text-destructive" : ""} />
        </div>
        {allPaper.length > 0 && (
          <table className="mt-3 w-full text-xs">
            <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Strategy</th><th>Trades</th><th>Win</th><th>PF</th><th>Exp.</th></tr></thead>
            <tbody>{Object.entries(paper).map(([name, p]) => <tr key={name} className="text-center"><td className="text-left py-1">{name}</td><td>{p.trades}</td><td>{pct(p.winRate)}</td><td>{pf(p.profitFactor)}</td><td className={p.expectancyR >= 0 ? "text-primary" : "text-destructive"}>{p.expectancyR.toFixed(2)}R</td></tr>)}</tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Simulated with your configured account size, slippage and trade management. Once a strategy has 15+ paper trades, its paper results replace the backtest in signal scores.</p>
      </Panel>

      <Panel title={`Backtest · ${symbol} · all timeframes`} right={<Button size="sm" onClick={run} disabled={busy} className="h-8">{busy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}{busy ? "Testing…" : "Run walk-forward"}</Button>}>
        {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
        {tested.length === 0 ? <p className="text-sm text-muted-foreground">No backtest yet. It tests every strategy on every timeframe ({SCAN_INTERVALS.join(", ")}) with up to 1,200 real candles each: parameters are chosen on earlier data and judged only on later, unseen data.</p> : (
          <div className="space-y-4">{tested.map(({ interval, key }) => <BacktestTable key={key} interval={interval} storeKey={key} />)}</div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">Backtests use real historical prices but cannot include your broker's exact spread or fills. Past results do not guarantee future results; no strategy is labelled profitable without measured data.</p>
      </Panel>

      <Panel title="Strategy library">
        <ul className="space-y-2 text-xs">{SCAN_BOOK.map((s) => <li key={s.id}><span className="font-semibold">{s.letter} · {s.name}</span> — {s.description}</li>)}</ul>
      </Panel>
    </div>
  );
}

function BacktestTable({ interval, storeKey: key }: { interval: Interval; storeKey: string }) {
  const pro = useProState();
  const bt = pro.backtests[key];
  if (!bt) return null;
  return (
    <section>
      <p className="mb-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground">{interval}</span> · {bt.candles} candles from {bt.source} · {new Date(bt.at).toLocaleString()} · results in R (multiples of the risk taken)</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="text-muted-foreground"><tr><th className="text-left font-medium">Strategy</th><th>OOS trades</th><th>Win rate</th><th>Profit factor</th><th>Expectancy</th><th>Max DD</th><th>Avg R:R</th><th>In-sample exp.</th></tr></thead>
          <tbody>
            {bt.results.map((r) => (
              <tr key={r.strategy} className={`text-center ${r.underperforming ? "text-destructive" : ""}`}>
                <td className="text-left py-1.5">{strategyById(r.strategy).letter} · {strategyById(r.strategy).name}</td>
                <td>{r.outOfSample.trades}</td><td>{pct(r.outOfSample.winRate)}</td><td>{pf(r.outOfSample.profitFactor)}</td>
                <td className={r.outOfSample.expectancyR >= 0 ? "text-primary" : "text-destructive"}>{r.outOfSample.expectancyR.toFixed(2)}R</td>
                <td>{r.outOfSample.maxDrawdownR.toFixed(1)}R</td><td>{r.outOfSample.avgPlannedRR.toFixed(2)}</td><td className="text-muted-foreground">{r.inSample.expectancyR.toFixed(2)}R</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {bt.results.map((r) => {
          const regimes = Object.entries(r.full.byRegime).filter(([, g]) => g && g.trades >= 3).map(([k, g]) => `${k.replace("_", " ")} ${g!.expectancyR.toFixed(2)}R/${g!.trades}`);
          return <li key={r.strategy}><span className="font-semibold">{strategyById(r.strategy).letter}:</span> {r.verdict}{regimes.length ? ` · by market: ${regimes.join(", ")}` : ""}</li>;
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{pro.optimized[key] ? "Walk-forward parameters are applied to live scanning." : "Default parameters in use."}</span>
        {pro.optimized[key] && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => proActions.clearOptimized(key)}>Use defaults</Button>}
      </div>
    </section>
  );
}
