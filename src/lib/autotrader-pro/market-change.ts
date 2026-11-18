/**
 * AlgoVault V3 market-change detection (pure, closed bars only, no look-ahead).
 * Every read below is calculated from real candles; anything the feed cannot supply
 * (volume, bid/ask order flow, yields) is reported as unavailable instead of being guessed.
 * Scores are explainable evidence weights — never a promise or probability of a reversal.
 */
import { BOOK_GROUPS, BOOK_TREND_FOLLOWERS } from "./strategy-book";
import { finite, knownSwings, type Series } from "./indicators";
import { atrRank, priorRange } from "./regime";
import { structureEvents } from "./smc";
import type { Candle, Interval, Side, StrategyId } from "./types";

export type V3Regime =
  | "strong_bull" | "strong_bear" | "weak_bull" | "weak_bear" | "ranging" | "vol_expansion"
  | "vol_contraction" | "exhaustion" | "potential_reversal" | "breakout_transition" | "choppy";

export const V3_LABEL: Record<V3Regime, string> = {
  strong_bull: "Strong bullish trend", strong_bear: "Strong bearish trend",
  weak_bull: "Weak bullish trend", weak_bear: "Weak bearish trend",
  ranging: "Sideways / ranging", vol_expansion: "Volatility expansion", vol_contraction: "Volatility contraction",
  exhaustion: "Trend exhaustion", potential_reversal: "Potential reversal", breakout_transition: "Breakout transition",
  choppy: "Unstable / choppy",
};

export type StrategyGroup = "trending" | "ranging" | "breakout" | "reversal" | "high_volatility" | "choppy" | "compression";
export const GROUP_LABEL: Record<StrategyGroup, string> = {
  trending: "Trend-following, pullback & continuation", ranging: "Range trading, sweep reversal & support/resistance",
  breakout: "Volatility expansion, breakout & retest", reversal: "Divergence, exhaustion, sweep & structure reversal",
  high_volatility: "Volatility-adaptive risk — reduced exposure", choppy: "High-quality setups only — fewer signals",
  compression: "Squeeze watch — wait for the breakout",
};
export const GROUP_OF: Record<V3Regime, StrategyGroup> = {
  strong_bull: "trending", strong_bear: "trending", weak_bull: "trending", weak_bear: "trending",
  ranging: "ranging", vol_expansion: "high_volatility", vol_contraction: "compression", exhaustion: "reversal",
  potential_reversal: "reversal", breakout_transition: "breakout", choppy: "choppy",
};
/** Preferred strategies per market group, derived from the 90-strategy book. */
export const GROUP_STRATEGIES: Record<StrategyGroup, StrategyId[]> = BOOK_GROUPS;
/** Trend-following strategies demoted in choppy markets. */
export const TREND_FOLLOWERS: StrategyId[] = BOOK_TREND_FOLLOWERS;
const RISK_SCALE: Record<StrategyGroup, number> = { trending: 1, ranging: 1, breakout: 1, reversal: 0.75, high_volatility: 0.5, choppy: 0.5, compression: 0.75 };

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const dirOfRegime = (r: V3Regime): -1 | 0 | 1 => (r === "strong_bull" || r === "weak_bull" ? 1 : r === "strong_bear" || r === "weak_bear" ? -1 : 0);
const sideOf = (d: number): Side => (d > 0 ? "BUY" : "SELL");
const bbWidth = (s: Series, j: number) => (s.bbMid[j] > 0 && Number.isFinite(s.bbSd[j]) ? (4 * s.bbSd[j]) / s.bbMid[j] : NaN);

/** Percentile of bar i's Bollinger width among the previous n bars (0 = tightest). */
export function widthRank(s: Series, i: number, n = 120) {
  const now = bbWidth(s, i);
  if (!Number.isFinite(now)) return 0.5;
  let below = 0, count = 0;
  for (let j = Math.max(0, i - n); j < i; j++) { const w = bbWidth(s, j); if (!Number.isFinite(w)) continue; count++; if (w < now) below++; }
  return count ? below / count : 0.5;
}

/** +1 higher highs & higher lows, -1 lower highs & lower lows, 0 mixed. */
export function structureDir(s: Series, i: number): -1 | 0 | 1 {
  const h = knownSwings(s, i, "high", 2), l = knownSwings(s, i, "low", 2);
  if (h.length < 2 || l.length < 2) return 0;
  if (h[1].price > h[0].price && l[1].price > l[0].price) return 1;
  if (h[1].price < h[0].price && l[1].price < l[0].price) return -1;
  return 0;
}

