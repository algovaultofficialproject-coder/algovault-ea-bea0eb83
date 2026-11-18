import type { SwingRead } from './smart-signal-policy';

export type VolatilityRegime = 'low' | 'normal' | 'high';
export type VolatilityState = 'compressing' | 'steady' | 'expanding' | 'climax';
/**
 * Multi-chart volatility picture (1m, 5m, 15m, 1h). Each faster chart's ATR is scaled to 15-minute
 * time (square-root of time) and compared with the 15m ATR; the 15m ATR is compared with the 1h ATR.
 * The engine uses it to size stops (room for the noise) and targets (how far price is travelling).
 */
export interface VolatilityProfile {
  m1?: number; m5?: number; h1?: number;
  state: VolatilityState;
  stopScale: number; targetScale: number;
  label: string;
}
export interface VolatilityPlan {
  regime: VolatilityRegime;
  setup?: 'quietRange' | 'volatilePullback' | 'expansionBreakout' | 'quietReclaim';
  dir?: 1 | -1;
  sizeScale: number;
  profile: VolatilityProfile;
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Extreme fast-chart volatility (5m ATR at least twice its M15 baseline): breakouts here are usually late. */
export function isExtremeVolatility(read: SwingRead) {
  const atr = read.atr15;
  if (!positive(atr) || !positive(read.atr5) || !positive(read.price) || read.atr5 >= read.price) return false;
  return (read.atr5 * Math.sqrt(3)) / atr >= 2;
}

const STEADY: VolatilityProfile = { state: 'steady', stopScale: 1, targetScale: 1, label: 'steady volatility' };
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: how volatility is behaving across 1m, 5m, 15m and 1h right now. */
export function volatilityProfile(read: SwingRead): VolatilityProfile {
  const atr = read.atr15, p = read.price;
  if (!positive(atr) || !positive(p) || atr >= p) return STEADY;
  const m1 = positive(read.atr1) && read.atr1 < p ? r2((read.atr1 * Math.sqrt(15)) / atr) : undefined;
  const m5 = positive(read.atr5) && read.atr5 < p ? r2((read.atr5 * Math.sqrt(3)) / atr) : undefined;
  const h1 = positive(read.atr60) && read.atr60 < p ? r2((atr * 2) / read.atr60) : undefined;
  const fast = [m1, m5].filter((x): x is number => x !== undefined);
  const fastAvg = fast.length ? fast.reduce((a, b) => a + b, 0) / fast.length : undefined;
  const width = positive(read.bbUp15) && positive(read.bbLo15) && read.bbUp15 > read.bbLo15 ? (read.bbUp15 - read.bbLo15) / atr : undefined;
  let state: VolatilityState = 'steady';
  if ((m1 !== undefined && m1 >= 2.4) || (m5 !== undefined && m5 >= 2)) state = 'climax';
  else if ((fastAvg !== undefined && fastAvg >= 1.3) || (h1 !== undefined && h1 >= 1.3 && (fastAvg ?? 1) >= 1)) state = 'expanding';
  else if ((fastAvg !== undefined && fastAvg <= 0.75) || (h1 !== undefined && h1 <= 0.7 && (width === undefined || width <= 3.4))) state = 'compressing';
  const parts = [m1 !== undefined ? `1m ${m1}x` : '', m5 !== undefined ? `5m ${m5}x` : '', h1 !== undefined ? `15m vs 1h ${h1}x` : ''].filter(Boolean).join(', ');
  // Fast markets need a little more room and travel further; a climax is banked sooner; quiet markets aim closer.
  const scale = state === 'climax' ? { stopScale: 1.15, targetScale: 0.85 } : state === 'expanding' ? { stopScale: 1.1, targetScale: 1.15 }
    : state === 'compressing' ? { stopScale: 0.92, targetScale: 0.9 } : { stopScale: 1, targetScale: 1 };
  return { m1, m5, h1, state, ...scale, label: `${state} volatility${parts ? ` (${parts})` : ''}` };
}

/** Relative, instrument-independent volatility. Missing optional data never invents a setup. */
export function volatilityStrategy(read: SwingRead, scores: { m15: number; m5: number; m1: number }): VolatilityPlan {
  const atr = read.atr15;
  if (!positive(atr) || !positive(read.price) || atr >= read.price) return { regime: 'normal', sizeScale: 1, profile: STEADY };
  const profile = volatilityProfile(read);
  const width = positive(read.bbUp15) && positive(read.bbLo15) && read.bbUp15 > read.bbLo15
    ? (read.bbUp15 - read.bbLo15) / atr : undefined;
  // Compare fast volatility with its time-scaled M15 baseline, not fixed pip thresholds.
  const expansion = positive(read.atr5) && read.atr5 < read.price ? read.atr5 * Math.sqrt(3) / atr : undefined;
  const regime: VolatilityRegime = expansion !== undefined && expansion >= 1.35 ? 'high'
    : (expansion !== undefined && expansion <= 0.7) || (width !== undefined && width <= 3.2 && (read.adx15 ?? 20) < 20) ? 'low' : 'normal';
  const plan: VolatilityPlan = { regime, sizeScale: 1, profile };
  const { m15, m5, m1 } = scores;
  if (regime === 'low' && width !== undefined && positive(read.bbLo15) && (read.adx15 ?? 20) < 20) {
    const position = (read.price - read.bbLo15) / (width * atr);
    // Only trade back into an observed range after both fast charts turn. No centre-range guessing.
    if (position >= 0 && position <= 0.3 && m1 > 0.2 && m5 > 0.1) return { regime, setup: 'quietRange', dir: 1, sizeScale: 0.75, profile };
    if (position >= 0.7 && position <= 1 && m1 < -0.2 && m5 < -0.1) return { regime, setup: 'quietRange', dir: -1, sizeScale: 0.75, profile };
  }
  if (regime === 'high' && (read.adx15 ?? 0) >= 22 && positive(read.ema20_5)
    && positive(read.open5) && positive(read.high5) && positive(read.low5)
    && read.high5 > read.low5 && read.high5 >= Math.max(read.price, read.open5) && read.low5 <= Math.min(read.price, read.open5)) {
    const dir = m15 > 0.2 ? 1 : m15 < -0.2 ? -1 : undefined;
    if (dir && m5 * dir > 0.15 && m1 * dir > 0.2) {
      const touched = dir === 1 ? read.low5 <= read.ema20_5 && read.price > read.ema20_5 && read.price > read.open5
        : read.high5 >= read.ema20_5 && read.price < read.ema20_5 && read.price < read.open5;
      const stretch = positive(read.ema50_15) ? Math.abs(read.price - read.ema50_15) / atr : Infinity;
      const spike = positive(read.high1) && positive(read.low1) && read.high1 > read.low1 && read.high1 - read.low1 > atr;
      if (touched && stretch <= 2 && !spike) return { regime, setup: 'volatilePullback', dir, sizeScale: 1.15, profile };
    }
  }
  const dir15 = m15 > 0.15 ? 1 : m15 < -0.15 ? -1 : undefined;
  const candleOk = positive(read.open5) && positive(read.high5) && positive(read.low5) && read.high5 > read.low5;
  // High volatility: expansion breakout — 5m candle closes strong beyond the M15 band with all charts aligned.
  if (regime === 'high' && dir15 && candleOk && positive(read.bbUp15) && positive(read.bbLo15)
    && m5 * dir15 > 0.25 && m1 * dir15 > 0.15) {
    const range = read.high5! - read.low5!;
    const closeLoc = (read.price - read.low5!) / range; // 0 = low, 1 = high
    const beyond = dir15 === 1 ? read.price > read.bbUp15 : read.price < read.bbLo15;
    const strongClose = dir15 === 1 ? closeLoc >= 0.7 && read.price > read.open5! : closeLoc <= 0.3 && read.price < read.open5!;
    const rsiRoom = read.rsi15 === undefined || (dir15 === 1 ? read.rsi15 < 78 : read.rsi15 > 22);
    const notSpike = !(positive(read.high1) && positive(read.low1) && read.high1 - read.low1 > atr * 1.2);
    if (beyond && strongClose && rsiRoom && notSpike) return { regime, setup: 'expansionBreakout', dir: dir15, sizeScale: 1.1, profile };
  }
  // Low volatility: EMA reclaim — fast charts reclaim the 5m EMA20 in the M15 direction, near (not stretched from) value.
  if (regime === 'low' && dir15 && candleOk && positive(read.ema20_5)) {
    const reclaimed = dir15 === 1 ? read.low5! <= read.ema20_5 && read.price > read.ema20_5 && read.price > read.open5!
      : read.high5! >= read.ema20_5 && read.price < read.ema20_5 && read.price < read.open5!;
    const nearValue = Math.abs(read.price - read.ema20_5) <= atr * 0.6;
    if (reclaimed && nearValue && m1 * dir15 > 0.2 && m5 * dir15 > 0) return { regime, setup: 'quietReclaim', dir: dir15, sizeScale: 0.85, profile };
  }
  return plan;
}