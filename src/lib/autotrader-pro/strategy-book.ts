/**
 * AutoTrader Pro strategy book — 220 strategies in 22 families of 10 variants (pure).
 * Candle reading: every trend/transition signal must close near its extreme in the trade direction without a big
 * opposing rejection wick, and swing structure (higher lows / lower highs) is checked as confirmation.
 * Smart money (V): displacement candle that breaks structure and leaves a fair-value gap, then a retest of the gap.
 * Breakout set: B channel, E squeeze, Q range break, R retest, T pre-breakout pressure, U momentum-candle break.
 * Trend mode (A–L): A–I fire on a fresh trigger, J–L keep giving BUY/SELL while a clean trend holds; they only
 * trade with the EMA trend. Range mode (M–O): band fades, RSI snapbacks and failed-breakout traps that trade
 * the swing back to the middle when there is NO clean trend, so the robot is not trend-only.
 * Shared mentality: never chase an overextended move, place the stop beyond structure, size targets to room.
 */
import { bollinger, ema, finite, macd, pivots, rsi, type Series } from "./indicators";
import type { Candidate, Interval, Regime, Side } from "./types";
import type { Params, StrategyDef } from "./strategies";

export type BookRole = "context" | "breakout" | "continuation" | "reversal";
export type BookMode = "trend" | "range" | "transition";
export type BookGroup = "trending" | "ranging" | "breakout" | "reversal" | "high_volatility" | "choppy" | "compression";

/* ---------- memoised indicators (computed once per series, reused by every bar) ---------- */
const memo = new WeakMap<Series, Map<string, unknown>>();
function cached<T>(s: Series, key: string, f: () => T): T {
  let m = memo.get(s);
  if (!m) { m = new Map(); memo.set(s, m); }
  if (!m.has(key)) m.set(key, f());
  return m.get(key) as T;
}
const emaOf = (s: Series, n: number) => n === 9 ? s.ema9 : n === 21 ? s.ema21 : n === 50 ? s.ema50 : n === 200 ? s.ema200 : cached(s, `e${n}`, () => ema(s.closes, n));
const rsiOf = (s: Series, n: number) => n === 14 ? s.rsi : cached(s, `r${n}`, () => rsi(s.closes, n));
const macdOf = (s: Series, f: number, sl: number, sg: number) => cached(s, `m${f}-${sl}-${sg}`, () => macd(s.closes, f, sl, sg));
const bbOf = (s: Series, n: number) => cached(s, `b${n}`, () => bollinger(s.closes, n));
const pivOf = (s: Series, l: number, r: number) => cached(s, `p${l}-${r}`, () => pivots(s.candles, l, r));

const px = (n: number) => n.toFixed(n >= 1000 ? 2 : n >= 10 ? 3 : 5);
const hi = (s: Series, a: number, b: number) => { let x = -Infinity; for (let j = Math.max(0, a); j <= b; j++) x = Math.max(x, s.candles[j].h); return x; };
const lo = (s: Series, a: number, b: number) => { let x = Infinity; for (let j = Math.max(0, a); j <= b; j++) x = Math.min(x, s.candles[j].l); return x; };
const bodyPct = (s: Series, i: number) => { const c = s.candles[i]; const r = c.h - c.l; return r > 0 ? Math.abs(c.c - c.o) / r : 0; };
const closesWith = (s: Series, i: number, d: number) => (s.candles[i].c - s.candles[i].o) * d > 0;
/** Where the close sits inside the candle, measured in the trade direction (1 = closed on the extreme). */
const closeLoc = (s: Series, i: number, d: number) => { const k = s.candles[i], r = k.h - k.l; return r > 0 ? (d > 0 ? (k.c - k.l) / r : (k.h - k.c) / r) : 0.5; };
/** Share of the candle that is a wick pushing against the trade (upper wick for a BUY). */
const opposingWick = (s: Series, i: number, d: number) => { const k = s.candles[i], r = k.h - k.l; return r > 0 ? (d > 0 ? k.h - Math.max(k.o, k.c) : Math.min(k.o, k.c) - k.l) / r : 0; };
/** Last two confirmed swings agree with the direction: higher low + higher high (BUY) or lower high + lower low (SELL). */
function swingsAgree(s: Series, i: number, d: number): boolean {
  const pv = pivOf(s, 2, 2), H: number[] = [], L: number[] = [];
  for (let j = i - 2; j >= Math.max(0, i - 80) && (H.length < 2 || L.length < 2); j--) { if (pv.high[j] && H.length < 2) H.push(s.candles[j].h); if (pv.low[j] && L.length < 2) L.push(s.candles[j].l); }
  if (H.length < 2 || L.length < 2) return false;
  return d > 0 ? L[0] > L[1] && H[0] > H[1] : H[0] < H[1] && L[0] < L[1];
}
/** Last confirmed swing low (BUY) / high (SELL) before bar `end` — the structure a pullback must not break. */
function lastSwing(s: Series, end: number, d: number): number | undefined {
  const pv = pivOf(s, 2, 2);
  for (let j = end - 2; j >= Math.max(0, end - 60); j--) if (d > 0 ? pv.low[j] : pv.high[j]) return d > 0 ? s.candles[j].l : s.candles[j].h;
  return undefined;
}
/** Times price touched `lvl` (within 0.15 ATR) in bars a..b — repeated touches mean a real level with resting orders. */
const touches = (s: Series, a: number, b: number, lvl: number, atrv: number) => { let n = 0; for (let j = Math.max(0, a); j <= b; j++) { const k = s.candles[j]; if (k.l - 0.15 * atrv <= lvl && k.h + 0.15 * atrv >= lvl) n++; } return n; };
const avgRange = (s: Series, a: number, b: number) => { let t = 0, n = 0; for (let j = Math.max(0, a); j <= b; j++) { t += s.candles[j].h - s.candles[j].l; n++; } return n ? t / n : NaN; };

/** Trend bias from the slow EMA: price and the faster EMA on one side, slow EMA sloping that way. */
export function trendBias(s: Series, i: number, slow = 50): -1 | 0 | 1 {
  const e = emaOf(s, slow), f = emaOf(s, Math.max(5, Math.round(slow * 0.4)));
  if (i < 6 || !finite(e[i], e[i - 5], f[i])) return 0;
  const c = s.candles[i].c, slope = e[i] - e[i - 5], min = 0.1 * (Number.isFinite(s.atr[i]) ? s.atr[i] : 0);
  // A flat slow EMA is not a trend: the slope over 5 bars must be at least 0.1 ATR.
  if (c > e[i] && f[i] > e[i] && slope > min) return 1;
  if (c < e[i] && f[i] < e[i] && slope < -min) return -1;
  return 0;
}

interface Trade { dir: 1 | -1; trigger: string; stop: number; target?: number; soft?: { ok: boolean; yes: string; no: string }[]; validBars?: number }

