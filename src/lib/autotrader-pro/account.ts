import type { JournalRecord } from "@/lib/trade-log";
import type { AccountState, RiskSettings } from "./risk";
import type { StrategyPerf } from "./engine";

export const LIVE_ASSUME_OPEN_MS = 4 * 60 * 60 * 1000;
const startOfUtcDay = (now: number) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

/**
 * Account state for the risk gate, rebuilt from the Trade Log journal for one mode.
 * Paper trades carry simulated profit; live trades are broker-managed, so only counts and timing apply to them.
 */
export function accountState(journal: JournalRecord[], mode: "paper" | "live", r: RiskSettings, now: number): AccountState {
  const trades = journal.filter((x) => x.kind === "trade" && x.mode === mode);
  const closed = trades.filter((x) => x.closedAt && typeof x.pnl === "number").sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  const day = startOfUtcDay(now);
  let equity = r.accountSize, peak = r.accountSize;
  for (const t of closed) { equity += t.pnl ?? 0; peak = Math.max(peak, equity); }
  let consecutiveLosses = 0, lastLossAt: number | undefined;
  for (let k = closed.length - 1; k >= 0; k--) {
    if ((closed[k].pnl ?? 0) < 0) { consecutiveLosses++; lastLossAt ??= closed[k].closedAt; } else break;
  }
  return {
    equity, peakEquity: peak,
    dailyPnl: closed.filter((t) => (t.closedAt ?? 0) >= day).reduce((a, t) => a + (t.pnl ?? 0), 0),
    // Live exits are broker-managed and positions are never read, so a live trade counts as open for LIVE_ASSUME_OPEN_MS.
    openTrades: trades.filter((t) => t.outcome === "open" && (mode === "paper" || now - t.ts < LIVE_ASSUME_OPEN_MS)).length,
    tradesToday: trades.filter((t) => t.ts >= day && t.outcome !== "rejected").length,
    consecutiveLosses, lastLossAt,
    lastTradeAt: trades.filter((t) => t.outcome !== "rejected").reduce<number | undefined>((a, t) => Math.max(a ?? 0, t.ts), undefined),
  };
}

/** Measured paper/live performance per strategy name (from closed journal trades with a recorded R multiple). */
export function journalPerf(journal: JournalRecord[], mode: "paper" | "live"): Record<string, StrategyPerf & { netPnl: number }> {
  const out: Record<string, StrategyPerf & { netPnl: number; gw: number; gl: number; wins: number; sumR: number }> = {};
  for (const t of journal) {
    if (t.kind !== "trade" || t.mode !== mode || typeof t.rMultiple !== "number") continue;
    const g = (out[t.strategy] ??= { trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0, underperforming: false, netPnl: 0, gw: 0, gl: 0, wins: 0, sumR: 0 });
    g.trades++; g.sumR += t.rMultiple; g.netPnl += t.pnl ?? 0;
    if (t.rMultiple > 0) { g.wins++; g.gw += t.rMultiple; } else g.gl -= t.rMultiple;
  }
  for (const g of Object.values(out)) {
    g.winRate = g.wins / g.trades; g.expectancyR = g.sumR / g.trades;
    g.profitFactor = g.gl > 0 ? g.gw / g.gl : g.gw > 0 ? 99 : 0;
    g.underperforming = g.trades >= 15 && (g.expectancyR < 0 || g.profitFactor < 1);
  }
  return out;
}

export type BreakdownKey = "symbol" | "session" | "volatility";
export interface GroupPerf { trades: number; winRate: number; profitFactor: number; expectancyR: number; netPnl: number }

/** UTC trading session a timestamp falls in. */
export function sessionOf(ts: number): "Asia" | "London" | "New York" | "Off-hours" {
  const h = new Date(ts).getUTCHours();
  return h < 7 ? "Asia" : h < 13 ? "London" : h < 21 ? "New York" : "Off-hours";
}

/** Closed paper/live trade results grouped by symbol, session (UTC, by entry time) or the volatility recorded at entry. */
export function performanceBreakdown(journal: JournalRecord[], mode: "paper" | "live", by: BreakdownKey): Record<string, GroupPerf> {
  const acc: Record<string, { n: number; w: number; gw: number; gl: number; r: number; pnl: number }> = {};
  for (const t of journal) {
    if (t.kind !== "trade" || t.mode !== mode || typeof t.rMultiple !== "number") continue;
    const key = by === "symbol" ? t.symbol : by === "session" ? sessionOf(t.ts) : (/(low|normal|high|extreme) volatility/i.exec(t.market ?? "")?.[1]?.toLowerCase() ?? "unknown");
    const g = (acc[key] ??= { n: 0, w: 0, gw: 0, gl: 0, r: 0, pnl: 0 });
    g.n++; g.r += t.rMultiple; g.pnl += t.pnl ?? 0;
    if (t.rMultiple > 0) { g.w++; g.gw += t.rMultiple; } else g.gl -= t.rMultiple;
  }
  const out: Record<string, GroupPerf> = {};
  for (const [k, g] of Object.entries(acc)) out[k] = { trades: g.n, winRate: g.w / g.n, expectancyR: g.r / g.n, profitFactor: g.gl > 0 ? g.gw / g.gl : g.gw > 0 ? 99 : 0, netPnl: g.pnl };
  return out;
}