// ---------------- Choppy market ----------------
export interface ChopRead { score: number; choppy: boolean; flags: string[]; rangeHigh: number; rangeLow: number; failedBreakSide?: Side }
export function readChop(s: Series, i: number, n = 30): ChopRead {
  const c = s.candles, from = Math.max(1, i - n + 1), flags: string[] = [];
  let crosses = 0, overlap = 0, ob = 0, path = 0, falseUp = 0, falseDown = 0, hi = -Infinity, lo = Infinity;
  let failedBreakSide: Side | undefined;
  for (let j = from; j <= i; j++) {
    hi = Math.max(hi, c[j].h); lo = Math.min(lo, c[j].l);
    const d0 = s.ema9[j - 1] - s.ema21[j - 1], d1 = s.ema9[j] - s.ema21[j];
    if (finite(d0, d1) && Math.sign(d0) !== Math.sign(d1)) crosses++;
    const rng = Math.max(c[j].h - c[j].l, c[j - 1].h - c[j - 1].l);
    if (rng > 0) { overlap += Math.max(0, Math.min(c[j].h, c[j - 1].h) - Math.max(c[j].l, c[j - 1].l)) / rng; ob++; }
    path += Math.abs(c[j].c - c[j - 1].c);
    const pr = priorRange(s, j, 20), t = Number.isFinite(s.atr[j]) ? s.atr[j] * 0.1 : 0;
    if (Number.isFinite(pr.hi) && c[j].h > pr.hi + t && c[j].c < pr.hi) { falseUp++; failedBreakSide = "BUY"; }
    if (Number.isFinite(pr.lo) && c[j].l < pr.lo - t && c[j].c > pr.lo) { falseDown++; failedBreakSide = "SELL"; }
  }
  const ov = ob ? overlap / ob : 0;
  const er = path > 0 ? Math.abs(c[i].c - c[from - 1].c) / path : 1;
  const adxV = Number.isFinite(s.adx[i]) ? s.adx[i] : 20;
  const ev = structureEvents(s, i, n).filter((e) => e.bar >= from);
  let flips = 0;
  for (let k = 1; k < ev.length; k++) if (ev[k].dir !== ev[k - 1].dir) flips++;
  const falseBreaks = falseUp + falseDown;
  if (crosses >= 4) flags.push(`${crosses} EMA 9/21 crossovers in ${n} bars`);
  if (ov >= 0.6) flags.push(`Candles overlap ${(ov * 100).toFixed(0)}%`);
  if (adxV < 20) flags.push(`Low ADX ${adxV.toFixed(0)}`);
  if (falseBreaks >= 2) flags.push(`${falseBreaks} false breakouts / sweeps without continuation`);
  if (er < 0.25) flags.push(`Weak directional momentum (efficiency ${(er * 100).toFixed(0)}%)`);
  if (flips >= 2) flags.push(`Structure flipped ${flips} times`);
  const score = Math.round(100 * (0.2 * clamp01(crosses / 6) + 0.2 * clamp01((ov - 0.35) / 0.4) + 0.15 * clamp01((25 - adxV) / 10)
    + 0.2 * clamp01(falseBreaks / 3) + 0.15 * clamp01((0.4 - er) / 0.3) + 0.1 * clamp01(flips / 3)));
  return { score, choppy: score >= 55, flags, rangeHigh: hi, rangeLow: lo, failedBreakSide };
}

// ---------------- Divergence ----------------
export interface Divergence { kind: "regular" | "hidden"; side: Side; osc: "RSI" | "MACD"; text: string }
export function readDivergence(s: Series, i: number, fresh = 15): Divergence[] {
  const out: Divergence[] = [];
  const check = (kind: "high" | "low") => {
    const sw = knownSwings(s, i, kind, 2, 80);
    if (sw.length < 2) return;
    const [a, b] = sw;
    if (i - b.i > fresh) return;
    for (const osc of ["RSI", "MACD"] as const) {
      const arr = osc === "RSI" ? s.rsi : s.macd;
      const oa = arr[a.i], ob = arr[b.i];
      if (!finite(oa, ob)) continue;
      if (kind === "low") {
        if (b.price < a.price && ob > oa) out.push({ kind: "regular", side: "BUY", osc, text: `Regular bullish ${osc} divergence (lower low, higher ${osc})` });
        else if (b.price > a.price && ob < oa) out.push({ kind: "hidden", side: "BUY", osc, text: `Hidden bullish ${osc} divergence (higher low, lower ${osc})` });
      } else {
        if (b.price > a.price && ob < oa) out.push({ kind: "regular", side: "SELL", osc, text: `Regular bearish ${osc} divergence (higher high, lower ${osc})` });
        else if (b.price < a.price && ob > oa) out.push({ kind: "hidden", side: "SELL", osc, text: `Hidden bearish ${osc} divergence (lower high, higher ${osc})` });
      }
    }
  };
  check("low"); check("high");
  return out;
}