/** Shared finisher: trend + no-chase + stop sanity are hard rules; soft checks decide early vs confirmed. */
function finish(id: string, s: Series, i: number, t: Trade, p: Params, slow = 50, mode: BookMode = "trend"): { candidate?: Candidate; blockers: string[] } {
  const c = s.candles[i], a = s.atr[i], side: Side = t.dir > 0 ? "BUY" : "SELL";
  const fair = emaOf(s, 21)[i];
  if (finite(fair) && (c.c - fair) * t.dir > (p.maxExt ?? 2.5) * a) return { blockers: [`Overextended ${(Math.abs(c.c - fair) / a).toFixed(1)} ATR from EMA 21 — wait for a pullback`] };
  if (mode !== "range" && opposingWick(s, i, t.dir) >= 0.5) return { blockers: [`Signal candle shows ${t.dir > 0 ? "sellers" : "buyers"} rejecting the move (long ${t.dir > 0 ? "upper" : "lower"} wick) — wait`] };
  const buf = (p.buf ?? 0.15) * a;
  let stop = t.dir > 0 ? Math.min(t.stop - buf, c.c - 0.6 * a) : Math.max(t.stop + buf, c.c + 0.6 * a);
  if (Math.abs(c.c - stop) > 3 * a) stop = c.c - t.dir * 3 * a;
  const soft = [
    ...(t.soft ?? []),
    { ok: closesWith(s, i, t.dir) && bodyPct(s, i) >= 0.45, yes: "Decisive candle close", no: "Needs a decisive candle close in the trade direction" },
    { ok: closeLoc(s, i, t.dir) >= 0.6, yes: `Closed in the ${t.dir > 0 ? "top" : "bottom"} of its range`, no: "Candle closed mid-range — control not proven" },
    ...(mode === "trend" ? [{ ok: swingsAgree(s, i, t.dir), yes: t.dir > 0 ? "Swing structure: higher highs and higher lows" : "Swing structure: lower highs and lower lows", no: "Swing structure not yet confirming the trend" }] : []),
    mode === "trend"
      ? { ok: !Number.isFinite(s.adx[i]) || s.adx[i] >= 16, yes: `Trend strength ADX ${Math.round(s.adx[i])}`, no: "Trend strength (ADX) still weak" }
      : mode === "range"
        ? { ok: !Number.isFinite(s.adx[i]) || s.adx[i] <= 25, yes: `Range conditions ADX ${Math.round(s.adx[i])}`, no: "ADX rising — range may be turning into a trend" }
        : { ok: !finite(s.adx[i], s.adx[i - 3]) || s.adx[i] > s.adx[i - 3], yes: "Momentum building (ADX rising)", no: "Momentum not building yet (ADX flat)" },
  ];
  const context = mode === "trend" ? `With the trend (EMA ${slow} ${t.dir > 0 ? "rising, price above" : "falling, price below"})`
    : mode === "range" ? "Range mode: no clean trend, trading the swing back to value" : "Transition: the market is changing state — trading the new move early";
  const confirmations = [context, t.trigger, ...soft.filter((x) => x.ok).map((x) => x.yes)];
  if (s.hasVolume && s.candles[i].v > s.volSma[i]) confirmations.push("Volume above average");
  const missing = soft.filter((x) => !x.ok).map((x) => x.no);
  return {
    blockers: [],
    candidate: {
      strategy: id, side, stage: missing.length ? "early" : "confirmed", confirmations, missing,
      entry: c.c, entryZone: [c.c - a * 0.25, c.c + a * 0.25], structuralStop: stop, structuralTarget: t.target,
      invalidation: `${side === "BUY" ? "Close below" : "Close above"} ${px(stop)}`, reason: t.trigger, validBars: t.validBars ?? 3,
    },
  };
}

type Rule = (s: Series, i: number, p: Params, dir: 1 | -1) => Trade | string;
interface Family { mode?: BookMode; key: string; letter: string; title: string; role: BookRole; groups: BookGroup[]; suited: Regime[]; slow: number; describe: (v: Params) => string; label: (v: Params) => string; rule: Rule }

const TREND: Regime[] = ["strong_bull", "strong_bear", "breakout"];
const BREAK: Regime[] = ["breakout", "high_volatility", "strong_bull", "strong_bear"];
const PULL: Regime[] = ["strong_bull", "strong_bear", "ranging", "reversal"];
const RANGE: Regime[] = ["ranging", "low_volatility", "reversal", "high_volatility"];

