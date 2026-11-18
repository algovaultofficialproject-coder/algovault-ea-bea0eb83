import type { SwingRead } from './smart-signal-policy';
import type { MarketSession } from './market-session';
import type { TradeStyle } from './trade-style';
import type { VolatilityProfile, VolatilityRegime } from './volatility-strategy';

/**
 * Market-adaptive take-profit strategy (pure, browser + server safe).
 * Picks how far the target should be — in 15m ATR, before style sizing and obstacle caps —
 * from the setup being traded and what the market is doing right now: trend strength,
 * volatility across the 1m/5m/15m/1h charts, the 15m range, the EMA fan, how much of the
 * normal 1h move is left, the 1h trend, the session and any fresh spike. Uses observed readings
 * only (1m to 1h charts); missing data skips a rule.
 */
export type TpSetup = 'pullback' | 'breakout' | 'exhaustion' | 'range' | 'reversal' | 'momentum';
export type TpMethod = 'trendRunner' | 'measuredMove' | 'rangeMidline' | 'rangeRotation' | 'meanReversion' | 'quickExhaustion' | 'momentumStep';

export interface TpContext {
  read: SwingRead;
  sign: 1 | -1;
  setup: TpSetup;
  adx: number;
  volatility: VolatilityRegime;
  extreme?: boolean;
  /** 1h trend score in the trade's direction (positive = agrees). */
  htfWith?: number;
  /** Multi-chart volatility picture: scales how far the target reaches. */
  profile?: VolatilityProfile;
  session?: MarketSession;
  /** Fresh 1m/5m spike: +1 with the trade, -1 against it. */
  spike?: { dir: 1 | -1; kind: 'momentum' | 'rejection' };
  style?: TradeStyle;
}
export interface TpPlan { targetAtr: number; method: TpMethod; label: string; notes: string[] }

/** Raw target bounds in 15m ATR before style sizing (the engine clamps again per style). */
export const TP_MIN_ATR = 0.8;
export const TP_MAX_ATR = 3;

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const METHOD_LABEL: Record<TpMethod, string> = {
  trendRunner: 'trend runner', measuredMove: 'measured breakout move', rangeMidline: 'range midline',
  rangeRotation: 'range rotation toward the far band', meanReversion: 'mean reversion to value',
  quickExhaustion: 'quick exhaustion take', momentumStep: 'momentum step',
};
const CONTINUATION = new Set<TpMethod>(['trendRunner', 'measuredMove', 'momentumStep']);

