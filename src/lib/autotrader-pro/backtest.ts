import type { Series } from "./indicators";
import { classifyMarket } from "./regime";
import { targetPlan, turningPoints } from "./targets";
import { manageTrade, planLevels, type ManagedTrade, type RiskSettings } from "./risk";
import { sessionOpen, type EngineSettings, type StrategyPerf } from "./engine";
import type { Params, StrategyDef } from "./strategies";
import type { Regime, Side } from "./types";

export interface BtTrade { side: Side; entryAt: number; exitAt: number; entry: number; exit: number; r: number; plannedRR: number; regime: Regime; exitReason: string }
export interface BtMetrics {
  trades: number; wins: number; losses: number; winRate: number; profitFactor: number;
  expectancyR: number; netR: number; maxDrawdownR: number; avgPlannedRR: number;
  byRegime: Partial<Record<Regime, { trades: number; winRate: number; expectancyR: number }>>;
}

export const WARMUP = 60;

export function metrics(trades: BtTrade[]): BtMetrics {
  const wins = trades.filter((t) => t.r > 0.02).length;
  const losses = trades.filter((t) => t.r < -0.02).length;
  const gw = trades.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0);
  const gl = -trades.filter((t) => t.r < 0).reduce((a, t) => a + t.r, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const byRegime: BtMetrics["byRegime"] = {};
  for (const t of trades) {
    const g = (byRegime[t.regime] ??= { trades: 0, winRate: 0, expectancyR: 0 });
    g.trades++; g.winRate += t.r > 0.02 ? 1 : 0; g.expectancyR += t.r;
  }
  for (const g of Object.values(byRegime)) if (g) { g.winRate /= g.trades; g.expectancyR /= g.trades; }
  const n = trades.length;
  return {
    trades: n, wins, losses, winRate: n ? wins / n : 0,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    expectancyR: n ? eq / n : 0, netR: eq, maxDrawdownR: dd,
    avgPlannedRR: n ? trades.reduce((a, t) => a + t.plannedRR, 0) / n : 0,
    byRegime,
  };
}

/**
 * Bar-by-bar backtest of one strategy without look-ahead: the decision on bar i uses bars 0..i only,
 * the trade fills at the next bar's open (plus slippage) and exits are simulated bar by bar,
 * taking the stop first whenever a bar touches both stop and target. Results are in R (multiples of initial risk).
 */
export function backtestStrategy(s: Series, def: StrategyDef, params: Params, risk: RiskSettings, sessions: EngineSettings["sessions"], from = WARMUP, to = s.candles.length) {
  const trades: BtTrade[] = [];
  const c = s.candles;
  let i = Math.max(from, WARMUP);
  while (i < to - 1) {
    const m = classifyMarket(s, i);
    const sess = sessionOpen(sessions, c[i].t);
    const out = def.evaluate(s, i, params, m, { sessionOk: sess.ok, sessionNote: sess.note, maxSpreadAtr: risk.maxSpreadAtr });
    const cand = out.candidate;
    const counter = cand && ((cand.side === "BUY" && m.trend === "bearish") || (cand.side === "SELL" && m.trend === "bullish"));
    if (!cand || cand.stage !== "confirmed" || (counter && !def.reversal) || !(m.atr > 0)) { i++; continue; }
    const d = cand.side === "BUY" ? 1 : -1;
    const lv = planLevels(cand.side, cand.entry, cand.structuralStop, m.atr, m.volatility, risk, cand.structuralTarget, turningPoints(s, i, cand.side), targetPlan(s, i, cand.side, m));
    if (lv.tight) { i++; continue; }
    const fill = c[i + 1].o + d * risk.slippageAtr * m.atr;
    const shift = fill - cand.entry;
    let t: ManagedTrade = { side: cand.side, entry: fill, stopLoss: lv.stopLoss + shift, takeProfit: lv.takeProfit + shift, initialStop: lv.stopLoss + shift, lots: 1, remaining: 1, realized: 0, breakEven: false, partialTaken: false, trailing: false };
    let j = i + 1;
    for (; j < to; j++) {
      t = manageTrade(t, c[j], s.atr[j], risk, 1);
      if (t.closed) break;
    }
    if (!t.closed) { // still open at the end of the data: mark to the last close
      const last = c[to - 1];
      t = { ...t, realized: t.realized + (last.c - t.entry) * d * t.remaining, closed: { price: last.c, reason: "End of data", at: last.t } };
      j = to - 1;
    }
    const riskDist = Math.abs(fill - t.initialStop);
    const cost = risk.slippageAtr * m.atr; // exit slippage
    trades.push({ side: cand.side, entryAt: c[i + 1].t, exitAt: t.closed!.at, entry: fill, exit: t.closed!.price, r: riskDist > 0 ? (t.realized - cost) / riskDist : 0, plannedRR: lv.rr, regime: m.regime, exitReason: t.closed!.reason });
    i = j + 1;
  }
  return { trades, metrics: metrics(trades) };
}