const FAMILIES: Family[] = [
  { key: "pb", letter: "A", title: "Trend Pullback", role: "continuation", groups: ["trending"], suited: TREND, slow: 50,
    label: (v) => `EMA ${v.fast}/${v.slow}`, describe: (v) => `Uptrend (EMA ${v.fast} > ${v.slow}): buy the dip into EMA ${v.fast} once a candle closes back above it; mirror for sells.`,
    rule: (s, i, v, d) => {
      const f = emaOf(s, v.fast), sl = emaOf(s, v.slow), a = s.atr[i], c = s.candles[i];
      if (!finite(f[i], sl[i], sl[i - 3])) return "Not enough history";
      if ((f[i] - sl[i]) * d <= 0 || (sl[i] - sl[i - 3]) * d <= 0) return `EMA ${v.fast}/${v.slow} not stacked with the trend`;
      let touched = false;
      for (let j = i - 3; j <= i; j++) { const k = s.candles[j]; if (d > 0 ? k.l <= f[j] + 0.2 * a : k.h >= f[j] - 0.2 * a) touched = true; }
      if (!touched) return `No pullback into EMA ${v.fast} yet`;
      if ((c.c - f[i]) * d <= 0) return `Price not back ${d > 0 ? "above" : "below"} EMA ${v.fast}`;
      const sw = lastSwing(s, i - 5, d), ext = d > 0 ? lo(s, i - 5, i) : hi(s, i - 5, i);
      if (sw !== undefined && (ext - sw) * d < 0) return `Pullback broke the last swing ${d > 0 ? "low" : "high"} ${px(sw)} — structure damaged`;
      const corrective = avgRange(s, i - 3, i - 1) < avgRange(s, i - 12, i - 4);
      return { dir: d, trigger: `Pullback to EMA ${v.fast} rejected`, stop: ext,
        soft: [{ ok: (c.c - (d > 0 ? s.candles[i - 1].h : s.candles[i - 1].l)) * d > 0, yes: "Closed beyond the prior candle", no: "Needs a close beyond the prior candle" },
          { ok: corrective, yes: "Corrective pullback (smaller candles than the impulse)", no: "Pullback candles are large — may be a reversal" }] };
    } },
  { key: "bo", letter: "B", title: "Channel Breakout", role: "breakout", groups: ["breakout", "high_volatility"], suited: BREAK, slow: 50,
    label: (v) => `${v.n}-bar`, describe: (v) => `Fresh close beyond the ${v.n}-bar high (low) in the trend direction; measured-move target.`,
    rule: (s, i, v, d) => {
      const top = hi(s, i - v.n, i - 1), bot = lo(s, i - v.n, i - 1), c = s.candles[i], p = s.candles[i - 1], a = s.atr[i];
      const lvl = d > 0 ? top : bot;
      if ((c.c - lvl) * d <= 0) return `Inside the ${v.n}-bar channel ${px(bot)}–${px(top)}`;
      if ((p.c - lvl) * d > 0) return "Breakout already in progress — not fresh";
      if (closeLoc(s, i, d) < 0.65) return "Breakout candle closed off its extreme — weak break";
      const h = top - bot, tests = touches(s, i - v.n, i - 1, lvl, a);
      return { dir: d, trigger: `Closed beyond the ${v.n}-bar ${d > 0 ? "high" : "low"} ${px(lvl)}`, stop: d > 0 ? Math.max(lo(s, i - 3, i), lvl - a) : Math.min(hi(s, i - 3, i), lvl + a),
        target: c.c + d * h, soft: [{ ok: h >= 1.5 * a, yes: "Solid base before the break", no: "Base too thin — breakout may fail" },
          { ok: tests >= 2, yes: `Level tested ${tests}× before breaking`, no: "Level barely tested — breakout may be random" },
          { ok: c.h - c.l >= s.atr[i - 1], yes: "Range expansion on the break", no: "No range expansion on the break" }] };
    } },
  { key: "rs", letter: "C", title: "RSI Momentum Reset", role: "continuation", groups: ["trending"], suited: TREND, slow: 50,
    label: (v) => `RSI ${v.n} · ${v.lvl}`, describe: (v) => `In an uptrend RSI(${v.n}) cools to ${v.lvl} without breaking down, then hooks back up; mirror for sells.`,
    rule: (s, i, v, d) => {
      const r = rsiOf(s, v.n), L = d > 0 ? v.lvl : 100 - v.lvl;
      if (!finite(r[i], r[i - 1])) return "Not enough history";
      let dipped = false, broke = false;
      for (let j = i - 5; j < i; j++) { if ((r[j] - L) * d <= 0) dipped = true; if ((r[j] - (d > 0 ? 25 : 75)) * d < 0) broke = true; }
      if (!dipped) return `RSI ${v.n} has not reset to ${L}`;
      if (broke) return "Momentum broke down too far — trend in doubt";
      if ((r[i] - L) * d <= 0 || (r[i] - r[i - 1]) * d <= 0) return `RSI ${v.n} not hooking back`;
      return { dir: d, trigger: `RSI ${v.n} reset to ${L} and turned ${d > 0 ? "up" : "down"}`, stop: d > 0 ? lo(s, i - 6, i) : hi(s, i - 6, i) };
    } },
  { key: "md", letter: "D", title: "MACD Trend Trigger", role: "continuation", groups: ["trending"], suited: TREND, slow: 50,
    label: (v) => `${v.f}/${v.sl}/${v.sg}`, describe: (v) => `MACD(${v.f},${v.sl},${v.sg}) histogram flips back with the trend after a pullback.`,
    rule: (s, i, v, d) => {
      const m = macdOf(s, v.f, v.sl, v.sg);
      if (!finite(m.hist[i], m.hist[i - 1], m.line[i])) return "Not enough history";
      if (!(m.hist[i] * d > 0 && m.hist[i - 1] * d <= 0)) return "No fresh MACD histogram flip with the trend";
      return { dir: d, trigger: `MACD ${v.f}/${v.sl}/${v.sg} histogram flipped ${d > 0 ? "positive" : "negative"}`, stop: d > 0 ? lo(s, i - 6, i) : hi(s, i - 6, i),
        soft: [{ ok: m.line[i] * d > 0, yes: "MACD line on the trend side of zero", no: "MACD line still on the wrong side of zero" }] };
    } },
  { key: "sq", letter: "E", title: "Squeeze Release", role: "breakout", groups: ["compression", "breakout"], suited: ["low_volatility", "breakout", "strong_bull", "strong_bear"], slow: 50,
    label: (v) => `BB ${v.n} · ${v.look}`, describe: (v) => `Bollinger(${v.n}) width in the tightest ${Math.round(v.pct * 100)}% of ${v.look} bars, then a close outside the band with the trend.`,
    rule: (s, i, v, d) => {
      const b = bbOf(s, v.n), c = s.candles[i];
      if (i < v.look + v.n || !finite(b.mid[i], b.sd[i], b.sd[i - 1])) return "Not enough history";
      const w = (j: number) => (4 * b.sd[j]) / b.mid[j];
      let below = 0, n = 0;
      for (let j = i - v.look; j < i - 1; j++) { if (!Number.isFinite(w(j))) continue; n++; if (w(j) <= w(i - 1)) below++; }
      if (!n || below / n > v.pct) return "No volatility squeeze";
      const band = b.mid[i] + d * 2 * b.sd[i];
      if ((c.c - band) * d <= 0) return "Squeeze not released yet";
      return { dir: d, trigger: `Squeeze released ${d > 0 ? "upward" : "downward"} through the band ${px(band)}`, stop: d > 0 ? Math.max(lo(s, i - 3, i), b.mid[i] - s.atr[i]) : Math.min(hi(s, i - 3, i), b.mid[i] + s.atr[i]) };
    } },
  { key: "bs", letter: "F", title: "Structure Break", role: "context", groups: ["trending", "breakout"], suited: TREND, slow: 50,
    label: (v) => `swing ${v.l}/${v.r}`, describe: (v) => `Higher low then a close through the last swing high (swing strength ${v.l}/${v.r}); mirror for sells.`,
    rule: (s, i, v, d) => {
      const pv = pivOf(s, v.l, v.r), H: number[] = [], Lw: number[] = [];
      for (let j = i - v.r; j >= Math.max(0, i - v.look) && (H.length < 2 || Lw.length < 2); j--) { if (pv.high[j] && H.length < 2) H.push(s.candles[j].h); if (pv.low[j] && Lw.length < 2) Lw.push(s.candles[j].l); }
      if (H.length < 2 || Lw.length < 2) return "Not enough swings";
      const level = d > 0 ? H[0] : Lw[0], c = s.candles[i], p = s.candles[i - 1];
      if (d > 0 ? Lw[0] <= Lw[1] : H[0] >= H[1]) return d > 0 ? "No higher low" : "No lower high";
      if ((c.c - level) * d <= 0 || (p.c - level) * d > 0) return "No fresh break of structure";
      return { dir: d, trigger: `Break of structure through ${px(level)}`, stop: d > 0 ? Lw[0] : H[0] };
    } },
  { key: "ls", letter: "G", title: "Liquidity Sweep Reclaim", role: "continuation", groups: ["ranging", "reversal", "choppy"], suited: PULL, slow: 100,
    label: (v) => `${v.n}-bar sweep`, describe: (v) => `In an uptrend price wicks under the ${v.n}-bar low (stops taken) and closes back above it; mirror for sells.`,
    rule: (s, i, v, d) => {
      const c = s.candles[i], lvl = d > 0 ? lo(s, i - v.n, i - 1) : hi(s, i - v.n, i - 1);
      if (d > 0 ? !(c.l < lvl && c.c > lvl) : !(c.h > lvl && c.c < lvl)) return `No sweep and reclaim of the ${v.n}-bar ${d > 0 ? "low" : "high"}`;
      const a = s.atr[i], depth = (lvl - (d > 0 ? c.l : c.h)) * d;
      if (depth > a) return "Swept too deep — real breakdown, not a stop hunt";
      if (closeLoc(s, i, d) < 0.5) return "Reclaim candle closed weak — no rejection";
      const r = c.h - c.l, wick = d > 0 ? Math.min(c.o, c.c) - c.l : c.h - Math.max(c.o, c.c), pool = touches(s, i - v.n, i - 1, lvl, a);
      return { dir: d, trigger: `Swept ${px(lvl)} and reclaimed it`, stop: d > 0 ? c.l : c.h,
        soft: [{ ok: r > 0 && wick / r >= 0.4, yes: "Long rejection wick", no: "Rejection wick is small" },
          { ok: pool >= 2, yes: `Liquidity pool: ${pool} ${d > 0 ? "equal lows" : "equal highs"} swept`, no: "No clear equal highs/lows pool at the level" }] };
    } },
  { key: "zn", letter: "H", title: "Demand/Supply Retest", role: "continuation", groups: ["ranging", "high_volatility", "choppy"], suited: PULL, slow: 50,
    label: (v) => `${v.k}×ATR · ${v.age} bars`, describe: (v) => `A ${v.k}×ATR impulse leaves a zone; buy the first retest that holds and closes back out of it (mirror for supply).`,
    rule: (s, i, v, d) => {
      const c = s.candles[i];
      for (let j = i - 3; j >= Math.max(1, i - v.age); j--) {
        const k = s.candles[j], a = s.atr[j];
        if (!finite(a) || k.h - k.l < v.k * a || bodyPct(s, j) < 0.6 || !closesWith(s, j, d)) continue;
        const top = k.o, bot = d > 0 ? k.l : k.h;
        let broken = false;
        for (let x = j + 1; x < i; x++) if ((s.candles[x].c - bot) * d < 0) broken = true;
        if (broken) return "Zone already broken";
        const touched = d > 0 ? c.l <= top : c.h >= top;
        if (!touched || (c.c - top) * d <= 0) return "Waiting for a retest that holds the zone";
        return { dir: d, trigger: `Retest of the ${d > 0 ? "demand" : "supply"} zone ${px(Math.min(top, bot))}–${px(Math.max(top, bot))} held`, stop: bot, target: d > 0 ? k.h : k.l };
      }
      return "No fresh impulse zone";
    } },
  { key: "pa", letter: "I", title: "Price Action", role: "continuation", groups: ["trending", "reversal"], suited: PULL, slow: 50,
    label: (v) => PATTERNS[v.pat].name, describe: (v) => `${PATTERNS[v.pat].name} at value (near EMA 21) in the trend direction.`,
    rule: (s, i, v, d) => {
      const pat = PATTERNS[v.pat];
      const e21 = s.ema21[i], a = s.atr[i];
      if (pat.atValue && finite(e21) && Math.abs(s.candles[i].l - e21) > a && Math.abs(s.candles[i].h - e21) > a) return "Not at value (too far from EMA 21)";
      if (!pat.test(s, i, d)) return `No ${pat.name.toLowerCase()}`;
      return { dir: d, trigger: `${pat.name} with the trend`, stop: d > 0 ? lo(s, i - 3, i) : hi(s, i - 3, i), validBars: 2 };
    } },
  { key: "tr", letter: "J", title: "Trend Ride", role: "continuation", groups: ["trending"], suited: TREND, slow: 50,
    label: (v) => `EMA ${v.fast}/${v.slow} · RSI ${v.n}`, describe: (v) => `While EMA ${v.fast} > ${v.slow} both rise and price holds near EMA ${v.fast} with RSI(${v.n}) in the healthy zone, ride the trend; mirror for sells.`,
    rule: (s, i, v, d) => {
      const f = emaOf(s, v.fast), sl = emaOf(s, v.slow), r = rsiOf(s, v.n), a = s.atr[i], c = s.candles[i];
      if (!finite(f[i], f[i - 3], sl[i], sl[i - 3], r[i])) return "Not enough history";
      if ((f[i] - sl[i]) * d <= 0 || (f[i] - f[i - 3]) * d <= 0 || (sl[i] - sl[i - 3]) * d <= 0) return `EMA ${v.fast}/${v.slow} not stacked and rising with the trend`;
      if ((c.c - sl[i]) * d <= 0) return `Price back through EMA ${v.slow}`;
      if ([0, 1, 2].every((q) => closesWith(s, i - q, -d))) return "Last 3 candles closed against the trend — flow interrupted";
      if ((c.c - f[i]) * d > 1.2 * a) return `Too far from EMA ${v.fast} — wait for value`;
      const rr = d > 0 ? r[i] : 100 - r[i];
      if (rr < 50 || rr > 72) return rr < 50 ? `RSI ${v.n} lost the trend side` : `RSI ${v.n} stretched — wait for a cool-off`;
      return { dir: d, trigger: `Riding the trend: EMA ${v.fast}/${v.slow} stacked, RSI ${v.n} ${Math.round(r[i])}`, stop: d > 0 ? Math.min(lo(s, i - 8, i), sl[i]) : Math.max(hi(s, i - 8, i), sl[i]),
        soft: [{ ok: (c.c - f[i]) * d > 0, yes: `Holding ${d > 0 ? "above" : "below"} EMA ${v.fast}`, no: `Dipped through EMA ${v.fast} — wait for it to hold` }], validBars: 2 };
    } },
  { key: "mf", letter: "K", title: "Momentum Flow", role: "continuation", groups: ["trending", "breakout"], suited: TREND, slow: 50,
    label: (v) => `MACD ${v.f}/${v.sl}/${v.sg}`, describe: (v) => `MACD(${v.f},${v.sl},${v.sg}) above its signal and above zero with the trend, price on the EMA 21 side and RSI not exhausted.`,
    rule: (s, i, v, d) => {
      const m = macdOf(s, v.f, v.sl, v.sg), c = s.candles[i];
      if (!finite(m.line[i], m.signal[i], m.hist[i], m.hist[i - 1], s.ema21[i], s.rsi[i])) return "Not enough history";
      if (m.line[i] * d <= 0 || m.hist[i] * d <= 0) return "Momentum not flowing with the trend";
      if ((c.c - s.ema21[i]) * d <= 0) return "Price on the wrong side of EMA 21";
      const rr = d > 0 ? s.rsi[i] : 100 - s.rsi[i];
      if (rr > 74) return "Momentum exhausted (RSI stretched)";
      if ([0, 1, 2].every((q) => closesWith(s, i - q, -d))) return "Last 3 candles closed against the flow";
      return { dir: d, trigger: `Momentum flowing ${d > 0 ? "up" : "down"} (MACD ${v.f}/${v.sl}/${v.sg})`, stop: d > 0 ? lo(s, i - 6, i) : hi(s, i - 6, i),
        soft: [{ ok: (m.hist[i] - m.hist[i - 1]) * d >= 0, yes: "Momentum building", no: "Momentum fading — size down or wait" }], validBars: 2 };
    } },
  { key: "cp", letter: "L", title: "Channel Position", role: "continuation", groups: ["trending", "breakout"], suited: TREND, slow: 50,
    label: (v) => `${v.n}-bar channel`, describe: (v) => `Price holding the upper half of a rising ${v.n}-bar channel (lower half of a falling one) without hugging the extreme.`,
    rule: (s, i, v, d) => {
      const top = hi(s, i - v.n, i), bot = lo(s, i - v.n, i), c = s.candles[i], h = top - bot, a = s.atr[i];
      const mid = (top + bot) / 2, midPrev = (hi(s, i - v.n - 5, i - 5) + lo(s, i - v.n - 5, i - 5)) / 2;
      if (!(h > 0) || !finite(midPrev)) return "Not enough history";
      if ((mid - midPrev) * d <= 0) return `${v.n}-bar channel not moving with the trend`;
      const pos = (c.c - bot) / h, side = d > 0 ? pos : 1 - pos;
      if (side < 0.55) return `Price not holding the ${d > 0 ? "upper" : "lower"} half of the channel`;
      if (side > 0.92 && h < 4 * a) return "Pressed against the channel edge — wait for a dip";
      return { dir: d, trigger: `Holding the ${d > 0 ? "upper" : "lower"} channel half (${Math.round(side * 100)}%) of a ${d > 0 ? "rising" : "falling"} ${v.n}-bar channel`,
        stop: d > 0 ? Math.max(lo(s, i - 5, i), mid - a) : Math.min(hi(s, i - 5, i), mid + a), validBars: 2 };
    } },
  { mode: "range", key: "rf", letter: "M", title: "Range Band Fade", role: "reversal", groups: ["ranging", "choppy", "reversal"], suited: RANGE, slow: 50,
    label: (v) => `BB ${v.n}`, describe: (v) => `No clean trend: price pokes outside the ${v.n}-bar Bollinger band and closes back inside — fade it back to the middle band.`,
    rule: (s, i, v) => {
      const bb = bbOf(s, v.n), c = s.candles[i], a = s.atr[i];
      if (!finite(bb.mid[i], bb.sd[i], bb.mid[i - 1], bb.sd[i - 1])) return "Not enough history";
      const band = (j: number, k: number) => bb.mid[j] + k * 2 * bb.sd[j];
      const b = { mid: bb.mid, upper: { [i]: band(i, 1), [i - 1]: band(i - 1, 1) } as Record<number, number>, lower: { [i]: band(i, -1), [i - 1]: band(i - 1, -1) } as Record<number, number> };
      const pokedLo = Math.min(s.candles[i - 1].l, c.l) <= b.lower[i - 1], pokedHi = Math.max(s.candles[i - 1].h, c.h) >= b.upper[i - 1];
      const d: 1 | -1 | 0 = pokedLo && c.c > b.lower[i] && closesWith(s, i, 1) ? 1 : pokedHi && c.c < b.upper[i] && closesWith(s, i, -1) ? -1 : 0;
      if (!d) return `No rejection of the ${v.n}-bar band`;
      if (Math.abs(b.mid[i] - c.c) < 0.6 * a) return "Too close to the middle band — no room";
      return { dir: d, trigger: `Rejected the ${d > 0 ? "lower" : "upper"} ${v.n}-bar band`, stop: d > 0 ? lo(s, i - 2, i) : hi(s, i - 2, i), target: b.mid[i], validBars: 2 };
    } },
  { mode: "range", key: "rx", letter: "N", title: "RSI Snapback", role: "reversal", groups: ["ranging", "choppy", "reversal"], suited: RANGE, slow: 50,
    label: (v) => `RSI ${v.n} · ${v.lvl}`, describe: (v) => `No clean trend: RSI(${v.n}) stretches past ${v.lvl}/${100 - v.lvl} and snaps back with a candle close — target the 21 EMA.`,
    rule: (s, i, v) => {
      const r = rsiOf(s, v.n), c = s.candles[i], e = s.ema21[i], a = s.atr[i];
      if (!finite(r[i], r[i - 1], r[i - 2], r[i - 3], e)) return "Not enough history";
      const wasLo = Math.min(r[i - 1], r[i - 2], r[i - 3]) < v.lvl, wasHi = Math.max(r[i - 1], r[i - 2], r[i - 3]) > 100 - v.lvl;
      const d: 1 | -1 | 0 = wasLo && r[i] >= v.lvl && closesWith(s, i, 1) ? 1 : wasHi && r[i] <= 100 - v.lvl && closesWith(s, i, -1) ? -1 : 0;
      if (!d) return `RSI ${v.n} not snapping back from an extreme`;
      if ((e - c.c) * d < 0.6 * a) return "Already back near the 21 EMA — no room";
      return { dir: d, trigger: `RSI ${v.n} snapped back from ${d > 0 ? "oversold" : "overbought"}`, stop: d > 0 ? lo(s, i - 4, i) : hi(s, i - 4, i), target: e, validBars: 2 };
    } },
  { mode: "range", key: "fb", letter: "O", title: "Failed Breakout Trap", role: "reversal", groups: ["ranging", "reversal", "choppy"], suited: RANGE, slow: 50,
    label: (v) => `${v.n}-bar trap`, describe: (v) => `Price breaks the ${v.n}-bar high (low), fails within 3 candles and closes back inside — trade the trapped side back to the range middle.`,
    rule: (s, i, v) => {
      const c = s.candles[i];
      for (let b = i - 1; b >= i - 3; b--) {
        const top = hi(s, b - v.n, b - 1), bot = lo(s, b - v.n, b - 1), k = s.candles[b];
        const d: 1 | -1 | 0 = k.h > top && c.c < top && closesWith(s, i, -1) ? -1 : k.l < bot && c.c > bot && closesWith(s, i, 1) ? 1 : 0;
        if (!d) continue;
        const ext = d < 0 ? hi(s, b, i) : lo(s, b, i);
        return { dir: d, trigger: `${d < 0 ? "Bull" : "Bear"} trap: break of the ${v.n}-bar ${d < 0 ? "high" : "low"} ${px(d < 0 ? top : bot)} failed`, stop: ext, target: (top + bot) / 2, validBars: 2 };
      }
      return `No failed ${v.n}-bar breakout`;
    } },
  { mode: "range", key: "mr", letter: "P", title: "Micro Range Scalp", role: "reversal", groups: ["ranging", "choppy", "compression"], suited: RANGE, slow: 50,
    label: (v) => `${v.n} bars · ${v.k} ATR`, describe: (v) => `Short, tight range: the last ${v.n} candles fit inside ${v.k} ATR. Buy a rejection of the box floor, sell a rejection of the ceiling, target the other side.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a = s.atr[i], b = boxAt(s, i - 1, v.n, v.k);
      if (!b) return `No tight ${v.n}-bar range`;
      if (c.c > b.top || c.c < b.bot) return "Price left the box — not a range trade";
      const d2: 1 | -1 | 0 = c.l <= b.bot + 0.15 * b.h && closesWith(s, i, 1) ? 1 : c.h >= b.top - 0.15 * b.h && closesWith(s, i, -1) ? -1 : 0;
      if (!d2) return "No rejection of the box edge";
      const target = d2 > 0 ? b.top - 0.1 * b.h : b.bot + 0.1 * b.h;
      if ((target - c.c) * d2 < 0.6 * a) return "Not enough room inside the box";
      return { dir: d2, trigger: `Rejected the ${d2 > 0 ? "floor" : "ceiling"} of a tight ${v.n}-bar range (${px(b.bot)}–${px(b.top)})`, stop: d2 > 0 ? Math.min(b.bot, c.l) : Math.max(b.top, c.h), target, validBars: 2 };
    } },
  { mode: "transition", key: "rb", letter: "Q", title: "Range Breakout", role: "breakout", groups: ["breakout", "compression"], suited: ["breakout", "low_volatility", "ranging", "high_volatility"], slow: 50,
    label: (v) => `${v.n} bars · ${v.k} ATR`, describe: (v) => `Range → trend transition: a ${v.n}-candle box (≤ ${v.k} ATR tall) breaks with a strong close outside — ride the measured move.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a = s.atr[i], b = boxAt(s, i - 1, v.n, v.k);
      if (!b) return `No ${v.n}-bar range to break`;
      const d: 1 | -1 | 0 = c.c > b.top ? 1 : c.c < b.bot ? -1 : 0;
      if (!d) return "Still inside the range";
      if (!closesWith(s, i, d) || bodyPct(s, i) < 0.6 || c.h - c.l < 1.1 * s.atr[i - 1]) return "Breakout candle is weak — no real expansion";
      if ((d > 0 ? c.h - c.c : c.c - c.l) > 0.25 * (c.h - c.l)) return "Breakout closed off its extreme — sellers/buyers still active";
      const edge = d > 0 ? b.top : b.bot;
      if ((c.c - edge) * d > 1.2 * a) return "Breakout already ran — wait for a retest";
      return { dir: d, trigger: `Broke ${d > 0 ? "above" : "below"} a ${v.n}-bar range at ${px(edge)}`, stop: b.mid,
        target: edge + d * Math.max(b.h, 1.5 * a), validBars: 2 };
    } },
  { mode: "transition", key: "rt", letter: "R", title: "Breakout Retest", role: "continuation", groups: ["breakout", "trending"], suited: BREAK, slow: 50,
    label: (v) => `${v.n} bars · ${v.k} ATR`, describe: (v) => `After a ${v.n}-candle range breaks, price comes back to the broken edge, holds it and turns — join the new move with the stop behind the retest.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a = s.atr[i];
      for (let x = i - 2; x >= i - 8; x--) {
        const b = boxAt(s, x - 1, v.n, v.k), k = s.candles[x];
        if (!b) continue;
        const d: 1 | -1 | 0 = k.c > b.top && closesWith(s, x, 1) ? 1 : k.c < b.bot && closesWith(s, x, -1) ? -1 : 0;
        if (!d) continue;
        const edge = d > 0 ? b.top : b.bot, ext = d > 0 ? lo(s, x + 1, i) : hi(s, x + 1, i);
        const touched = Math.abs(ext - edge) <= 0.35 * a || (edge - ext) * d > 0 && (edge - ext) * d <= 0.3 * a;
        const held = (c.c - edge) * d > 0 && [...Array(i - x)].every((_, j) => (s.candles[x + 1 + j].c - edge) * d > -0.15 * a);
        if (!touched || !held || !closesWith(s, i, d)) return `Waiting for a clean retest of ${px(edge)}`;
        return { dir: d, trigger: `Retested the broken ${v.n}-bar range edge ${px(edge)} and held`, stop: ext, target: d > 0 ? Math.max(edge + b.h, c.c + 1.2 * a) : Math.min(edge - b.h, c.c - 1.2 * a), validBars: 2 };
      }
      return `No recent ${v.n}-bar range breakout`;
    } },
  { mode: "transition", key: "ex", letter: "S", title: "Exhaustion Turn", role: "reversal", groups: ["reversal", "high_volatility"], suited: ["reversal", "high_volatility", "strong_bull", "strong_bear"], slow: 50,
    label: (v) => `${v.n} bars · ${v.k} ATR`, describe: (v) => `Trend → turn transition: a ${v.k} ATR run in ${v.n} candles with RSI stretched past ${100 - v.lvl}/${v.lvl}, then a close through the last 2-candle swing — fade the exhausted move.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a = s.atr[i], r = s.rsi, j = i - 1;
      if (!finite(s.closes[j - v.n], r[i])) return "Not enough history";
      const run = (s.closes[j] - s.closes[j - v.n]) / a, peak = Math.max(...[1, 2, 3, 4, 5].map((q) => r[i - q])), trough = Math.min(...[1, 2, 3, 4, 5].map((q) => r[i - q]));
      const d: 1 | -1 | 0 = run >= v.k && peak >= 100 - v.lvl && c.c < lo(s, i - 2, j) && closesWith(s, i, -1) ? -1 : run <= -v.k && trough <= v.lvl && c.c > hi(s, i - 2, j) && closesWith(s, i, 1) ? 1 : 0;
      if (!d) return "No exhausted run turning";
      const ext = d < 0 ? hi(s, i - 6, i) : lo(s, i - 6, i), move = Math.abs(run) * a;
      const climax = [0, 1, 2, 3, 4].some((q) => s.candles[i - q].h - s.candles[i - q].l >= 1.5 * a);
      return { dir: d, trigger: `${d < 0 ? "Up" : "Down"}-run of ${Math.abs(run).toFixed(1)} ATR exhausted (RSI ${Math.round(d < 0 ? peak : trough)}) and turned`, stop: ext,
        target: ext + d * 0.5 * move, validBars: 2, soft: [{ ok: climax, yes: "Climax candle at the extreme", no: "No climax candle at the extreme" }] };
    } },
  { mode: "transition", key: "pp", letter: "T", title: "Breakout Pressure", role: "breakout", groups: ["breakout", "compression"], suited: ["breakout", "low_volatility", "ranging", "high_volatility"], slow: 50,
    label: (v) => `${v.n} bars · ${v.k} ATR`, describe: (v) => `About to break out: a ${v.n}-candle box (≤ ${v.k} ATR) whose edge is tested again and again while lows rise (or highs fall) and candles shrink — enter before the break, stop under the last higher low, target the measured move.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a = s.atr[i], b = boxAt(s, i, v.n, v.k);
      if (!b) return `No ${v.n}-bar box building pressure`;
      for (const d of [1, -1] as const) {
        const edge = d > 0 ? b.top : b.bot;
        if ((c.c - edge) * d > 0 || (edge - c.c) * d > 0.2 * b.h) continue;
        let tests = 0;
        for (let j = i - v.n + 1; j <= i; j++) if ((d > 0 ? s.candles[j].h : -s.candles[j].l) >= (d > 0 ? edge : -edge) - 0.12 * b.h) tests++;
        const ex = (x: number, y: number) => d > 0 ? lo(s, x, y) : hi(s, x, y);
        const squeezing = (ex(i - 1, i) - ex(i - 3, i - 2)) * d > 0 && (ex(i - 3, i - 2) - ex(i - 5, i - 4)) * d > 0;
        if (tests < 2 || !squeezing || !closesWith(s, i, d)) continue;
        const avgRange = (s.candles[i].h - s.candles[i].l + s.candles[i - 1].h - s.candles[i - 1].l + s.candles[i - 2].h - s.candles[i - 2].l) / 3;
        return { dir: d, trigger: `Pressure building ${d > 0 ? "under" : "above"} ${px(edge)}: ${tests} tests with ${d > 0 ? "higher lows" : "lower highs"} — breakout expected`,
          stop: ex(i - 2, i), target: edge + d * Math.max(b.h, 1.5 * a), validBars: 2,
          soft: [{ ok: avgRange < 0.85 * a, yes: "Candles contracting into the level", no: "Candles not contracting yet" }] };
      }
      return "No pressure building against a range edge";
    } },
  { mode: "transition", key: "mc", letter: "U", title: "Momentum Candle Break", role: "breakout", groups: ["breakout", "high_volatility"], suited: BREAK.concat(["low_volatility", "ranging"]), slow: 50,
    label: (v) => `${v.n} bars · ATR ${v.look}`, describe: (v) => `Smart candle scan: a wide, full-bodied candle closes through the ${v.n}-bar high/low after quiet volatility (ATR vs its ${v.look}-bar mean). Stop behind the candle's midpoint and the broken level, target the measured move.`,
    rule: (s, i, v) => {
      const c = s.candles[i], a0 = s.atr[i - 1], a = s.atr[i];
      if (!finite(a0)) return "Not enough history";
      const top = hi(s, i - v.n, i - 1), bot = lo(s, i - v.n, i - 1);
      const d: 1 | -1 | 0 = c.c > top ? 1 : c.c < bot ? -1 : 0;
      if (!d) return `No close through the ${v.n}-bar high/low`;
      const edge = d > 0 ? top : bot, r = c.h - c.l;
      if ((s.candles[i - 1].c - edge) * d > 0) return "Break is not fresh — previous candle already outside";
      if (!closesWith(s, i, d) || bodyPct(s, i) < 0.7 || r < 1.4 * a0) return "Breakout candle lacks momentum (needs a wide, full body)";
      if ((d > 0 ? c.h - c.c : c.c - c.l) > 0.2 * r) return "Candle closed off its extreme — rejection at the break";
      if ((c.c - edge) * d > 1.5 * a) return "Breakout already ran — wait for a retest";
      const mean = cached(s, `am${v.look}`, () => s.atr.map((_, j) => { let t = 0, k = 0; for (let q = Math.max(0, j - v.look + 1); q <= j; q++) if (Number.isFinite(s.atr[q])) { t += s.atr[q]; k++; } return k ? t / k : NaN; }))[i - 1];
      const mid = (c.h + c.l) / 2;
      return { dir: d, trigger: `Momentum candle (${(r / a0).toFixed(1)}× ATR, ${Math.round(bodyPct(s, i) * 100)}% body) closed through the ${v.n}-bar ${d > 0 ? "high" : "low"} ${px(edge)}`,
        stop: d > 0 ? Math.min(mid, edge) : Math.max(mid, edge), target: edge + d * Math.max(Math.min(top - bot, 3 * a), 1.5 * a), validBars: 2,
        soft: [
          { ok: !finite(mean) || a0 < 0.9 * mean, yes: "Volatility was compressed before the break", no: "No quiet build-up before the break" },
          ...(s.hasVolume ? [{ ok: c.v > 1.3 * s.volSma[i], yes: "Volume surge on the break", no: "No volume surge on the break" }] : []),
        ] };
    } },
  { key: "sm", letter: "V", title: "Smart Money FVG Retest", role: "continuation", groups: ["trending", "breakout"], suited: TREND, slow: 50,
    label: (v) => `BOS ${v.n} · ${v.k} ATR`, describe: (v) => `Smart money: a ${v.k}×ATR displacement candle breaks the ${v.n}-bar structure with the trend and leaves a fair-value gap; buy (sell) the first retest into the gap that is rejected, stop behind the order block.`,
    rule: (s, i, v, d) => {
      const c = s.candles[i];
      for (let j = i - 2; j >= Math.max(v.n + 1, i - v.age); j--) {
        const k = s.candles[j], a = s.atr[j], prev = s.candles[j - 1], next = s.candles[j + 1];
        if (!finite(a) || k.h - k.l < v.k * a || bodyPct(s, j) < 0.6 || !closesWith(s, j, d)) continue;
        const gTop = d > 0 ? next.l : prev.l, gBot = d > 0 ? prev.h : next.h;
        if (gTop <= gBot) continue;
        const swing = d > 0 ? hi(s, j - v.n, j - 1) : lo(s, j - v.n, j - 1);
        if ((k.c - swing) * d <= 0) continue;
        const ob = d > 0 ? Math.min(prev.l, k.l) : Math.max(prev.h, k.h), far = d > 0 ? gBot : gTop, near = d > 0 ? gTop : gBot;
        for (let x = j + 2; x < i; x++) if ((s.candles[x].c - far) * d < 0) return "Fair-value gap already filled through — order block failed";
        let tapped = false;
        for (let x = j + 2; x < i; x++) if ((d > 0 ? s.candles[x].l : -s.candles[x].h) <= (d > 0 ? near : -near)) tapped = true;
        if (tapped) return "Gap already retested — not the first touch";
        if ((d > 0 ? c.l : -c.h) > (d > 0 ? near : -near)) return `Waiting for a retest of the gap ${px(gBot)}–${px(gTop)}`;
        if ((c.c - near) * d <= 0 || !closesWith(s, i, d)) return "Gap tapped but not rejected yet";
        const extreme = d > 0 ? hi(s, j, i - 1) : lo(s, j, i - 1);
        return { dir: d, trigger: `Break of structure ${px(swing)} by a ${((k.h - k.l) / a).toFixed(1)}× ATR displacement; fair-value gap ${px(gBot)}–${px(gTop)} retested and rejected`,
          stop: ob, target: (extreme - c.c) * d > 0.5 * s.atr[i] ? extreme : undefined, validBars: 2,
          soft: [{ ok: (c.c - (d > 0 ? s.candles[i - 1].h : s.candles[i - 1].l)) * d > 0, yes: "Rejection closed beyond the prior candle", no: "Rejection not yet beyond the prior candle" }] };
      }
      return "No displacement with a fair-value gap";
    } },
];