// ---------------- Trend exhaustion ----------------
export type ExhaustStage = "early" | "possible" | "confirmed";
export const EXHAUST_LABEL: Record<ExhaustStage, string> = { early: "EARLY TREND EXHAUSTION", possible: "POSSIBLE REVERSAL", confirmed: "CONFIRMED REVERSAL" };
export interface ExhaustRead { stage?: ExhaustStage; trend: -1 | 0 | 1; evidence: string[] }
export function readExhaustion(s: Series, i: number, divs = readDivergence(s, i)): ExhaustRead {
  const c = s.candles, a = s.atr[i];
  const slope = i >= 20 && finite(s.ema21[i], s.ema21[i - 20], a) && a > 0 ? (s.ema21[i] - s.ema21[i - 20]) / a : 0;
  const sd = structureDir(s, i);
  const trend: -1 | 0 | 1 = slope > 0.5 || (slope > 0.2 && sd > 0) ? 1 : slope < -0.5 || (slope < -0.2 && sd < 0) ? -1 : 0;
  if (!trend || i < 30) return { trend, evidence: [] };
  const ev: string[] = [];
  const up = trend === 1;
  const reg = divs.filter((d) => d.kind === "regular" && d.side === (up ? "SELL" : "BUY"));
  if (reg.length) ev.push(reg.map((d) => d.text).join(" + "));
  let hMax = 0;
  for (let j = i - 10; j <= i; j++) if (Number.isFinite(s.macdHist[j])) hMax = Math.max(hMax, up ? s.macdHist[j] : -s.macdHist[j]);
  const hNow = up ? s.macdHist[i] : -s.macdHist[i];
  if (hMax > 0 && hNow < hMax * 0.5 && hNow < (up ? s.macdHist[i - 1] : -s.macdHist[i - 1])) ev.push("Momentum weakening (MACD histogram fading)");
  let atrMax = 0, rankMax = 0;
  for (let j = i - 15; j <= i; j++) { if (Number.isFinite(s.atr[j])) atrMax = Math.max(atrMax, s.atr[j]); }
  for (let j = i - 15; j <= i; j += 5) rankMax = Math.max(rankMax, atrRank(s, j));
  if (rankMax >= 0.85 && a < atrMax * 0.8) ev.push("ATR expanded then contracted");
  let failed = 0;
  for (let j = i - 10; j <= i; j++) {
    const pr = priorRange(s, j, 20);
    const t = Number.isFinite(s.atr[j]) ? s.atr[j] * 0.15 : 0;
    if (up && c[j].h > pr.hi + t && c[j].c < pr.hi - t) failed++;
    if (!up && c[j].l < pr.lo - t && c[j].c > pr.lo + t) failed++;
  }
  if (failed >= 2) ev.push(`${failed} failed continuation attempts / failed breakouts`);
  for (let j = i - 2; j <= i; j++) {
    const b = c[j], body = Math.abs(b.c - b.o), rng = b.h - b.l;
    const wick = up ? b.h - Math.max(b.o, b.c) : Math.min(b.o, b.c) - b.l;
    if (rng > 0 && wick > 2 * body && wick > 0.5 * rng) { ev.push(`Long ${up ? "upper" : "lower"} rejection wick`); break; }
  }
  for (let j = i - 5; j <= i; j++) {
    const b = c[j], rng = b.h - b.l;
    const withTrend = up ? b.c > b.o : b.c < b.o;
    const volOk = !s.hasVolume || (s.volSma[j] > 0 && b.v > 2 * s.volSma[j]);
    if (withTrend && Number.isFinite(s.atr[j]) && rng > 2.2 * s.atr[j] && volOk) { ev.push("Climax candle"); break; }
  }
  if (s.adx[i - 5] > 30 && s.adx[i] < s.adx[i - 5] - 3) ev.push(`Trend strength fading (ADX ${s.adx[i - 5].toFixed(0)} → ${s.adx[i].toFixed(0)})`);
  // RSI extremes only count alongside other evidence — overbought/oversold alone never signals a reversal.
  const r = s.rsi[i], core = ev.length;
  if (core && ((up && r > 70) || (!up && r < 30))) ev.push(`RSI stretched (${r.toFixed(0)})`);
  if (core < 2) return { trend, evidence: ev };
  const last = structureEvents(s, i, 60).pop();
  const choch = last && last.kind === "CHoCH" && last.dir === (up ? "SELL" : "BUY") && i - last.bar <= 10;
  const lostEma = up ? c[i].c < s.ema21[i] : c[i].c > s.ema21[i];
  const stage: ExhaustStage = choch ? "confirmed" : core >= 3 || lostEma ? "possible" : "early";
  if (choch) ev.push("Market structure shifted (CHoCH) against the trend");
  return { stage, trend, evidence: ev };
}

// ---------------- Volatility compression / expansion ----------------
export interface SqueezeRead { state: "squeeze" | "expanding" | "normal"; widthRank: number; atrRank: number; dir?: Side; confirmed: boolean; notes: string[] }
export function readSqueeze(s: Series, i: number): SqueezeRead {
  const wr = widthRank(s, i), ar = atrRank(s, i), notes: string[] = [];
  if (wr <= 0.15 && ar <= 0.35) {
    let bars = 0;
    for (let j = i; j > i - 40 && j > 0 && widthRank(s, j) <= 0.2; j--) bars++;
    notes.push(`Bollinger squeeze for ${bars} bars (width in the tightest ${Math.max(1, Math.round(wr * 100))}%)`, "Breakout watch — price is coiling");
    return { state: "squeeze", widthRank: wr, atrRank: ar, confirmed: false, notes };
  }
  let wasTight = false;
  for (let j = i - 8; j < i; j++) if (j > 0 && widthRank(s, j) <= 0.15) { wasTight = true; break; }
  const rising = bbWidth(s, i) > bbWidth(s, i - 1) && bbWidth(s, i - 1) > bbWidth(s, i - 2);
  const c = s.candles[i];
  if (wasTight && rising) {
    const d = c.c > s.bbMid[i] ? 1 : -1;
    const momentum = Math.sign(s.macdHist[i]) === d;
    const pr = priorRange(s, i, 20);
    const broke = d > 0 ? c.c > pr.hi : c.c < pr.lo;
    notes.push(`Squeeze released ${d > 0 ? "upward" : "downward"}`);
    if (momentum) notes.push("Momentum agrees (MACD)");
    if (broke) notes.push(`Closed beyond the 20-bar ${d > 0 ? "high" : "low"}`);
    return { state: "expanding", widthRank: wr, atrRank: ar, dir: momentum ? sideOf(d) : undefined, confirmed: momentum && broke, notes };
  }
  return { state: "normal", widthRank: wr, atrRank: ar, confirmed: false, notes };
}

