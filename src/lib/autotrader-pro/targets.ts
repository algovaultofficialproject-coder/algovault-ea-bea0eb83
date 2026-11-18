import { knownSwings, type Series } from "./indicators";
import { priorRange } from "./regime";
import type { MarketRead, Side } from "./types";

/**
 * Price levels where the market is likely to turn against a trade, using only bars 0..i:
 * confirmed swing highs/lows, the 50- and 100-bar extremes, the upper/lower Bollinger band and EMA 200.
 * For a BUY these are levels above the entry (resistance); for a SELL levels below (support).
 */
export function turningPoints(s: Series, i: number, side: Side): number[] {
  const d = side === "BUY" ? 1 : -1;
  const entry = s.candles[i].c;
  const out: number[] = [];
  for (const sw of knownSwings(s, i, d > 0 ? "high" : "low", 8, 150)) out.push(sw.price);
  for (const n of [50, 100]) {
    const r = priorRange(s, i, n);
    out.push(d > 0 ? r.hi : r.lo);
  }
  const mid = s.bbMid[i], sd = s.bbSd[i];
  if (Number.isFinite(mid) && Number.isFinite(sd)) out.push(mid + d * 2 * sd);
  if (Number.isFinite(s.ema200[i])) out.push(s.ema200[i]);
  return out.filter((x) => Number.isFinite(x) && (x - entry) * d > 0);
}

/** Ways AutoTrader Pro sets its take profit (and the stop that goes with it), chosen from the market. */
export type TargetMethod = "trend_swing" | "measured_move" | "range_mean" | "reversion_mean" | "volatility_quick" | "compression_atr" | "counter_quick";

export interface TargetPlan {
  method: TargetMethod;
  label: string;
  /** The target never sits further than this many ATR from entry (the stop is tightened to fit). */
  capAtr: number;
  /** Reward-to-risk aimed for before turning points and caps are applied. */
  rr: number;
  /** A market-derived target price (measured move, range middle, mean); undefined = RR/ATR target. */
  target?: number;
}

/** Per-method target cap in ATR — every method stays close to price. */
export const TARGET_CAP_ATR: Record<TargetMethod, number> = {
  trend_swing: 3.5, measured_move: 3.5, range_mean: 2.5, reversion_mean: 2.8, volatility_quick: 3, compression_atr: 2.2, counter_quick: 2,
};

const firstAhead = (entry: number, d: number, xs: number[]) =>
  xs.filter((x) => Number.isFinite(x) && (x - entry) * d > 0).sort((a, b) => (a - entry) * d - (b - entry) * d)[0];

/**
 * Picks the stop/target method for the market at bar i (bars 0..i only):
 * - breakout: measured move — 60% of the broken 20-bar range height projected from entry
 * - reversal: reversion — the first of EMA 21 / Bollinger middle ahead
 * - strong trend with the trade: trend swing — RR target, pulled in front of the next swing
 * - strong trend against the trade: counter quick — small 1.2R grab
 * - ranging: range mean — Bollinger middle or 50-bar range middle ahead
 * - high volatility: volatility quick — 1.3R, capped at 2 ATR
 * - low volatility: compression — 1.5R, capped at 1.5 ATR
 */
export function targetPlan(s: Series, i: number, side: Side, market: MarketRead): TargetPlan {
  const d = side === "BUY" ? 1 : -1;
  const entry = s.candles[i].c;
  const plan = (method: TargetMethod, label: string, rr: number, target?: number): TargetPlan => ({ method, label, capAtr: TARGET_CAP_ATR[method], rr, target });
  const withTrend = (market.trend === "bullish" && d > 0) || (market.trend === "bearish" && d < 0);
  const againstTrend = (market.trend === "bullish" && d < 0) || (market.trend === "bearish" && d > 0);
  switch (market.regime) {
    case "breakout": {
      const r = priorRange(s, i, 20);
      const h = r.hi - r.lo;
      return plan("measured_move", "Measured move", 1.6, Number.isFinite(h) && h > 0 ? entry + d * h * 0.6 : undefined);
    }
    case "reversal":
      return plan("reversion_mean", "Reversion to the mean", 1.5, firstAhead(entry, d, [s.ema21[i], s.bbMid[i]]));
    case "strong_bull":
    case "strong_bear":
      return againstTrend ? plan("counter_quick", "Counter-trend quick target", 1.2) : plan("trend_swing", "Trend swing target", 1.8);
    case "ranging": {
      const r = priorRange(s, i, 50);
      return plan("range_mean", "Range middle", 1.4, firstAhead(entry, d, [s.bbMid[i], (r.hi + r.lo) / 2]));
    }
    case "high_volatility":
      return plan("volatility_quick", "Volatility quick target", 1.3);
    case "low_volatility":
      return plan("compression_atr", "Compression ATR target", 1.5);
    default:
      return withTrend ? plan("trend_swing", "Trend swing target", 1.8) : plan("counter_quick", "Quick target", 1.2);
  }
}