/** Tight box of the n candles ending at `end`: height between 0.8 ATR and k ATR, else none. */
function boxAt(s: Series, end: number, n: number, k: number): { top: number; bot: number; mid: number; h: number } | undefined {
  const a = s.atr[end];
  if (end - n < 0 || !finite(a)) return undefined;
  const top = hi(s, end - n + 1, end), bot = lo(s, end - n + 1, end), h = top - bot;
  return h >= 0.8 * a && h <= k * a ? { top, bot, mid: (top + bot) / 2, h } : undefined;
}

const c_ = (s: Series, i: number) => s.candles[i];
const PATTERNS: { name: string; atValue: boolean; test: (s: Series, i: number, d: number) => boolean }[] = [
  { name: "Engulfing", atValue: true, test: (s, i, d) => closesWith(s, i, d) && !closesWith(s, i - 1, d) && Math.abs(c_(s, i).c - c_(s, i).o) > Math.abs(c_(s, i - 1).c - c_(s, i - 1).o) && (c_(s, i).c - c_(s, i - 1).o) * d > 0 },
  { name: "Pin Bar", atValue: true, test: (s, i, d) => { const k = c_(s, i), r = k.h - k.l; const w = d > 0 ? Math.min(k.o, k.c) - k.l : k.h - Math.max(k.o, k.c); return r > 0 && w / r >= 0.6; } },
  { name: "Inside Bar Break", atValue: false, test: (s, i, d) => { const m = c_(s, i - 2), ib = c_(s, i - 1), k = c_(s, i); return ib.h <= m.h && ib.l >= m.l && (d > 0 ? k.c > m.h : k.c < m.l); } },
  { name: "Outside Bar", atValue: true, test: (s, i, d) => { const p = c_(s, i - 1), k = c_(s, i); return k.h > p.h && k.l < p.l && closesWith(s, i, d) && (d > 0 ? k.c > p.h : k.c < p.l); } },
  { name: "Three Soldiers/Crows", atValue: false, test: (s, i, d) => [0, 1, 2].every((x) => closesWith(s, i - x, d) && bodyPct(s, i - x) >= 0.5) && (c_(s, i).c - c_(s, i - 1).c) * d > 0 && (c_(s, i - 1).c - c_(s, i - 2).c) * d > 0 },
  { name: "Morning/Evening Star", atValue: true, test: (s, i, d) => !closesWith(s, i - 2, d) && bodyPct(s, i - 2) >= 0.5 && bodyPct(s, i - 1) <= 0.3 && closesWith(s, i, d) && (c_(s, i).c - (c_(s, i - 2).o + c_(s, i - 2).c) / 2) * d > 0 },
  { name: "Tweezer", atValue: true, test: (s, i, d) => { const a = s.atr[i], p = c_(s, i - 1), k = c_(s, i); return Math.abs(d > 0 ? p.l - k.l : p.h - k.h) <= 0.1 * a && !closesWith(s, i - 1, d) && closesWith(s, i, d); } },
  { name: "Marubozu Continuation", atValue: false, test: (s, i, d) => closesWith(s, i, d) && bodyPct(s, i) >= 0.85 && c_(s, i).h - c_(s, i).l >= s.atr[i] },
  { name: "Two-Bar Reversal", atValue: true, test: (s, i, d) => !closesWith(s, i - 1, d) && closesWith(s, i, d) && bodyPct(s, i - 1) >= 0.5 && bodyPct(s, i) >= 0.5 && (d > 0 ? c_(s, i).c > c_(s, i - 1).o : c_(s, i).c < c_(s, i - 1).o) },
  { name: "NR7 Break", atValue: false, test: (s, i, d) => { const r = (j: number) => c_(s, j).h - c_(s, j).l; for (let j = i - 7; j < i - 1; j++) if (r(j) <= r(i - 1)) return false; return d > 0 ? c_(s, i).c > c_(s, i - 1).h : c_(s, i).c < c_(s, i - 1).l; } },
];