// ---------------- Volume ----------------
export interface VolumeRead { available: boolean; note: string; rvol?: number; spike?: boolean; pressure?: number; divergence?: string; poc?: number; vah?: number; val?: number }
export const ORDER_FLOW_NOTE = "Delta / order-flow: not available — this feed has no bid/ask trade prints, so none is shown.";
export function readVolume(s: Series, i: number, bins = 24, n = 200): VolumeRead {
  if (!s.hasVolume) return { available: false, note: "This market's feed has no reliable volume — volume checks are skipped." };
  const c = s.candles, from = Math.max(0, i - n + 1);
  const rvol = s.volSma[i] > 0 ? c[i].v / s.volSma[i] : undefined;
  let pv = 0, vv = 0;
  for (let j = Math.max(0, i - 19); j <= i; j++) { const r = c[j].h - c[j].l; if (r > 0) { pv += (((c[j].c - c[j].l) - (c[j].h - c[j].c)) / r) * c[j].v; vv += c[j].v; } }
  const pressure = vv > 0 ? pv / vv : 0;
  const avg = (a: number, b: number) => { let t = 0, k = 0; for (let j = Math.max(0, a); j <= b; j++) { t += c[j].v; k++; } return k ? t / k : 0; };
  const hiNow = Math.max(...c.slice(i - 19, i + 1).map((x) => x.h)), hiPrev = Math.max(...c.slice(Math.max(0, i - 39), i - 19).map((x) => x.h));
  const loNow = Math.min(...c.slice(i - 19, i + 1).map((x) => x.l)), loPrev = Math.min(...c.slice(Math.max(0, i - 39), i - 19).map((x) => x.l));
  const vNow = avg(i - 19, i), vPrev = avg(i - 39, i - 20);
  const divergence = hiNow > hiPrev && vNow < vPrev * 0.8 ? "New highs on falling volume" : loNow < loPrev && vNow < vPrev * 0.8 ? "New lows on falling volume" : undefined;
  let lo = Infinity, hi = -Infinity;
  for (let j = from; j <= i; j++) { lo = Math.min(lo, c[j].l); hi = Math.max(hi, c[j].h); }
  const step = (hi - lo) / bins, hist = new Array(bins).fill(0);
  if (step > 0) for (let j = from; j <= i; j++) hist[Math.min(bins - 1, Math.floor(((c[j].h + c[j].l + c[j].c) / 3 - lo) / step))] += c[j].v;
  let p = 0;
  for (let k = 1; k < bins; k++) if (hist[k] > hist[p]) p = k;
  const total = hist.reduce((a, b) => a + b, 0);
  let lo_k = p, hi_k = p, acc = hist[p];
  while (acc < total * 0.7 && (lo_k > 0 || hi_k < bins - 1)) {
    const down = lo_k > 0 ? hist[lo_k - 1] : -1, upv = hi_k < bins - 1 ? hist[hi_k + 1] : -1;
    if (upv >= down) { hi_k++; acc += upv; } else { lo_k--; acc += down; }
  }
  return {
    available: true, note: "Pressure is estimated from where each candle closes in its range, weighted by volume — not real order flow.",
    rvol, spike: rvol !== undefined && rvol >= 2, pressure, divergence,
    poc: step > 0 ? lo + (p + 0.5) * step : undefined, vah: step > 0 ? lo + (hi_k + 1) * step : undefined, val: step > 0 ? lo + lo_k * step : undefined,
  };
}

// ---------------- Sessions (DST-aware via IANA time zones, displayed in SAST) ----------------
export type SessionName = "Asian" | "London" | "New York";
const SESSION_DEF: { name: SessionName; tz: string; open: number; close: number }[] = [
  { name: "Asian", tz: "Asia/Tokyo", open: 9, close: 18 },
  { name: "London", tz: "Europe/London", open: 8, close: 17 },
  { name: "New York", tz: "America/New_York", open: 8, close: 17 },
];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function hourIn(tz: string, t: number) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }); fmtCache.set(tz, f); }
  const parts = f.formatToParts(new Date(t));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "0";
  return { h: Number(get("hour")) + Number(get("minute")) / 60, weekend: ["Sat", "Sun"].includes(get("weekday")) };
}
/** Sessions open at time t (each in its own local time, so daylight saving is handled automatically). */
export function sessionsAt(t: number): SessionName[] {
  return SESSION_DEF.filter((d) => { const x = hourIn(d.tz, t); return !x.weekend && x.h >= d.open && x.h < d.close; }).map((d) => d.name);
}
export const sastTime = (t: number) => new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
/** Next open time (SAST) of each session within 3 days, found in 15-minute steps. */
export function nextOpens(now: number): { name: SessionName; at: number }[] {
  return SESSION_DEF.map((d) => {
    const step = 15 * 60_000, start = Math.floor(now / step) * step;
    for (let t = start + step; t < now + 3 * 86_400_000; t += step) {
      const a = hourIn(d.tz, t - step), b = hourIn(d.tz, t);
      if (!b.weekend && b.h >= d.open && b.h < d.close && !(a.h >= d.open && a.h < d.close && !a.weekend)) return { name: d.name, at: t };
    }
    return { name: d.name, at: NaN };
  });
}
const labelAt = (t: number) => { const s = sessionsAt(t); return s.includes("New York") ? (s.includes("London") ? "London/New York overlap" : "New York") : s.includes("London") ? "London" : s.includes("Asian") ? "Asian" : "Off-hours"; };

