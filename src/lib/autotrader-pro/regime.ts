import { finite, type Series } from "./indicators";
import type { MarketRead, Regime, TrendClass, VolatilityClass } from "./types";

export const REGIME_LABEL: Record<Regime, string> = {
  strong_bull: "Strong bullish trend",
  strong_bear: "Strong bearish trend",
  ranging: "Sideways / ranging",
  high_volatility: "High volatility",
  low_volatility: "Low volatility",
  breakout: "Breakout",
  reversal: "Reversal",
};

/** Rank of the latest ATR among the previous `n` values (0..1). Only past bars are used. */
export function atrRank(s: Series, i: number, n = 100) {
  const now = s.atr[i];
  if (!Number.isFinite(now)) return 0.5;
  let below = 0, count = 0;
  for (let j = Math.max(0, i - n); j < i; j++) {
    const v = s.atr[j];
    if (!Number.isFinite(v)) continue;
    count++;
    if (v < now) below++;
  }
  return count ? below / count : 0.5;
}

/** Highest high / lowest low of the `n` bars before i (excludes bar i). */
export function priorRange(s: Series, i: number, n: number) {
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - n); j < i; j++) { hi = Math.max(hi, s.candles[j].h); lo = Math.min(lo, s.candles[j].l); }
  return { hi, lo };
}

/**
 * Classifies the market at bar i using only bars 0..i.
 * The primary regime is chosen by priority (breakout and reversal events first, then trend, then volatility, then range).
 */
export function classifyMarket(s: Series, i: number): MarketRead {
  const c = s.candles[i];
  const a = s.atr[i], adxV = Number.isFinite(s.adx[i]) ? s.adx[i] : 20;
  const notes: string[] = [];
  const e9 = s.ema9[i], e21 = s.ema21[i], e50 = s.ema50[i], e200 = s.ema200[i];
  const slope = i >= 10 && finite(e50, s.ema50[i - 10], a) && a > 0 ? (e50 - s.ema50[i - 10]) / a : 0;
  const bullStack = finite(e9, e21, e50) && e9 > e21 && e21 > e50 && (!Number.isFinite(e200) || e50 > e200);
  const bearStack = finite(e9, e21, e50) && e9 < e21 && e21 < e50 && (!Number.isFinite(e200) || e50 < e200);
  const rank = atrRank(s, i);
  const volatility: VolatilityClass = rank >= 0.95 ? "extreme" : rank >= 0.75 ? "high" : rank <= 0.2 ? "low" : "normal";

  let trend: TrendClass = "neutral";
  if (finite(e21, e50) && c.c > e50 && e21 > e50 && slope > 0.15) trend = "bullish";
  else if (finite(e21, e50) && c.c < e50 && e21 < e50 && slope < -0.15) trend = "bearish";

  const tags: Regime[] = [];
  const range = priorRange(s, i, 20);
  const brokeUp = Number.isFinite(range.hi) && c.c > range.hi;
  const brokeDown = Number.isFinite(range.lo) && c.c < range.lo;
  if (brokeUp || brokeDown) { tags.push("breakout"); notes.push(`Close ${brokeUp ? "above" : "below"} the 20-bar ${brokeUp ? "high" : "low"}`); }

  // Reversal: a stretched move where momentum has flipped against the slower trend.
  const r = s.rsi[i], hist = s.macdHist[i], histPrev = s.macdHist[i - 1];
  const turnedDown = finite(r, hist, histPrev) && trend !== "bearish" && Number.isFinite(e50) && c.c > e50 && r > 62 && hist < 0 && histPrev >= 0;
  const turnedUp = finite(r, hist, histPrev) && trend !== "bullish" && Number.isFinite(e50) && c.c < e50 && r < 38 && hist > 0 && histPrev <= 0;
  if (turnedDown || turnedUp) { tags.push("reversal"); notes.push(`Momentum turned ${turnedUp ? "up from a sell-off" : "down after a rally"}`); }

  if (adxV >= 25 && bullStack && trend === "bullish") { tags.push("strong_bull"); notes.push(`EMA 9/21/50 stacked up, ADX ${adxV.toFixed(0)}`); }
  else if (adxV >= 25 && bearStack && trend === "bearish") { tags.push("strong_bear"); notes.push(`EMA 9/21/50 stacked down, ADX ${adxV.toFixed(0)}`); }

  if (volatility === "high" || volatility === "extreme") { tags.push("high_volatility"); notes.push(`ATR in the top ${Math.round((1 - rank) * 100)}% of the last 100 bars`); }
  if (volatility === "low") { tags.push("low_volatility"); notes.push("ATR near its quietest level — compression"); }

  if (adxV < 20 && !tags.includes("breakout") && trend === "neutral") { tags.push("ranging"); notes.push(`ADX ${adxV.toFixed(0)}: no directional strength`); }
  if (!tags.length) tags.push(trend !== "neutral" && adxV >= 20 ? (trend === "bullish" ? "strong_bull" : "strong_bear") : "ranging");

  return { regime: tags[0], tags, trend, volatility, atr: Number.isFinite(a) ? a : 0, atrRank: rank, adx: adxV, notes };
}