/** Only 1m, 5m and 15m are scanned: short-lookback variants time entries on 1m/5m, long-lookback ones read 5m/15m structure. */
const F_FAST: Interval[] = ["1m", "5m"], F_MID: Interval[] = ["5m", "15m"], F_ALL: Interval[] = ["1m", "5m", "15m"];
/** 10 variants per family: parameters and the charts each one scans. */
const VARIANTS: Record<string, { v: Params; frames: Interval[] }[]> = {
  pb: [[9, 21], [9, 50], [13, 34], [20, 50], [21, 55], [8, 34], [10, 30], [12, 26], [20, 100], [34, 89]].map(([fast, slow], k) => ({ v: { fast, slow }, frames: k < 4 ? F_FAST : k < 8 ? F_ALL : F_MID })),
  bo: [10, 14, 20, 26, 34, 40, 55, 72, 89, 100].map((n, k) => ({ v: { n }, frames: k < 4 ? F_ALL : F_MID })),
  rs: [[7, 40], [7, 45], [9, 40], [9, 45], [14, 40], [14, 45], [14, 50], [21, 45], [21, 50], [5, 35]].map(([n, lvl], k) => ({ v: { n, lvl }, frames: k < 4 || k === 9 ? F_FAST : F_ALL })),
  md: [[12, 26, 9], [8, 21, 5], [5, 13, 4], [6, 19, 9], [10, 22, 7], [3, 10, 16], [19, 39, 9], [8, 17, 9], [12, 26, 5], [24, 52, 18]].map(([f, sl, sg], k) => ({ v: { f, sl, sg }, frames: k === 6 || k === 9 ? F_MID : F_ALL })),
  sq: [[20, 100, 0.15], [20, 60, 0.2], [14, 80, 0.15], [10, 50, 0.2], [30, 120, 0.15], [20, 150, 0.1], [18, 90, 0.2], [24, 100, 0.15], [16, 70, 0.2], [40, 160, 0.15]].map(([n, look, pct], k) => ({ v: { n, look, pct }, frames: k === 3 ? F_ALL : F_MID })),
  bs: [[2, 2, 60], [3, 3, 80], [2, 2, 40], [3, 2, 60], [4, 4, 120], [5, 5, 150], [2, 3, 60], [3, 3, 40], [4, 3, 100], [6, 6, 200]].map(([l, r, look], k) => ({ v: { l, r, look }, frames: k < 4 ? F_ALL : F_MID })),
  ls: [5, 8, 10, 12, 15, 20, 24, 30, 40, 50].map((n, k) => ({ v: { n }, frames: k < 5 ? F_ALL : F_MID })),
  zn: [[1.5, 20], [1.5, 40], [2, 30], [2, 60], [1.2, 15], [2.5, 50], [1.8, 25], [1.5, 60], [2, 80], [3, 100]].map(([k, age], x) => ({ v: { k, age }, frames: x < 5 ? F_ALL : F_MID })),
  pa: PATTERNS.map((_, pat) => ({ v: { pat }, frames: F_ALL })),
  tr: [[9, 21, 14], [9, 50, 14], [13, 34, 14], [20, 50, 14], [21, 55, 9], [8, 21, 9], [10, 30, 14], [12, 26, 21], [20, 100, 14], [34, 89, 21]].map(([fast, slow, n], k) => ({ v: { fast, slow, n }, frames: k < 6 ? F_ALL : F_MID })),
  mf: [[12, 26, 9], [8, 21, 5], [5, 13, 4], [6, 19, 9], [10, 22, 7], [8, 17, 9], [12, 26, 5], [19, 39, 9], [15, 30, 9], [24, 52, 18]].map(([f, sl, sg], k) => ({ v: { f, sl, sg }, frames: k < 6 ? F_ALL : F_MID })),
  cp: [10, 14, 20, 26, 30, 34, 40, 50, 60, 80].map((n, k) => ({ v: { n }, frames: k < 5 ? F_ALL : F_MID })),
  rf: [10, 14, 16, 20, 24, 30, 34, 40, 50, 60].map((n, k) => ({ v: { n }, frames: k < 7 ? F_FAST : F_ALL })),
  rx: [[2, 10], [3, 15], [5, 25], [7, 30], [9, 30], [14, 30], [14, 35], [5, 20], [7, 25], [21, 35]].map(([n, lvl], k) => ({ v: { n, lvl }, frames: k < 7 ? F_FAST : F_ALL })),
  fb: [10, 14, 20, 24, 30, 40, 50, 60, 72, 96].map((n, k) => ({ v: { n }, frames: k < 7 ? F_FAST : F_ALL })),
  mr: [[8, 2.5], [10, 3], [12, 3], [14, 3.5], [16, 3.5], [6, 2.2], [20, 4], [10, 2.5], [24, 4.5], [30, 5]].map(([n, k], x) => ({ v: { n, k }, frames: x < 8 ? F_FAST : F_ALL })),
  rb: [[12, 2.5], [16, 3], [20, 3], [24, 3.5], [30, 4], [10, 2], [36, 4.5], [48, 5], [20, 2.5], [60, 6]].map(([n, k], x) => ({ v: { n, k }, frames: x < 6 ? F_ALL : F_MID })),
  rt: [[12, 2.5], [16, 3], [20, 3], [24, 3.5], [30, 4], [10, 2], [36, 4.5], [48, 5], [20, 2.5], [60, 6]].map(([n, k], x) => ({ v: { n, k }, frames: x < 6 ? F_ALL : F_MID })),
  pp: [[12, 2.5], [16, 3], [20, 3], [24, 3.5], [30, 4], [10, 2], [36, 4.5], [48, 5], [20, 2.5], [60, 6]].map(([n, k], x) => ({ v: { n, k }, frames: x < 6 ? F_ALL : F_MID })),
  mc: [[10, 50], [14, 60], [20, 80], [24, 100], [30, 120], [8, 40], [12, 60], [16, 80], [40, 150], [55, 200]].map(([n, look], x) => ({ v: { n, look }, frames: x < 6 ? F_ALL : F_MID })),
  sm: [[10, 1.2, 20], [14, 1.3, 24], [20, 1.5, 30], [10, 1.5, 15], [24, 1.4, 36], [30, 1.6, 40], [8, 1.1, 12], [16, 1.8, 30], [40, 1.5, 50], [20, 1.2, 40]].map(([n, k, age], x) => ({ v: { n, k, age }, frames: x < 6 ? F_ALL : F_MID })),
  ex: [[10, 3, 30], [12, 3.5, 30], [14, 4, 30], [16, 4, 32], [20, 5, 30], [8, 2.5, 30], [24, 5.5, 30], [30, 6, 32], [10, 3, 35], [20, 4, 35]].map(([n, k, lvl], x) => ({ v: { n, k, lvl }, frames: x < 6 ? F_ALL : F_MID })),
};
/** ADX at or above this marks a clean trend, where range-mode strategies stand aside. */
export const RANGE_MAX_ADX = 25;