function combos(grid: Record<string, number[]>): Params[] {
  let out: Params[] = [{}];
  for (const [k, vals] of Object.entries(grid)) out = out.flatMap((p) => vals.map((v) => ({ ...p, [k]: v })));
  return out;
}

export interface WalkForwardResult {
  strategy: StrategyDef["id"];
  inSample: BtMetrics;
  outOfSample: BtMetrics;
  full: BtMetrics;
  chosen: Params;
  overfit: boolean;
  underperforming: boolean;
  verdict: string;
}

const MIN_TRAIN_TRADES = 4;

/**
 * Anchored walk-forward: for each fold, parameters are chosen on earlier data only and then tested
 * on the following unseen segment. Defaults win ties (a change must beat them by 0.05 R) to limit overfitting.
 */
export function walkForward(s: Series, def: StrategyDef, risk: RiskSettings, sessions: EngineSettings["sessions"], folds = 4): WalkForwardResult {
  const n = s.candles.length;
  const seg = Math.floor((n - WARMUP) / (folds + 1));
  const grid = combos(def.grid);
  const oos: BtTrade[] = [], is: BtTrade[] = [];
  let chosen: Params = { ...def.defaults };
  for (let k = 1; k <= folds && seg > 10; k++) {
    const trainEnd = WARMUP + seg * k, testEnd = k === folds ? n : trainEnd + seg;
    const base = backtestStrategy(s, def, def.defaults, risk, sessions, WARMUP, trainEnd);
    let pick: Params = { ...def.defaults }, pickM = base.metrics, pickTrades = base.trades;
    for (const g of grid) {
      const p = { ...def.defaults, ...g };
      const r = backtestStrategy(s, def, p, risk, sessions, WARMUP, trainEnd);
      if (r.metrics.trades >= MIN_TRAIN_TRADES && r.metrics.expectancyR > pickM.expectancyR + 0.05) { pick = p; pickM = r.metrics; pickTrades = r.trades; }
    }
    is.push(...pickTrades);
    oos.push(...backtestStrategy(s, def, pick, risk, sessions, trainEnd, testEnd).trades);
    chosen = pick;
  }
  const full = backtestStrategy(s, def, chosen, risk, sessions).metrics;
  const inSample = metrics(is), outOfSample = metrics(oos);
  const overfit = inSample.trades > 0 && outOfSample.trades > 0 && inSample.expectancyR - outOfSample.expectancyR > 0.3;
  const underperforming = outOfSample.trades >= 15 && (outOfSample.expectancyR < 0 || outOfSample.profitFactor < 1);
  const verdict = outOfSample.trades < 15
    ? `Only ${outOfSample.trades} out-of-sample trades — not enough data to judge`
    : underperforming ? "Underperforming out of sample — excluded from automatic selection"
      : overfit ? "Positive but weaker out of sample — possible overfitting"
        : `Positive out-of-sample expectancy (${outOfSample.expectancyR.toFixed(2)} R) on this data — past results do not guarantee future results`;
  return { strategy: def.id, inSample, outOfSample, full, chosen: overfit || underperforming ? { ...def.defaults } : chosen, overfit, underperforming, verdict };
}

export const perfFromWalkForward = (w: WalkForwardResult): StrategyPerf => ({
  trades: w.outOfSample.trades, winRate: w.outOfSample.winRate, expectancyR: w.outOfSample.expectancyR,
  profitFactor: w.outOfSample.profitFactor, underperforming: w.underperforming,
});
