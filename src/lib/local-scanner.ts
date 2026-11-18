import type { AutoChart, ChartCandle } from "@/lib/auto-chart";
import { movementLevels } from "./market-levels";

export type LocalSignal = {
  side: "BUY" | "SELL";
  stopLoss: number;
  takeProfit: number;
  confidencePct: number;
  structure: string;
  confluences: string[];
  /** True only when a confirmed fast-pullback entry is present right now. */
  ready: boolean;
  executionNote?: string;
};

const emaSeries = (xs: number[], n: number) => {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let e = xs[0] ?? 0;
  for (const x of xs) { e = x * k + e * (1 - k); out.push(e); }
  return out;
};

function rsi(closes: number[], n = 14) {
  if (closes.length <= n) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function swings(c: ChartCandle[], w = 3) {
  const hi: number[] = [], lo: number[] = [];
  for (let i = w; i < c.length - w; i++) {
    const win = c.slice(i - w, i + w + 1);
    if (c[i].high === Math.max(...win.map((x) => x.high))) hi.push(c[i].high);
    if (c[i].low === Math.min(...win.map((x) => x.low))) lo.push(c[i].low);
  }
  return { hi, lo };
}

/**
 * Fast-pullback trend scanner (no AI credits). Trades only WITH the trend:
 * EMA20/50 trend on 1m agreeing with H1 bias, a quick 1–5 bar pullback into
 * the EMA20 zone, then a confirmation candle that closes back in the trend
 * direction beyond the previous bar. Stop sits just past the pullback extreme,
 * target is at least 1.8R (or the next liquidity pool if further).
 */
export function localScan(chart: AutoChart): LocalSignal {
  const c = chart.m1;
  const last = c.at(-1)!, prev = c.at(-2)!;
  const price = last.close;
  const closes = c.map((x) => x.close);
  const e20s = emaSeries(closes, 20), e50s = emaSeries(closes, 50);
  const e20 = e20s.at(-1)!, e50 = e50s.at(-1)!;
  const atr = c.slice(-14).reduce((a, x) => a + (x.high - x.low), 0) / 14 || price * 0.0005;

  const h = chart.h1.map((x) => x.close);
  const h1Bias = h.length > 30 ? (h.at(-1)! > emaSeries(h, 20).at(-1)! ? 1 : -1) : 0;
  const trend = e20 > e50 && e20s.at(-1)! > e20s.at(-6)! ? 1 : e20 < e50 && e20s.at(-1)! < e20s.at(-6)! ? -1 : 0;
  const side: "BUY" | "SELL" = (trend || h1Bias || (e20 >= e50 ? 1 : -1)) > 0 ? "BUY" : "SELL";
  const s = side === "BUY" ? 1 : -1;

  const why: string[] = [];
  let score = 0;
  const add = (w: number, t: string) => { score += w; why.push(t); };

  if (trend === s) add(2, side === "BUY" ? "1m uptrend (EMA20 > EMA50, rising)" : "1m downtrend (EMA20 < EMA50, falling)");
  if (h1Bias === s) add(2, side === "BUY" ? "H1 bias bullish" : "H1 bias bearish");

  const { hi, lo } = swings(c.slice(-80));
  let structure = "range";
  if (hi.length >= 2 && lo.length >= 2) {
    const hh = hi.at(-1)! > hi.at(-2)!, hl = lo.at(-1)! > lo.at(-2)!;
    if (hh && hl) structure = "bullish HH/HL"; else if (!hh && !hl) structure = "bearish LH/LL";
    if ((s > 0 && hh && hl) || (s < 0 && !hh && !hl)) add(1, `Structure ${structure}`);
  }

  // Fast pullback: within the last 5 bars price dipped into the EMA20 zone without breaking EMA50 badly.
  const pb = c.slice(-6, -1);
  const pbExtreme = s > 0 ? Math.min(...pb.map((x) => x.low)) : Math.max(...pb.map((x) => x.high));
  const touched = s > 0 ? pbExtreme <= e20 + atr * 0.3 && pbExtreme > e50 - atr * 1.2
                        : pbExtreme >= e20 - atr * 0.3 && pbExtreme < e50 + atr * 1.2;
  if (touched) add(2, "Fast pullback into EMA20 zone");

  // Confirmation candle: closes in trend direction, beyond the previous bar, body > 40% of range.
  const body = Math.abs(last.close - last.open), range = last.high - last.low || 1e-9;
  const confirm = (s > 0 ? last.close > last.open && last.close > prev.high : last.close < last.open && last.close < prev.low) && body / range > 0.4;
  if (confirm) add(2, s > 0 ? "Bullish rejection / breakout candle" : "Bearish rejection / breakdown candle");

  const r = rsi(closes);
  const fresh = s > 0 ? r > 45 && r < 70 : r < 55 && r > 30;
  if (fresh) add(1, `RSI ${r.toFixed(0)} not exhausted`);

  // Don't chase: price must still be close to EMA20.
  const notExtended = Math.abs(price - e20) < atr * 1.5;

  const stopLoss = s > 0 ? pbExtreme - atr * 0.4 : pbExtreme + atr * 0.4;
  const risk = Math.max(Math.abs(price - stopLoss), atr * 0.8);
  const wide = c.slice(-60);
  const pool = s > 0 ? Math.max(...wide.map((x) => x.high)) - atr * 0.2 : Math.min(...wide.map((x) => x.low)) + atr * 0.2;
  const minTp = price + s * risk * 1.8;
  const takeProfit = (pool - minTp) * s > 0 ? pool : minTp;

  const ready = trend === s && h1Bias !== -s && touched && confirm && fresh && notExtended;
  const confidencePct = Math.min(95, 50 + score * 4);
  return { side, stopLoss, takeProfit, confidencePct, structure, confluences: why, ready };
}

const macdHist = (closes: number[]) => {
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const macd = closes.map((_, i) => e12[i] - e26[i]);
  const sig = emaSeries(macd, 9);
  return macd.map((m, i) => m - sig[i]);
};

/**
 * Movement scanner following the step list: structure, liquidity zones,
 * momentum (RSI, MACD histogram, EMA9/21), ATR risk, H1 bias confluence,
 * then entry/SL/TP with a confidence score. Runs on the fast 1m and 5m
 * charts (15m still supported for callers that use it).
 */
export function scan15m(chart: AutoChart, livePrice?: number, symbol?: string, tf: "m1" | "m5" | "m15" = "m15"): LocalSignal {
  const c = chart[tf];
  const label = tf === "m1" ? "1m" : tf === "m5" ? "5m" : "15m";
  const last = c.at(-1), previous = c.at(-2), earlier = c.at(-5);
  if (!last || !previous || !earlier || c.length < 30) throw new Error(`Not enough ${label} candles for movement analysis`);
  const price = livePrice != null && Number.isFinite(livePrice) && livePrice > 0 ? livePrice : last.close;
  const gold = /XAU|GOLD/i.test(symbol ?? "");
  const initial = movementLevels(c, price, "BUY", gold);
  if (!initial) throw new Error("Invalid candles or volatility for movement analysis");
  const atr = initial.atr;
  const closes = c.map((x) => x.close);
  const e9s = emaSeries(closes, 9), e21s = emaSeries(closes, 21);
  const e9 = e9s.at(-1) ?? price, e21 = e21s.at(-1) ?? price, e50 = emaSeries(closes, 50).at(-1) ?? price;
  const hist = macdHist(closes), h0 = hist.at(-1) ?? 0, h1v = hist.at(-2) ?? 0;
  const r = rsi(closes);
  const spike = gold && last.high - last.low > atr * 2;
  const { hi, lo } = swings(c.slice(-80));
  const high = hi.at(-1), priorHigh = hi.at(-2), low = lo.at(-1), priorLow = lo.at(-2);
  let st = 0, structure = "range";
  if (high != null && priorHigh != null && low != null && priorLow != null) {
    if (high > priorHigh && low > priorLow) { st = 1; structure = "bullish HH/HL"; }
    else if (high < priorHigh && low < priorLow) { st = -1; structure = "bearish LH/LL"; }
  }
  const bos = high != null && last.close > high ? 1 : low != null && last.close < low ? -1 : 0;
  const h = chart.h1.map((x) => x.close);
  const hClose = h.at(-1), h9 = emaSeries(h, 9).at(-1), h21 = emaSeries(h, 21).at(-1);
  const htf = h.length > 30 && hClose != null && h9 != null && h21 != null ? (hClose > h21 && h9 > h21 ? 1 : hClose < h21 && h9 < h21 ? -1 : 0) : 0;
  const emaDir = e9 > e21 ? 1 : e9 < e21 ? -1 : 0;
  const slope = e9 - (e9s.at(-5) ?? e9);
  const movement = last.close - earlier.close;
  const bodyShare = Math.abs(last.close - last.open) / Math.max(last.high - last.low, atr * 0.01);
  // Session quality: 15m moves are reliable during London / New York hours
  // (07:00–17:00 UTC) and tend to fade in the dead Asian hours.
  const hour = new Date(last.time).getUTCHours();
  const inSession = hour >= 7 && hour < 17;
  const evaluate = (s: 1 | -1) => {
    const why: string[] = []; let score = 0;
    const add = (w: number, text: string) => { score += w; why.push(text); };
    if (inSession) add(1, "London/New York session liquidity");
    else score -= 2; // off-hours moves fade — distrust them
    if (st === s) add(2, `Structure ${structure}`);
    if (bos === s) add(2, "Confirmed break of structure");
    if (emaDir === s && (price - e21) * s > 0) add(2, "EMA 9/21 aligned");
    if (slope * s > atr * 0.1) add(2, `${label} trend slope confirms movement`);
    if (movement * s > atr * 0.35) add(2, "Recent four-bar displacement confirms direction");
    if (h0 * s > 0) add(1, "MACD direction confirms");
    if ((h0 - h1v) * s > 0) add(1, "MACD momentum building");
    if (s > 0 ? r > 50 && r < (gold ? 75 : 70) : r < 50 && r > (gold ? 25 : 30)) add(1, `RSI ${r.toFixed(0)}`);
    if (s > 0 ? r >= (gold ? 75 : 70) : r <= (gold ? 25 : 30)) score -= 2;
    if (htf === s) add(gold ? 3 : 2, "H1 bias confirms");
    if ((price - e50) * s > 0) add(1, "Price agrees with EMA50");
    if ((last.close - last.open) * s > 0 && bodyShare >= 0.5 && !spike) add(1, "Directional candle body confirms");
    // A wick alone is not permission to reverse into a gold spike.
    if (spike) score -= 3;
    const sweep = s > 0 ? low != null && last.low < low && last.close > low && last.close > previous.close : high != null && last.high > high && last.close < high && last.close < previous.close;
    if (sweep) add(2, "Liquidity sweep reclaimed with directional close");
    return { score, why };
  };
  const buy = evaluate(1), sell = evaluate(-1);
  const s: 1 | -1 = buy.score > sell.score ? 1 : sell.score > buy.score ? -1 : movement > 0 ? 1 : movement < 0 ? -1 : emaDir > 0 ? 1 : -1;
  const side = s > 0 ? "BUY" : "SELL";
  const { score, why } = s > 0 ? buy : sell;
  const edge = Math.abs(buy.score - sell.score);
  const levels = movementLevels(c, price, side, gold);
  if (!levels) throw new Error("Unable to calculate valid movement levels");
  why.push(levels.reason);
  // Every published direction executes; the stronger-scoring side is the trade side.
  const ready = true;
  const executionNote: string | undefined = undefined;
  const confidencePct = Math.max(35, Math.min(90, 35 + Math.max(0, score) * 2 + edge));
  return { side, stopLoss: levels.stopLoss, takeProfit: levels.takeProfit, confidencePct, structure, confluences: why, ready, executionNote };
}