export function takeProfitPlan(ctx: TpContext): TpPlan {
  const { read, sign, setup, adx } = ctx;
  const price = read.price, atr = read.atr15;
  if (!ok(price) || !ok(atr)) return { targetAtr: 1.2, method: 'momentumStep', label: METHOD_LABEL.momentumStep, notes: [] };
  const notes: string[] = [];
  const dist = (l: number | undefined) => (ok(l) ? ((l - price) * sign) / atr : undefined);
  const width = ok(read.bbUp15) && ok(read.bbLo15) && read.bbUp15 > read.bbLo15 ? (read.bbUp15 - read.bbLo15) / atr : undefined;
  const toMid = width !== undefined ? dist((read.bbUp15! + read.bbLo15!) / 2) : undefined;
  const toFar = dist(sign > 0 ? read.bbUp15 : read.bbLo15);
  const toEma20 = dist(read.ema20_15);

  // ---- 1. Base target from the setup and the market's structure ----
  let method: TpMethod;
  let t: number;
  if (setup === 'pullback') {
    method = 'trendRunner';
    t = adx >= 40 ? 2.3 : adx >= 30 ? 2.0 : 1.7; // stronger trends run further
  } else if (setup === 'breakout') {
    method = 'measuredMove';
    // Project about half the height of the 15m range that was just broken.
    t = width !== undefined ? clamp(width * 0.45, 1.4, 2.6) : adx >= 30 ? 1.8 : 1.55;
  } else if (setup === 'range') {
    if (toMid !== undefined && toMid > 0.5) {
      // Quiet ranges: bank at the middle. Normal/fast ranges: rotate halfway past it toward the far band.
      if (ctx.volatility !== 'low' && toFar !== undefined && toFar > toMid + 0.4 && adx < 22) {
        method = 'rangeRotation'; t = toMid + (toFar - toMid) * 0.5;
      } else { method = 'rangeMidline'; t = toMid; }
    } else { method = 'rangeMidline'; t = 1.2; }
  } else if (setup === 'reversal') {
    method = 'meanReversion';
    const value = [toEma20, toMid].filter((x): x is number => x !== undefined && x >= 0.8).sort((a, b) => a - b)[0];
    t = value !== undefined ? Math.min(value, 2) : 1.25;
  } else if (setup === 'exhaustion') {
    method = 'quickExhaustion';
    t = toEma20 !== undefined && toEma20 >= 0.8 && toEma20 <= 1.6 ? toEma20 : 1.0;
  } else {
    method = 'momentumStep';
    t = adx >= 30 ? 1.8 : adx >= 22 ? 1.5 : 1.15;
  }

  // ---- 2. Volatility: fast markets travel further, quiet markets less ----
  if (ctx.extreme) notes.push('extreme volatility — no target extension');
  else if (ctx.volatility === 'high') { t *= 1.15; notes.push('fast market — wider target'); }
  else if (ctx.volatility === 'low' && method !== 'rangeMidline') { t *= 0.85; notes.push('quiet market — closer target'); }
  // Multi-chart volatility: a climax is banked sooner; expansion on 1m/5m/1h lets breakouts and trends travel.
  const profile = ctx.profile;
  if (profile?.state === 'climax') { t *= profile.targetScale; notes.push('volatility climax — banking sooner'); }
  else if (profile?.state === 'expanding' && CONTINUATION.has(method) && !ctx.extreme && ctx.volatility !== 'high') { t *= 1.08; notes.push('volatility expanding on the fast charts'); }
  else if (profile?.state === 'compressing' && method !== 'measuredMove' && ctx.volatility !== 'low') { t *= 0.92; notes.push('volatility compressing — closer target'); }

  // ---- 2b. EMA fan: a widening 15m EMA9/EMA20 vs EMA50 gap means the trend is accelerating ----
  const fast = ok(read.ema9_15) ? read.ema9_15 : read.ema20_15;
  const fastPrev = ok(read.ema9_15) ? undefined : read.ema20Prev15;
  if (CONTINUATION.has(method) && ok(fast) && ok(read.ema50_15)) {
    const gap = ((fast - read.ema50_15) * sign) / atr;
    const prevGap = ok(fastPrev) && ok(read.ema50Prev15) ? ((fastPrev - read.ema50Prev15) * sign) / atr : undefined;
    if (gap > 0.3 && gap < 2 && (prevGap === undefined || gap > prevGap)) { t += 0.15; notes.push('EMA fan widening'); }
    else if (gap < -0.2) { t -= 0.15; notes.push('EMAs against the trade — trimmed target'); }
  }

  // ---- 3. Already stretched from the 15m EMA50 in the trade's direction: take profit sooner ----
  const stretch = ok(read.ema50_15) ? ((price - read.ema50_15) * sign) / atr : 0;
  if (stretch > 2.5) { t = Math.min(t, 0.9); notes.push('price already stretched — early target'); }
  else if (stretch > 1.5) { t = Math.min(t, 1.1); notes.push('price extended — closer target'); }

  // ---- 4. Bigger trend: lets continuation targets run, trims them when fighting it ----
  const htf = ctx.htfWith ?? 0;
  if (CONTINUATION.has(method)) {
    if (htf > 0.25) { t += 0.2; notes.push('1h trend extends the target'); }
    else if (htf < -0.3) { t -= 0.2; notes.push('1h trend against — trimmed target'); }
  }

  // ---- 5. Session liquidity ----
  if (ctx.session?.quality === 'high') t += 0.15;
  else if (ctx.session?.quality === 'low') { t -= 0.15; notes.push('thin session — closer target'); }

  // ---- 6. Fresh spike ----
  if (ctx.spike) {
    if (ctx.spike.dir === sign && ctx.spike.kind === 'momentum' && CONTINUATION.has(method)) { t += 0.1; notes.push('momentum spike — slightly wider target'); }
    else if (ctx.spike.dir !== sign) { t *= 0.85; notes.push('spike against — banking sooner'); }
  }

  // ---- 7. 1h move budget (intraday styles): don't aim past a normal 1h candle's move ----
  const atr60 = read.atr60;
  if (ctx.style !== 'swing' && ok(atr60) && atr60 < price && ok(read.high60) && ok(read.low60) && read.high60 >= read.low60 && atr60 > atr) {
    const budget = atr60 * 1.25;
    const used = read.high60 - read.low60;
    const left = (sign > 0 ? read.low60 + budget - price : price - (read.high60 - budget)) / atr;
    if (used >= budget && CONTINUATION.has(method)) { t = Math.max(TP_MIN_ATR, t * 0.8); notes.push('1h move already used — closer target'); }
    else if (left > 0 && left < t) { t = Math.max(TP_MIN_ATR, left * 0.95); notes.push('capped at the normal 1h move'); }
  }

  t = clamp(t, TP_MIN_ATR, TP_MAX_ATR);
  return { targetAtr: Math.round(t * 1000) / 1000, method, label: METHOD_LABEL[method], notes };
}