const STOP_GRID = { buf: [0.1, 0.2, 0.35] };

/** The 220 strategies, in family order (A1…V10). */
export const BOOK: (StrategyDef & { role: BookRole; groups: BookGroup[]; mode: BookMode })[] = FAMILIES.flatMap((fam) =>
  VARIANTS[fam.key].map(({ v, frames }, k) => {
    const id = `${fam.key}${k + 1}`;
    return {
      id, letter: `${fam.letter}${k + 1}`, name: `${fam.title} ${fam.label(v)}`, description: fam.describe(v),
      suited: fam.suited, reversal: !!fam.mode && fam.mode !== "trend", frames, role: fam.role, groups: fam.groups, mode: fam.mode ?? "trend",
      defaults: { buf: 0.15, maxExt: 2.5 }, grid: STOP_GRID,
      evaluate(s, i, p) {
        if (i < 60 || !finite(s.atr[i])) return { blockers: ["Not enough history"] };
        const dir = trendBias(s, i, fam.slow);
        if (fam.mode === "range") {
          if (dir && Number.isFinite(s.adx[i]) && s.adx[i] >= RANGE_MAX_ADX) return { blockers: ["Clean trend in place — range strategies stand aside"] };
          const out = fam.rule(s, i, { ...v, ...p }, 1);
          return typeof out === "string" ? { blockers: [out] } : finish(id, s, i, out, p, fam.slow, "range");
        }
        if (fam.mode === "transition") {
          const out = fam.rule(s, i, { ...v, ...p }, 1);
          return typeof out === "string" ? { blockers: [out] } : finish(id, s, i, out, p, fam.slow, "transition");
        }
        if (!dir) return { blockers: [`No clear trend on EMA ${fam.slow} — stand aside`] };
        const out = fam.rule(s, i, { ...v, ...p }, dir);
        return typeof out === "string" ? { blockers: [out] } : finish(id, s, i, out, p, fam.slow);
      },
    } satisfies StrategyDef & { role: BookRole; groups: BookGroup[]; mode: BookMode };
  }),
);

/** Strategy ids per market group (drives adaptive preference) and the trend followers demoted in chop. */
export const BOOK_GROUPS: Record<BookGroup, string[]> = Object.fromEntries(
  (["trending", "ranging", "breakout", "reversal", "high_volatility", "choppy", "compression"] as BookGroup[]).map((g) => [g, BOOK.filter((d) => d.groups.includes(g)).map((d) => d.id)]),
) as Record<BookGroup, string[]>;
/** Pure: "range" for mean-reversion (M–P), "transition" for state changes (Q–U), otherwise "trend". */
export const bookMode = (id: string): BookMode => BOOK.find((d) => d.id === id)?.mode ?? "trend";
export const BOOK_TREND_FOLLOWERS = BOOK.filter((d) => /^(pb|rs|md|bo|tr|mf|cp)\d/.test(d.id)).map((d) => d.id);
/** Pure: true for breakout-role strategies (B, E, Q, T, U) — their stop/target come from the broken structure. */
export const isBreakout = (id: string): boolean => BOOK.find((d) => d.id === id)?.role === "breakout";