export interface SessionRead {
  active: SessionName[]; overlap: boolean; label: string;
  high?: number; low?: number; prevLabel?: string; prevHigh?: number; prevLow?: number;
  openingVolatility: boolean; events: string[];
}
export function readSession(s: Series, i: number): SessionRead {
  const c = s.candles, t = c[i].t, active = sessionsAt(t), label = labelAt(t), events: string[] = [];
  const base = (l: string) => l.replace("London/New York overlap", "New York");
  let j = i;
  while (j > 0 && base(labelAt(c[j - 1].t)) === base(label)) j--;
  let high = -Infinity, low = Infinity;
  for (let k = j; k <= i; k++) { high = Math.max(high, c[k].h); low = Math.min(low, c[k].l); }
  let pe = j - 1;
  while (pe > 0 && labelAt(c[pe].t) === "Off-hours") pe--;
  let ps = pe;
  const pl = pe >= 0 ? base(labelAt(c[pe].t)) : "Off-hours";
  while (ps > 0 && base(labelAt(c[ps - 1].t)) === pl) ps--;
  let prevHigh: number | undefined, prevLow: number | undefined;
  const who = label === "Off-hours" ? "Price" : base(label);
  if (pe > 0 && pl !== "Off-hours" && pl !== base(label)) {
    prevHigh = -Infinity; prevLow = Infinity;
    for (let k = ps; k <= pe; k++) { prevHigh = Math.max(prevHigh, c[k].h); prevLow = Math.min(prevLow, c[k].l); }
    for (let k = j; k <= i; k++) {
      if (c[k].h > prevHigh && c[k].c < prevHigh) { events.push(`${who} swept the ${pl} high`); break; }
      if (c[k].l < prevLow && c[k].c > prevLow) { events.push(`${who} swept the ${pl} low`); break; }
    }
    if (c[i].c > prevHigh) events.push(`Breakout above the ${pl} high`);
    else if (c[i].c < prevLow) events.push(`Breakdown below the ${pl} low`);
  }
  const openingVolatility = label !== "Off-hours" && t - c[j].t <= 60 * 60_000 && Number.isFinite(s.atr[i]) && c[i].h - c[i].l > 1.5 * s.atr[i];
  if (openingVolatility) events.push(`${base(label)} opening volatility`);
  return { active, overlap: active.includes("London") && active.includes("New York"), label, high: label !== "Off-hours" ? high : undefined, low: label !== "Off-hours" ? low : undefined, prevLabel: prevHigh !== undefined ? pl : undefined, prevHigh, prevLow, openingVolatility, events };
}

// ---------------- Failed breakouts & traps ----------------
export interface TrapRead { kind: "bull_trap" | "bear_trap" | "grab_high" | "grab_low"; level: number; confirmed: boolean; reversal: Side; text: string }
export function readTrap(s: Series, i: number): TrapRead | undefined {
  const c = s.candles;
  const ev = structureEvents(s, i, 60);
  for (let j = i - 1; j >= Math.max(21, i - 8); j--) {
    const pr = priorRange(s, j, 20);
    if (c[j].c > pr.hi && c[i].c < pr.hi) {
      const confirmed = ev.some((e) => e.dir === "SELL" && e.bar > j);
      return { kind: "bull_trap", level: pr.hi, confirmed, reversal: "SELL", text: `Bull trap: breakout above ${pr.hi.toPrecision(6)} failed and price is back inside${confirmed ? " with a bearish structure shift" : ""}` };
    }
    if (c[j].c < pr.lo && c[i].c > pr.lo) {
      const confirmed = ev.some((e) => e.dir === "BUY" && e.bar > j);
      return { kind: "bear_trap", level: pr.lo, confirmed, reversal: "BUY", text: `Bear trap: breakdown below ${pr.lo.toPrecision(6)} failed and price is back inside${confirmed ? " with a bullish structure shift" : ""}` };
    }
  }
  const pr = priorRange(s, i, 20);
  if (c[i].h > pr.hi && c[i].c < pr.hi) return { kind: "grab_high", level: pr.hi, confirmed: false, reversal: "SELL", text: "Liquidity grab above the 20-bar high (wick, no close beyond)" };
  if (c[i].l < pr.lo && c[i].c > pr.lo) return { kind: "grab_low", level: pr.lo, confirmed: false, reversal: "BUY", text: "Liquidity grab below the 20-bar low (wick, no close beyond)" };
  return undefined;
}

// ---------------- Raw regime + hysteresis ----------------
export function rawRegime(s: Series, i: number): V3Regime {
  if (i < 60) return "ranging";
  const chop = readChop(s, i);
  if (chop.score >= 60) return "choppy";
  const sq = readSqueeze(s, i);
  const pr = priorRange(s, i, 20), c = s.candles[i];
  if (sq.state === "expanding" || ((c.c > pr.hi || c.c < pr.lo) && s.adx[i - 3] < 22)) return "breakout_transition";
  const ex = readExhaustion(s, i);
  if (ex.stage === "early") return "exhaustion";
  if (ex.stage) return "potential_reversal";
  if (atrRank(s, i) >= 0.85 && bbWidth(s, i) > bbWidth(s, i - 3)) return "vol_expansion";
  const a = s.atr[i];
  const slope = finite(s.ema21[i], s.ema21[i - 10], a) && a > 0 ? (s.ema21[i] - s.ema21[i - 10]) / a : 0;
  const sd = structureDir(s, i), adxV = s.adx[i];
  const bullStack = s.ema9[i] > s.ema21[i] && s.ema21[i] > s.ema50[i], bearStack = s.ema9[i] < s.ema21[i] && s.ema21[i] < s.ema50[i];
  if (adxV >= 25 && bullStack && slope > 0.3 && sd >= 0) return "strong_bull";
  if (adxV >= 25 && bearStack && slope < -0.3 && sd <= 0) return "strong_bear";
  if (slope > 0.15 && c.c > s.ema50[i] && (adxV >= 18 || sd > 0)) return "weak_bull";
  if (slope < -0.15 && c.c < s.ema50[i] && (adxV >= 18 || sd < 0)) return "weak_bear";
  if (sq.state === "squeeze") return "vol_contraction";
  return "ranging";
}

export interface SwitchConfig { confirmBars: number; minHoldBars: number }
export const DEFAULT_SWITCH: SwitchConfig = { confirmBars: 3, minHoldBars: 5 };
export interface Smoothed { current: V3Regime; previous?: V3Regime; changedAgo?: number; pending?: { regime: V3Regime; bars: number } }
/**
 * Hysteresis: a new regime must repeat on `confirmBars` consecutive closed bars, and the current one must
 * have been held for `minHoldBars`, before the selector switches — so small fluctuations never flip strategies.
 */
