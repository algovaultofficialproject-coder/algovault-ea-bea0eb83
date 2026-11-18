import type { Series } from "./indicators";

/** One recognised candlestick pattern. dir: +1 bullish, -1 bearish, 0 indecision. weight ≈ reliability. */
export interface CandlePattern { name: string; dir: 1 | -1 | 0; weight: number; bars: number }
export interface CandleRead {
  patterns: CandlePattern[];
  /** Net candle pressure, -1 (sellers) … +1 (buyers). */
  bias: number;
  /** Price-flow of the last 5 bars: share of closes in each direction, -1 … +1. */
  flow: number;
  indecision: boolean;
}

/**
 * Pure candlestick reader for the last few closed bars. Sizes are measured against ATR so the
 * same rules work on 1m scalps and 1h swings, on crypto, gold or FX.
 */
export function readCandles(s: Series, i: number): CandleRead {
  const out: CandlePattern[] = [];
  const a = s.atr[i];
  if (i < 4 || !Number.isFinite(a) || a <= 0) return { patterns: out, bias: 0, flow: 0, indecision: false };
  const k = (j: number) => {
    const c = s.candles[j], rng = Math.max(c.h - c.l, 1e-12), b = Math.abs(c.c - c.o);
    return { ...c, rng, b, bodyR: b / rng, up: c.c > c.o, dn: c.c < c.o, upper: c.h - Math.max(c.o, c.c), lower: Math.min(c.o, c.c) - c.l, mid: (c.o + c.c) / 2 };
  };
  const c0 = k(i), c1 = k(i - 1), c2 = k(i - 2), c3 = k(i - 3);
  const big = (x: typeof c0) => x.b >= 0.6 * a;
  const small = (x: typeof c0) => x.b <= 0.3 * a;
  const add = (name: string, dir: 1 | -1 | 0, weight: number, bars: number) => out.push({ name, dir, weight, bars });

  // Prior direction (bars before the current pattern) gives reversal patterns their context.
  const fell = s.candles[i - 1].c < s.candles[i - 4].c, rose = s.candles[i - 1].c > s.candles[i - 4].c;

  // Single-bar
  if (c0.bodyR >= 0.85 && c0.rng >= 0.9 * a) add(c0.up ? "Bullish marubozu (strong buyers)" : "Bearish marubozu (strong sellers)", c0.up ? 1 : -1, 2, 1);
  if (c0.lower >= 2 * c0.b && c0.lower >= 0.6 * c0.rng && c0.upper <= 0.25 * c0.rng && c0.rng >= 0.5 * a) add(fell ? "Hammer after a drop" : "Bullish pin bar (lower-wick rejection)", 1, fell ? 2 : 1.5, 1);
  if (c0.upper >= 2 * c0.b && c0.upper >= 0.6 * c0.rng && c0.lower <= 0.25 * c0.rng && c0.rng >= 0.5 * a) add(rose ? "Shooting star after a rise" : "Bearish pin bar (upper-wick rejection)", -1, rose ? 2 : 1.5, 1);
  const doji = c0.bodyR <= 0.1 && c0.rng >= 0.3 * a;
  if (doji) add("Doji (indecision)", 0, 1, 1);

  // Two-bar
  if (c0.up && c1.dn && c0.c >= c1.o && c0.o <= c1.c && c0.b > c1.b) add("Bullish engulfing", 1, 2.5, 2);
  if (c0.dn && c1.up && c0.c <= c1.o && c0.o >= c1.c && c0.b > c1.b) add("Bearish engulfing", -1, 2.5, 2);
  if (c1.dn && big(c1) && c0.up && c0.o <= c1.c && c0.c > c1.mid && c0.c < c1.o) add("Piercing line", 1, 1.5, 2);
  if (c1.up && big(c1) && c0.dn && c0.o >= c1.c && c0.c < c1.mid && c0.c > c1.o) add("Dark cloud cover", -1, 1.5, 2);
  const tol = 0.1 * a;
  if (Math.abs(c0.l - c1.l) <= tol && c1.dn && c0.up && fell) add("Tweezer bottom", 1, 1.5, 2);
  if (Math.abs(c0.h - c1.h) <= tol && c1.up && c0.dn && rose) add("Tweezer top", -1, 1.5, 2);

  if (c1.dn && big(c1) && c0.up && small(c0) && Math.max(c0.o, c0.c) <= c1.o && Math.min(c0.o, c0.c) >= c1.c && fell) add("Bullish harami", 1, 1, 2);
  if (c1.up && big(c1) && c0.dn && small(c0) && Math.max(c0.o, c0.c) <= c1.c && Math.min(c0.o, c0.c) >= c1.o && rose) add("Bearish harami", -1, 1, 2);
  if (c0.h > c1.h && c0.l < c1.l && c0.up && c0.bodyR >= 0.5 && c0.c > c1.h && fell) add("Bullish outside reversal", 1, 2.5, 2);
  if (c0.h > c1.h && c0.l < c1.l && c0.dn && c0.bodyR >= 0.5 && c0.c < c1.l && rose) add("Bearish outside reversal", -1, 2.5, 2);

  // Three-bar
  if (c2.dn && big(c2) && small(c1) && c0.up && c0.c > c2.mid) add("Morning star", 1, 3, 3);
  if (c2.up && big(c2) && small(c1) && c0.dn && c0.c < c2.mid) add("Evening star", -1, 3, 3);
  const soldiers = [c2, c1, c0].every((x) => x.up && x.bodyR >= 0.5 && x.upper <= 0.35 * x.rng) && c1.c > c2.c && c0.c > c1.c && c1.o >= c2.o && c0.o >= c1.o;
  const crows = [c2, c1, c0].every((x) => x.dn && x.bodyR >= 0.5 && x.lower <= 0.35 * x.rng) && c1.c < c2.c && c0.c < c1.c && c1.o <= c2.o && c0.o <= c1.o;
  if (soldiers) add("Three white soldiers", 1, 3, 3);
  if (crows) add("Three black crows", -1, 3, 3);

  if (c2.dn && big(c2) && c1.up && Math.max(c1.o, c1.c) <= c2.o && Math.min(c1.o, c1.c) >= c2.c && c0.up && c0.c > c2.o) add("Three inside up", 1, 2.5, 3);
  if (c2.up && big(c2) && c1.dn && Math.max(c1.o, c1.c) <= c2.c && Math.min(c1.o, c1.c) >= c2.o && c0.dn && c0.c < c2.o) add("Three inside down", -1, 2.5, 3);
  if ([c3, c2, c1].every((x) => x.dn) && c2.c < c3.c && c1.c < c2.c && c0.up && c0.c > c3.o) add("Bullish three-line strike", 1, 2.5, 4);
  if ([c3, c2, c1].every((x) => x.up) && c2.c > c3.c && c1.c > c2.c && c0.dn && c0.c < c3.o) add("Bearish three-line strike", -1, 2.5, 4);

  // Momentum fading: shrinking bodies in one direction warn the move is tiring.
  if ([c3, c2, c1, c0].every((x) => x.up) && c0.b < c1.b && c1.b < c2.b) add("Buying momentum fading (shrinking candles)", -1, 1, 4);
  if ([c3, c2, c1, c0].every((x) => x.dn) && c0.b < c1.b && c1.b < c2.b) add("Selling momentum fading (shrinking candles)", 1, 1, 4);

  let flowSum = 0;
  for (let j = i - 4; j <= i; j++) flowSum += Math.sign(s.candles[j].c - s.candles[j - 1].c);
  const flow = flowSum / 5;
  const dirW = out.reduce((t, p) => t + p.dir * p.weight, 0);
  const totW = out.reduce((t, p) => t + (p.dir ? p.weight : 0), 0);
  const bias = Math.max(-1, Math.min(1, (totW ? dirW / Math.max(totW, 3) : 0) * 0.8 + flow * 0.2));
  return { patterns: out, bias, flow, indecision: doji && Math.abs(dirW) < 2 };
}

/** Adds candle evidence to a candidate: agreeing candles confirm, clearly opposing candles hold it back. */
export function candleCheck(read: CandleRead, d: 1 | -1): { confirm?: string; missing?: string } {
  const withMe = read.patterns.filter((p) => p.dir === d).map((p) => p.name);
  const against = read.patterns.filter((p) => p.dir === -d);
  const againstW = against.reduce((t, p) => t + p.weight, 0);
  if (againstW >= 2 && read.bias * d < 0) return { missing: `Candles show ${d > 0 ? "selling" : "buying"} pressure: ${against.map((p) => p.name).join(", ")}` };
  if (withMe.length) return { confirm: `Candles: ${withMe.join(", ")}` };
  if (read.indecision) return { missing: "Last candle is a doji — wait for a decisive candle" };
  if (read.flow * d >= 0.6) return { confirm: `Candle flow ${d > 0 ? "up" : "down"} (${Math.round(Math.abs(read.flow) * 5)} of last 5 closes)` };
  return {};
}
