import type { Candle } from "./types";

/** All series are index-aligned with the candles; values before warm-up are NaN. Each value at i only uses bars 0..i. */
const nan = (n: number) => new Array<number>(n).fill(NaN);

export function sma(values: number[], period: number): number[] {
  const out = nan(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = nan(values.length);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) { prev = values[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

/** Wilder-smoothed RSI. */
export function rsi(closes: number[], period = 14): number[] {
  const out = nan(closes.length);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => f[i] - s[i]);
  const firstValid = line.findIndex((v) => Number.isFinite(v));
  const sig = nan(closes.length);
  if (firstValid >= 0) {
    const tail = ema(line.slice(firstValid), signal);
    tail.forEach((v, j) => { sig[firstValid + j] = v; });
  }
  return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
}

export function stochastic(c: Candle[], kPeriod = 14, dPeriod = 3) {
  const k = nan(c.length);
  for (let i = kPeriod - 1; i < c.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l); }
    k[i] = hi === lo ? 50 : ((c[i].c - lo) / (hi - lo)) * 100;
  }
  const firstValid = kPeriod - 1;
  const d = nan(c.length);
  if (c.length > firstValid) sma(k.slice(firstValid), dPeriod).forEach((v, j) => { d[firstValid + j] = v; });
  return { k, d };
}

const trueRange = (c: Candle[], i: number) => i === 0 ? c[0].h - c[0].l : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));

/** Wilder ATR. */
export function atr(c: Candle[], period = 14): number[] {
  const out = nan(c.length);
  if (c.length < period) return out;
  let prev = 0;
  for (let i = 0; i < period; i++) prev += trueRange(c, i);
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < c.length; i++) { prev = (prev * (period - 1) + trueRange(c, i)) / period; out[i] = prev; }
  return out;
}

/** Wilder ADX with +DI / −DI. */
export function adx(c: Candle[], period = 14) {
  const n = c.length;
  const out = { adx: nan(n), diPlus: nan(n), diMinus: nan(n) };
  if (n < period * 2 + 1) return out;
  let tr = 0, pdm = 0, mdm = 0;
  const dx: number[] = nan(n);
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h, down = c[i - 1].l - c[i].l;
    const p = up > down && up > 0 ? up : 0, m = down > up && down > 0 ? down : 0;
    const t = trueRange(c, i);
    if (i <= period) { tr += t; pdm += p; mdm += m; if (i < period) continue; }
    else { tr = tr - tr / period + t; pdm = pdm - pdm / period + p; mdm = mdm - mdm / period + m; }
    const dp = tr === 0 ? 0 : (pdm / tr) * 100, dm = tr === 0 ? 0 : (mdm / tr) * 100;
    out.diPlus[i] = dp; out.diMinus[i] = dm;
    dx[i] = dp + dm === 0 ? 0 : (Math.abs(dp - dm) / (dp + dm)) * 100;
  }
  let prev = 0;
  for (let i = period; i < period * 2; i++) prev += dx[i];
  prev /= period;
  out.adx[period * 2 - 1] = prev;
  for (let i = period * 2; i < n; i++) { prev = (prev * (period - 1) + dx[i]) / period; out.adx[i] = prev; }
  return out;
}

/** Bollinger mid (SMA) and rolling standard deviation. */
export function bollinger(closes: number[], period = 20) {
  const mid = sma(closes, period);
  const sd = nan(closes.length);
  for (let i = period - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    sd[i] = Math.sqrt(v / period);
  }
  return { mid, sd };
}

/**
 * Pivot swing points. A pivot at bar j is only *known* once `right` more bars have closed,
 * so `knownAt[j] = j + right` — strategies must never read a pivot before then (no look-ahead).
 */
export function pivots(c: Candle[], left = 2, right = 2) {
  const high: boolean[] = new Array(c.length).fill(false);
  const low: boolean[] = new Array(c.length).fill(false);
  for (let j = left; j < c.length - right; j++) {
    let isH = true, isL = true;
    for (let x = j - left; x <= j + right; x++) {
      if (x === j) continue;
      if (c[x].h >= c[j].h) isH = false;
      if (c[x].l <= c[j].l) isL = false;
    }
    high[j] = isH; low[j] = isL;
  }
  return { high, low, right };
}

export interface Series {
  candles: Candle[];
  closes: number[];
  ema9: number[]; ema21: number[]; ema50: number[]; ema200: number[];
  rsi: number[]; macd: number[]; macdSignal: number[]; macdHist: number[];
  stochK: number[]; stochD: number[];
  atr: number[]; adx: number[]; diPlus: number[]; diMinus: number[];
  volSma: number[];
  bbMid: number[]; bbSd: number[];
  pivotHigh: boolean[]; pivotLow: boolean[]; pivotRight: number;
  hasVolume: boolean;
}

/** Computes every indicator once; strategies then evaluate any bar index cheaply (used live and in backtests). */
export function buildSeries(candles: Candle[]): Series {
  const closes = candles.map((c) => c.c);
  const m = macd(closes), st = stochastic(candles), dx = adx(candles), pv = pivots(candles), bb = bollinger(closes);
  const vols = candles.map((c) => c.v || 0);
  return {
    candles, closes,
    ema9: ema(closes, 9), ema21: ema(closes, 21), ema50: ema(closes, 50), ema200: ema(closes, 200),
    rsi: rsi(closes), macd: m.line, macdSignal: m.signal, macdHist: m.hist,
    stochK: st.k, stochD: st.d,
    atr: atr(candles), adx: dx.adx, diPlus: dx.diPlus, diMinus: dx.diMinus,
    volSma: sma(vols, 20),
    bbMid: bb.mid, bbSd: bb.sd,
    pivotHigh: pv.high, pivotLow: pv.low, pivotRight: pv.right,
    hasVolume: vols.filter((v) => v > 0).length > vols.length * 0.8,
  };
}

/** Swing points confirmed by bar i (newest last). */
export function knownSwings(s: Series, i: number, kind: "high" | "low", max = 6, lookback = 120) {
  const out: { i: number; price: number }[] = [];
  const flags = kind === "high" ? s.pivotHigh : s.pivotLow;
  for (let j = i - s.pivotRight; j >= Math.max(0, i - lookback) && out.length < max; j--) {
    if (flags[j]) out.unshift({ i: j, price: kind === "high" ? s.candles[j].h : s.candles[j].l });
  }
  return out;
}

export const finite = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