export function smoothRegimes(raw: V3Regime[], cfg: SwitchConfig = DEFAULT_SWITCH): Smoothed {
  if (!raw.length) return { current: "ranging" };
  let current = raw[0], previous: V3Regime | undefined, changedAt: number | undefined, held = 0;
  let cand: V3Regime | undefined, count = 0;
  for (let k = 1; k < raw.length; k++) {
    held++;
    const r = raw[k];
    if (r === current) { cand = undefined; count = 0; continue; }
    if (r === cand) count++; else { cand = r; count = 1; }
    if (count >= Math.max(1, cfg.confirmBars) && held >= cfg.minHoldBars) { previous = current; current = r; changedAt = k; held = 0; cand = undefined; count = 0; }
  }
  return { current, previous, changedAgo: changedAt === undefined ? undefined : raw.length - 1 - changedAt, pending: cand ? { regime: cand, bars: count } : undefined };
}

// ---------------- Market change read (one timeframe) ----------------
export interface Adaptation { group: StrategyGroup; preferred: StrategyId[]; demoteTrend: boolean; riskScale: number; avoidSide?: Side; note: string }
export interface ChangeRead {
  interval: Interval;
  regime: V3Regime; previous?: V3Regime; changedAgo?: number; pending?: { regime: V3Regime; bars: number }; raw: V3Regime;
  direction: "bullish" | "bearish" | "neutral";
  /** 0–100 Market Change Score: how much the market is changing now. Not a reversal probability. */
  score: number;
  components: { label: string; value: number; weight: number }[];
  /** 0–100 weight of agreeing evidence behind an early transition (explainable, not a probability). */
  evidence: number;
  earlyTransition?: string;
  group: StrategyGroup; strategies: StrategyId[];
  reason: string; alerts: string[];
  chop: ChopRead; exhaustion: ExhaustRead; divergences: Divergence[]; squeeze: SqueezeRead; volume: VolumeRead; trap?: TrapRead; session: SessionRead;
  adaptation: Adaptation;
}

const LABEL_TF = (iv: Interval) => iv.toUpperCase();

export function readMarketChange(s: Series, i: number, interval: Interval, cfg: SwitchConfig = DEFAULT_SWITCH): ChangeRead {
  const hist = Math.max(cfg.confirmBars + cfg.minHoldBars + 10, 30);
  const raws: V3Regime[] = [];
  for (let j = Math.max(0, i - hist); j <= i; j++) raws.push(rawRegime(s, j));
  const sm = smoothRegimes(raws, cfg);
  const chop = readChop(s, i), divergences = readDivergence(s, i), exhaustion = readExhaustion(s, i, divergences);
  const squeeze = readSqueeze(s, i), volume = readVolume(s, i), trap = readTrap(s, i), session = readSession(s, i);
  const ev = structureEvents(s, i, 60), last = ev[ev.length - 1];
  const freshEv = last && i - last.bar <= 3 ? last : undefined;
  const h = s.macdHist;
  const momFlip = i >= 3 && [0, 1, 2].some((k) => Math.sign(h[i - k]) !== Math.sign(h[i - k - 1]) && Number.isFinite(h[i - k - 1]));
  const components = [
    { label: "Trend strength", weight: 15, value: clamp01(Math.abs(s.adx[i] - s.adx[i - 5]) / 10) },
    { label: "Momentum", weight: 15, value: momFlip ? 1 : clamp01(Math.abs(s.rsi[i] - s.rsi[i - 5]) / 20) },
    { label: "Volatility", weight: 15, value: squeeze.state === "expanding" ? 1 : clamp01(Math.abs(atrRank(s, i) - atrRank(s, i - 10)) * 2) },
    { label: "Market structure", weight: 20, value: freshEv ? (freshEv.kind === "CHoCH" ? 1 : 0.6) : 0 },
    { label: "Liquidity events", weight: 10, value: trap ? (trap.kind.endsWith("trap") ? 1 : 0.7) : session.events.some((e) => e.includes("swept")) ? 0.7 : 0 },
    { label: "Divergence", weight: 10, value: divergences.some((d) => d.kind === "regular") ? 1 : divergences.length ? 0.6 : 0 },
    { label: "Volume", weight: volume.available ? 8 : 0, value: volume.available ? clamp01(((volume.rvol ?? 1) - 1) / 2) : 0 },
    { label: "Session behaviour", weight: 7, value: session.openingVolatility ? 1 : session.events.length ? 0.7 : 0 },
  ];
  const wsum = components.reduce((a, x) => a + x.weight, 0);
  const score = Math.round((components.reduce((a, x) => a + x.weight * x.value, 0) / wsum) * 100);

  // Direction of the transition from independent votes.
  const votes: { d: number; why: string }[] = [];
  if (freshEv) votes.push({ d: freshEv.dir === "BUY" ? 1 : -1, why: `${freshEv.kind} ${freshEv.dir === "BUY" ? "up" : "down"}` });
  if (momFlip) votes.push({ d: Math.sign(h[i]), why: `MACD momentum flipped ${h[i] > 0 ? "up" : "down"}` });
  for (const d of divergences) votes.push({ d: d.side === "BUY" ? 1 : -1, why: d.text });
  if (trap) votes.push({ d: trap.reversal === "BUY" ? 1 : -1, why: trap.text });
  if (squeeze.dir) votes.push({ d: squeeze.dir === "BUY" ? 1 : -1, why: squeeze.notes[0] });
  if (exhaustion.stage) votes.push({ d: -exhaustion.trend, why: EXHAUST_LABEL[exhaustion.stage] });
  const rd = dirOfRegime(sm.pending?.regime ?? sm.current);
  if (rd) votes.push({ d: rd, why: V3_LABEL[sm.pending?.regime ?? sm.current] });
  const net = votes.reduce((a, v) => a + v.d, 0);
  const direction = net >= 2 ? "bullish" : net <= -2 ? "bearish" : "neutral";
  const agreeing = votes.filter((v) => direction !== "neutral" && Math.sign(v.d) === (direction === "bullish" ? 1 : -1));
  const evidence = Math.round(Math.min(100, agreeing.length * 18 + score * 0.25));
  const raw = raws[raws.length - 1];
  const target = sm.pending?.regime ?? (raw !== sm.current ? raw : undefined);
  const earlyTransition = target && agreeing.length >= 3
    ? `EARLY TRANSITION: ${V3_LABEL[sm.current]} → ${V3_LABEL[target]} (${agreeing.length} confirmations, ${direction})`
    : undefined;

  const group = chop.choppy ? "choppy" : GROUP_OF[sm.current];
  const adaptation: Adaptation = {
    group, preferred: GROUP_STRATEGIES[group], demoteTrend: group === "choppy" || group === "ranging" || group === "compression",
    riskScale: RISK_SCALE[group], avoidSide: chop.choppy ? chop.failedBreakSide : undefined,
    note: `${V3_LABEL[sm.current]} → ${GROUP_LABEL[group]}`,
  };

  const tf = LABEL_TF(interval), alerts: string[] = [];
  if (momFlip && Math.abs(s.rsi[i] - s.rsi[i - 3]) >= 5) alerts.push(`${tf} ${h[i] > 0 ? "bullish" : "bearish"} momentum shift`);
  if (freshEv?.kind === "CHoCH") alerts.push(`${tf} ${freshEv.dir === "BUY" ? "bullish" : "bearish"} CHoCH`);
  if (trap || session.events.some((e) => e.includes("swept"))) alerts.push(`${tf} liquidity sweep`);
  if (s.adx[i - 5] > 25 && s.adx[i] < s.adx[i - 5] - 3) alerts.push(`${tf} trend weakening`);
  if (sm.changedAgo !== undefined && sm.changedAgo <= 2 && sm.previous) {
    const pd = dirOfRegime(sm.previous), cd = dirOfRegime(sm.current);
    if (pd && cd && pd !== cd) alerts.push(`${tf} ${pd > 0 ? "bullish-to-bearish" : "bearish-to-bullish"} transition`);
    alerts.push(`${tf} market regime changed: ${V3_LABEL[sm.previous]} → ${V3_LABEL[sm.current]}`);
  }
  if (squeeze.state === "squeeze") alerts.push(`${tf} breakout watch (volatility squeeze)`);
  if (squeeze.state === "expanding" || raw === "vol_expansion") alerts.push(`${tf} volatility expansion detected`);
  if (squeeze.confirmed || (raw === "breakout_transition" && freshEv?.kind === "BOS")) alerts.push(`${tf} breakout confirmed`);
  if (exhaustion.stage) alerts.push(`${tf} ${EXHAUST_LABEL[exhaustion.stage]}`);
  if (trap?.kind.endsWith("trap")) alerts.push(`${tf} ${trap.kind === "bull_trap" ? "bull" : "bear"} trap${trap.confirmed ? " — reversal confirmed by structure" : ""}`);
  for (const d of divergences.filter((x) => x.kind === "regular")) alerts.push(`${tf} ${d.text.toLowerCase()}`);
  if (earlyTransition) alerts.unshift(`${tf} ${earlyTransition}`);

  const why = [
    ...(sm.previous && sm.changedAgo !== undefined ? [`Regime changed from ${V3_LABEL[sm.previous].toLowerCase()} ${sm.changedAgo} bar(s) ago`] : []),
    ...components.filter((x) => x.value >= 0.6 && x.weight).map((x) => `${x.label} changing`),
    ...agreeing.slice(0, 3).map((v) => v.why),
    ...(chop.choppy ? [`Choppy: ${chop.flags.slice(0, 2).join(", ")}`] : []),
  ];
  return {
    interval, regime: sm.current, previous: sm.previous, changedAgo: sm.changedAgo, pending: sm.pending, raw, direction, score, components, evidence,
    earlyTransition, group, strategies: adaptation.preferred, reason: why.join(" · ") || `Stable ${V3_LABEL[sm.current].toLowerCase()}`,
    alerts, chop, exhaustion, divergences, squeeze, volume, trap, session, adaptation,
  };
}

// ---------------- Multi-timeframe support / resistance zones ----------------
const TF_WEIGHT: Record<Interval, number> = { "1m": 1, "5m": 1.5, "15m": 2, "30m": 2.5, "1h": 3 };
export interface SrZone { kind: "support" | "resistance"; top: number; bottom: number; touches: number; frames: Interval[]; strength: number; event?: string }
export function srZones(frames: { interval: Interval; series: Series; i: number }[], price: number, atrRef: number, max = 6): SrZone[] {
  if (!(atrRef > 0)) return [];
  const pts: { p: number; w: number; iv: Interval; kind: "high" | "low" }[] = [];
  for (const f of frames) for (const kind of ["high", "low"] as const) for (const sw of knownSwings(f.series, f.i, kind, 12, 300)) pts.push({ p: sw.price, w: TF_WEIGHT[f.interval], iv: f.interval, kind });
  pts.sort((a, b) => a.p - b.p);
  const groups: (typeof pts)[] = [];
  for (const p of pts) { const g = groups[groups.length - 1]; if (g && p.p - g[0].p <= atrRef * 0.35) g.push(p); else groups.push([p]); }
  const ref = frames.find((f) => f.interval === "15m") ?? frames[0];
  const zones = groups.filter((g) => g.length >= 2).map((g): SrZone => {
    const top = Math.max(...g.map((x) => x.p)), bottom = Math.min(...g.map((x) => x.p));
    const tfs = [...new Set(g.map((x) => x.iv))];
    const kind = price >= (top + bottom) / 2 ? "support" : "resistance";
    let event: string | undefined;
    if (ref) {
      const c = ref.series.candles, from = Math.max(1, ref.i - 20);
      const wasRes = g.filter((x) => x.kind === "high").length > g.length / 2;
      let rejections = 0, brokeAt = -1;
      for (let j = from; j <= ref.i; j++) {
        if (c[j].h >= bottom && c[j].c < bottom && c[j].o < top) rejections++;
        else if (c[j].l <= top && c[j].c > top && c[j].o > bottom) rejections++;
        if (brokeAt < 0 && ((wasRes && c[j].c > top) || (!wasRes && c[j].c < bottom))) brokeAt = j;
      }
      const now = c[ref.i];
      if (brokeAt >= 0) {
        const retested = c.slice(brokeAt + 1, ref.i + 1).some((b) => (wasRes ? b.l <= top && b.c > top : b.h >= bottom && b.c < bottom));
        const holding = wasRes ? now.c > top : now.c < bottom;
        event = holding ? (retested ? `Break and retest — ${wasRes ? "resistance became support" : "support became resistance"}` : `Role reversal: ${wasRes ? "resistance → support" : "support → resistance"}`) : `Failed ${wasRes ? "resistance" : "support"} break`;
        if (!holding && g.length >= 3) event = `Failed ${wasRes ? "resistance" : "support"} (broken, back inside)`;
      } else if (rejections >= 2) event = `Repeated rejection (${rejections}× in 20 bars) — ${wasRes ? "supply" : "demand"} reaction`;
    }
    const strength = g.reduce((a, x) => a + x.w, 0) + tfs.length * 2;
    return { kind, top, bottom, touches: g.length, frames: tfs, strength, event };
  });
  const maxS = Math.max(1, ...zones.map((z) => z.strength));
  return zones.map((z) => ({ ...z, strength: Math.round((z.strength / maxS) * 100) }))
    .sort((a, b) => Math.abs((a.top + a.bottom) / 2 - price) - Math.abs((b.top + b.bottom) / 2 - price)).slice(0, max)
    .sort((a, b) => b.top - a.top);
}

// ---------------- Correlation / intermarket ----------------
export interface CorrelationRead { reference: string; label: string; now: number; before: number; breakdown: boolean; text: string }
const pearson = (x: number[], y: number[]) => {
  const n = x.length; if (n < 10) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
};
/** Return correlation on timestamp-aligned bars: latest n vs the n before, flagging relationship breakdowns. */
export function correlation(a: Candle[], b: Candle[], n = 50): { now: number; before: number; breakdown: boolean } | undefined {
  const mb = new Map(b.map((x) => [x.t, x.c]));
  const ra: number[] = [], rb: number[] = [];
  for (let k = 1; k < a.length; k++) {
    const b0 = mb.get(a[k - 1].t), b1 = mb.get(a[k].t);
    if (b0 === undefined || b1 === undefined || !(a[k - 1].c > 0) || !(b0 > 0)) continue;
    ra.push(Math.log(a[k].c / a[k - 1].c)); rb.push(Math.log(b1 / b0));
  }
  if (ra.length < n + 10) return undefined;
  const now = pearson(ra.slice(-n), rb.slice(-n)), before = pearson(ra.slice(-2 * n, -n), rb.slice(-2 * n, -n));
  if (!Number.isFinite(now)) return undefined;
  const breakdown = Number.isFinite(before) && (Math.abs(now - before) > 0.5 || (Math.abs(before) > 0.4 && Math.sign(now) !== Math.sign(before)));
  return { now, before, breakdown };
}
/** Reference market used as a confirmation factor (never a trading rule). */
export function referenceFor(symbol: string): { symbol: string; label: string } | undefined {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^BTC/.test(s)) return { symbol: "ETHUSD", label: "ETH (crypto-market breadth)" };
  if (/^(ETH|SOL|XRP|ADA|DOGE|LTC|BNB|AVAX|DOT|LINK)/.test(s)) return { symbol: "BTCUSD", label: "BTC (crypto-market direction)" };
  if (/XAU|GOLD/.test(s)) return { symbol: "EURUSD", label: "EURUSD (inverse USD-strength proxy)" };
  if (/^EURUSD/.test(s)) return { symbol: "GBPUSD", label: "GBPUSD (USD pairs)" };
  if (/^(GBPUSD|AUDUSD|NZDUSD)/.test(s)) return { symbol: "EURUSD", label: "EURUSD (USD pairs)" };
  if (/^USD(JPY|CHF|CAD)/.test(s)) return { symbol: "EURUSD", label: "EURUSD (inverse USD pairs)" };
  if (/US30|DJ/.test(s)) return { symbol: "NAS100", label: "NAS100 (major indices)" };
  if (/NAS|US100|SPX|US500/.test(s)) return { symbol: "US30", label: "US30 (major indices)" };
  return undefined;
}
export const YIELDS_NOTE = "US Treasury yields: no yield feed connected — not used.";
export function describeCorrelation(ref: { symbol: string; label: string }, r: { now: number; before: number; breakdown: boolean }): CorrelationRead {
  const strength = Math.abs(r.now) >= 0.6 ? "strong" : Math.abs(r.now) >= 0.3 ? "moderate" : "weak";
  const sign = r.now >= 0 ? "positive" : "negative";
  const text = r.breakdown
    ? `Correlation breakdown with ${ref.label}: ${r.before.toFixed(2)} → ${r.now.toFixed(2)} — relationship changing`
    : `${strength[0].toUpperCase()}${strength.slice(1)} ${sign} correlation with ${ref.label} (${r.now.toFixed(2)})`;
  return { reference: ref.symbol, label: ref.label, now: r.now, before: r.before, breakdown: r.breakdown, text };
}
