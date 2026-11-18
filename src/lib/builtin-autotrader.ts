import { type SignalVerdict, type SwingRead } from './smart-signal-policy';
import { scanStrategies } from './strategy-scan';
import type { MarketSession } from './market-session';
import type { TradeStyle } from './trade-style';
import { isExtremeVolatility, volatilityStrategy } from './volatility-strategy';
import { takeProfitPlan } from './take-profit-strategy';

import { strategyInfo, STRATEGY_NAMES } from './smart-strategies';

/** Observed turn / spike evidence: two or more of these against the engine's side flip it. */
const TURN_SIGNALS = new Set<string>(STRATEGY_NAMES.filter(n => strategyInfo(n)?.turn));
/** 5m/15m structural turns: the only evidence that lets normal/swing trade against the slower trend. */
const STRUCTURAL_TURNS = new Set<string>(STRATEGY_NAMES.filter(n => strategyInfo(n)?.structural));
const roleOf = (name: string) => strategyInfo(name)?.role;
/** Independent kinds of evidence (EMA, trend, momentum, structure, levels, candles, volatility, volume). */
export const evidenceKinds = (names: string[]) => new Set(names.map(n => strategyInfo(n)?.family ?? n)).size;

const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fin = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, n));

/** RSI as directional pressure, fading at extremes so stretched moves aren't chased. */
function rsiScore(rsi: number | undefined) {
  if (!ok(rsi)) return null;
  const base = clamp((rsi - 50) / 20);
  if (rsi > 75 || rsi < 25) return base * 0.4;
  return base;
}

/** Stochastic timing: K/D cross direction, strongest when turning out of an extreme zone. */
function stochScore(k: number | undefined, d: number | undefined) {
  if (!ok(k) || !ok(d)) return null;
  const cross = clamp((k - d) / 12);
  if (k < 25 && k > d) return clamp(cross + 0.35);
  if (k > 75 && k < d) return clamp(cross - 0.35);
  if (k > 85) return cross * 0.5; // overbought: buy pressure is late
  if (k < 15) return cross * 0.5;
  return cross;
}

/** Position inside Bollinger bands: 0 = lower band, 1 = upper band, outside values allowed. */
const bandPos = (price: number, up?: number, lo?: number) => (ok(up) && ok(lo) && up > lo ? (price - lo) / (up - lo) : null);

interface TfIn {
  price: number; rating?: number; ema?: number; emaFast?: number; rsi?: number; atr?: number;
  macd?: number; macdSig?: number; mom?: number; adx?: number; diP?: number; diM?: number; k?: number; d?: number;
}

/** Signed (-1..+1) weighted score for one timeframe from live TradingView readings. */
function tfScore(t: TfIn) {
  const parts: Array<[number, number]> = []; // [score, weight]
  if (fin(t.rating) && t.rating !== 0) parts.push([clamp(t.rating * 2), 1.2]);
  if (ok(t.ema) && ok(t.atr)) parts.push([clamp((t.price - t.ema) / t.atr), 1.2]);
  if (ok(t.emaFast) && ok(t.ema) && ok(t.atr)) parts.push([clamp((t.emaFast - t.ema) / (t.atr * 0.5)), 0.9]); // EMA stack
  const r = rsiScore(t.rsi); if (r !== null) parts.push([r, 1]);
  if (ok(t.atr) && fin(t.macd) && fin(t.macdSig) && (t.macd !== 0 || t.macdSig !== 0)) parts.push([clamp((t.macd - t.macdSig) / (t.atr * 0.2)), 1]);
  if (ok(t.atr) && fin(t.mom) && t.mom !== 0) parts.push([clamp(t.mom / t.atr), 1]);
  if (ok(t.diP) && ok(t.diM)) parts.push([clamp(((t.diP - t.diM) / (t.diP + t.diM)) * 2.5), 1.1]);
  const s = stochScore(t.k, t.d); if (s !== null) parts.push([s, 0.8]);
  if (!parts.length) return 0;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  let v = parts.reduce((a, [p, x]) => a + p * x, 0) / w;
  if (ok(t.adx)) v *= t.adx >= 25 ? 1.15 : t.adx < 18 ? 0.8 : 1; // trend strength
  return clamp(v);
}

type Setup = 'pullback' | 'breakout' | 'exhaustion' | 'range' | 'reversal' | 'momentum';
const SETUP_LABEL: Record<Setup, string> = {
  pullback: 'Trend pullback entry', breakout: 'Breakout continuation', exhaustion: 'Exhaustion turn',
  range: 'Range edge bounce', reversal: 'Lower-timeframe reversal', momentum: 'Momentum read',
};
/** Smallest acceptable reward compared with the stop, and share of a style's minimum target that must be reachable. */
export const MIN_TRADE_RR = 1;
export const MIN_ROOM_SHARE = 0.75;

const SETUP_BASE: Record<Setup, number> = { pullback: 80, breakout: 75, exhaustion: 71, range: 73, reversal: 66, momentum: 56 };

/**
 * AlgoVault M15/M5/M1 engine: M15 regime and trend, M5 confirmation, M1 entry timing.
 * Detects the market regime (trend vs range), then picks the best-matching setup:
 * trend pullbacks, breakouts, exhaustion turns, range-edge bounces or lower-timeframe reversals.
 * Take profit sits in front of the nearest structure (bands / key EMAs) so it is reachable;
 * stop sits just beyond protective structure. Levels stay within normal 15m-volatility bounds.
 * Returns BUY or SELL when live readings exist and there is room to the next level; otherwise WAIT.
 * Deterministic: no model, network or credits.
 */
export function analyzeBuiltinAuto(read: SwingRead, session?: MarketSession, style: TradeStyle = 'normal'): SignalVerdict {
  const price = read.price;
  const atr = read.atr15;
  if (!ok(price) || !ok(atr) || atr >= price) {
    return { side: 'WAIT', confidence: 0, entry: ok(price) ? price : 0, stopLoss: 0, takeProfit: 0, timeframe: '5m', timeframeReason: 'Live chart data unavailable', reason: 'Live TradingView data unavailable — retrying on next scan' };
  }
  const m15 = tfScore({ price, rating: read.rating15, ema: read.ema50_15, emaFast: read.ema20_15, rsi: read.rsi15, atr, macd: read.macd15, macdSig: read.macdSig15, adx: read.adx15, diP: read.diPlus15, diM: read.diMinus15, k: read.stochK15, d: read.stochD15 });
  const m5 = tfScore({ price, rating: read.rating5, ema: read.ema50_5, emaFast: read.ema20_5, rsi: read.rsi5, atr: read.atr5, macd: read.macd5, macdSig: read.macdSig5, adx: read.adx5, diP: read.diPlus5, diM: read.diMinus5, k: read.stochK5, d: read.stochD5 });
  // 1m: EMA50 with EMA20 as the fast line when available, otherwise EMA20 alone.
  const m1 = ok(read.ema50_1)
    ? tfScore({ price, rating: read.rating1, ema: read.ema50_1, emaFast: read.ema20_1, rsi: read.rsi1, atr: read.atr1, mom: read.mom1, macd: read.macd1, macdSig: read.macdSig1, adx: read.adx1, k: read.stochK1, d: read.stochD1 })
    : tfScore({ price, rating: read.rating1, ema: read.ema20_1, rsi: read.rsi1, atr: read.atr1, mom: read.mom1, k: read.stochK1, d: read.stochD1 });
  const volatility = volatilityStrategy(read, { m15, m5, m1 });

  // ---- Market regime (M15) ----
  const adx = ok(read.adx15) ? read.adx15 : 20;
  const diSpread = ok(read.diPlus15) && ok(read.diMinus15) ? (read.diPlus15 - read.diMinus15) / (read.diPlus15 + read.diMinus15) : null;
  const bbWidth = ok(read.bbUp15) && ok(read.bbLo15) ? (read.bbUp15 - read.bbLo15) / atr : null;
  const trending = adx >= 22 && (diSpread === null || Math.abs(diSpread) > 0.12) && Math.abs(m15) > 0.2;
  const ranging = !trending && (adx < 20 || (bbWidth !== null && bbWidth < 3.2));
  const trendDir = m15 >= 0 ? 1 : -1;
  const pb15 = bandPos(price, read.bbUp15, read.bbLo15);
  const stretch15 = ok(read.ema50_15) ? (price - read.ema50_15) / atr : 0;
  const rsi15 = ok(read.rsi15) ? read.rsi15 : 50;
  const k1 = read.stochK1, d1 = read.stochD1, k5 = read.stochK5;
  const m1Turn = (dir: number) => m1 * dir > 0.15 || (ok(k1) && ok(d1) && (k1 - d1) * dir > 2);

  // ---- Setup detection (priority order) ----
  let setup: Setup = 'momentum';
  let dir = 0;
  const exhaustedUp = (rsi15 > 70 || stretch15 > 2.5 || (pb15 !== null && pb15 > 1.05 && adx < 30)) && m1 < -0.25 && m5 < 0.2;
  const exhaustedDown = (rsi15 < 30 || stretch15 < -2.5 || (pb15 !== null && pb15 < -0.05 && adx < 30)) && m1 > 0.25 && m5 > -0.2;
  const breakout = trending && adx >= 25 && pb15 !== null && (trendDir > 0 ? pb15 > 0.95 : pb15 < 0.05)
    && (trendDir > 0 ? rsi15 < 76 : rsi15 > 24) && m5 * trendDir > 0.3 && m1 * trendDir > 0;
  const pulledBack5 = (ok(k5) && (trendDir > 0 ? k5 < 40 : k5 > 60))
    || (ok(read.ema20_5) && ok(read.atr5) && Math.abs(price - read.ema20_5) < read.atr5 * 0.6)
    || (ok(read.rsi5) && (trendDir > 0 ? read.rsi5 < 52 && read.rsi5 > 35 : read.rsi5 > 48 && read.rsi5 < 65));
  const pullback = trending && pulledBack5 && m1Turn(trendDir) && Math.abs(stretch15) < 2.5;
  const rangeBuy = ranging && pb15 !== null && pb15 < 0.2 && m1Turn(1) && m5 > -0.5;
  const rangeSell = ranging && pb15 !== null && pb15 > 0.8 && m1Turn(-1) && m5 < 0.5;
  const lowerTfReversal = Math.sign(m5) === Math.sign(m1) && Math.sign(m5) !== Math.sign(m15) && Math.abs(m5) > 0.35 && Math.abs(m1) > 0.35;

  // Scalp leans on M5/M1 timing; swing follows M15 and treats M1 only as fine timing.
  const W = style === 'scalp' ? [0.36, 0.36, 0.28] : style === 'swing' ? [0.66, 0.27, 0.07] : [0.55, 0.33, 0.12];
  let combined = m15 * W[0] + m5 * W[1] + m1 * W[2];
  if (exhaustedUp || exhaustedDown) { setup = 'exhaustion'; dir = exhaustedUp ? -1 : 1; combined = dir * Math.max(0.2, Math.abs(m1) * 0.6 + Math.abs(m5) * 0.4); }
  else if (breakout) { setup = 'breakout'; dir = trendDir; }
  else if (pullback) { setup = 'pullback'; dir = trendDir; combined = dir * Math.max(Math.abs(m15), 0.3); }
  else if (rangeBuy || rangeSell) { setup = 'range'; dir = rangeBuy ? 1 : -1; combined = dir * Math.max(0.25, Math.abs(m1) * 0.6 + 0.2); }
  else if (lowerTfReversal && (style !== 'swing' || Math.abs(m5) > 0.55)) { setup = 'reversal'; combined = m5 * 0.55 + m1 * 0.3 + m15 * 0.15; dir = combined >= 0 ? 1 : -1; }
  else if (ranging && pb15 !== null) {
    // Inside a range with no edge: lean toward the band price is moving away from, using M1/M5 timing.
    combined = m5 * 0.45 + m1 * 0.35 + m15 * 0.2;
  }
  // Observed quiet-range turns / fast-market retests take precedence over generic momentum.
  if (volatility.setup && volatility.dir && setup !== 'exhaustion') {
    setup = volatility.setup === 'quietRange' ? 'range' : volatility.setup === 'expansionBreakout' ? 'breakout' : 'pullback';
    dir = volatility.dir;
    combined = dir * Math.max(0.3, Math.abs(m5) * 0.6 + Math.abs(m1) * 0.4);
  }
  // ---- Strategy scan: trend following, breakouts, support/resistance, price action, structure ----
  const rawStrat = scanStrategies(read);
  // Regime-aware weighting: trend / breakout tools count more in trends, range / reversal tools in ranges.
  const regimeW = (name: string) => {
    const role = roleOf(name);
    const trendTool = role === 'trend' || role === 'breakout';
    if (trending) return trendTool ? 1.15 : 0.85;
    if (ranging) return trendTool ? (role === 'breakout' ? 0.8 : 0.9) : 1.2;
    return 1;
  };
  const strat = { ...rawStrat, hits: rawStrat.hits.map(h => ({ ...h, weight: Math.round(h.weight * regimeW(h.name) * 100) / 100 })) };
  strat.net = strat.hits.reduce((a, h) => a + h.dir * h.weight, 0);
  // Bigger picture: the 1h chart only (the autotrader scans 1m to 1h) — optional, never required.
  const htf = tfScore({ price, rating: read.rating60, ema: read.ema50_60, emaFast: read.ema20_60, rsi: read.rsi60, atr: read.atr60, macd: read.macd60, macdSig: read.macdSig60, adx: read.adx60, diP: read.diPlus60, diM: read.diMinus60, k: read.stochK60, d: read.stochD60 });
  combined += htf * (style === 'swing' ? 0.18 : style === 'scalp' ? 0.04 : 0.1);
  const engineDir = dir || (combined >= 0 ? 1 : -1);
  const engineWeight = setup === 'momentum' ? 0.4 + Math.abs(combined) : SETUP_BASE[setup] / 55;
  const total = strat.net + engineDir * engineWeight + combined * 0.8;
  const strongOpposition = strat.net * engineDir <= -2.2;
  let strategyLed = false;
  // Sharp direction change: several observed turn/spike signals against the engine's side, with the
  // strategy balance agreeing, override the slower M15 read so the robot follows the new direction.
  // Normal/swing never let 1m-only evidence flip the side: that is what makes a robot sell, then buy minutes later.
  const turnAgainst = strat.hits.filter(h => h.dir !== engineDir && TURN_SIGNALS.has(h.name) && !(style !== 'scalp' && h.tf === '1m'));
  const sharpTurn = turnAgainst.length >= 2 && turnAgainst.reduce((a, h) => a + h.weight, 0) >= 2 && strat.net * engineDir < 0;
  if (sharpTurn) { dir = -engineDir; strategyLed = true; }
  else if (dir && !strongOpposition) { /* a clear engine setup keeps its direction */ }
  else if (Math.abs(total) >= 0.05) { const d = total > 0 ? 1 : -1; strategyLed = d !== engineDir || setup === 'momentum'; dir = d; }
  const tieBreak = !dir && Math.abs(combined) < 0.02;
  if (tieBreak) combined = style === 'swing' ? (m15 !== 0 ? m15 : m5 || 0.0001)
    : style === 'normal' ? (m5 !== 0 ? m5 : m15 !== 0 ? m15 : m1 || 0.0001)
    : m1 !== 0 ? m1 : m5 !== 0 ? m5 : (read.rating1 ?? 0) || 0.0001;
  if (!dir) dir = combined >= 0 ? 1 : -1;
  // ---- Anti-whipsaw trend anchor (normal/swing) ----
  // A move against a clear slower trend (15m + 5m + 1h) is a pullback unless a 5m/15m structural
  // turn confirms it; then the robot keeps the trend side instead of flipping on fast-chart noise.
  const slow = m15 * 0.6 + m5 * 0.25 + htf * 0.15;
  const slowDir = slow >= 0 ? 1 : -1;
  const clearTrend = Math.abs(slow) >= 0.22;
  const turnWeight = (d: number) => strat.hits.filter(h => h.dir === d && STRUCTURAL_TURNS.has(h.name) && h.tf !== '1m').reduce((a, h) => a + h.weight, 0);
  const atRangeEdge = ranging && pb15 !== null && (pb15 < 0.2 || pb15 > 0.8);
  let pullbackFiltered = false;
  if (style !== 'scalp' && clearTrend && dir === -slowDir && !atRangeEdge && turnWeight(dir) < 1) {
    dir = slowDir; strategyLed = false; pullbackFiltered = true;
    setup = trending ? 'pullback' : 'momentum';
  }
  const side: 'BUY' | 'SELL' = dir > 0 ? 'BUY' : 'SELL';
  const sign = dir;
  const pro = strat.hits.filter(h => h.dir === sign).sort((a, b) => b.weight - a.weight);
  const con = strat.hits.filter(h => h.dir !== sign);
  const lead = pro[0];
  const bounceTrade = !!lead && roleOf(lead.name) === 'range';
  if (strategyLed && lead) {
    const role = roleOf(lead.name);
    setup = role === 'breakout' ? 'breakout' : role === 'range' ? 'range' : role === 'reversal' ? 'reversal'
      : role === 'trend' ? (trending ? 'pullback' : 'momentum') : setup;
  }
  const turnTrade = setup === 'exhaustion' || setup === 'reversal' || setup === 'range';

  // Market-adaptive take profit: setup, trend strength, volatility, range, daily range left, 1h/4h, session, spikes.
  const tp = takeProfitPlan({
    read, sign: sign as 1 | -1, setup, adx, volatility: volatility.regime, extreme: isExtremeVolatility(read),
    htfWith: htf * sign, session, spike: strat.spike, style, profile: volatility.profile,
  });
  // ---- Structure in the trade's path (for a reachable take profit) and behind it (for the stop) ----
  const levels = [read.bbUp15, read.bbLo15, read.ema50_15, read.ema200_15, read.ema20_15, ...strat.supports, ...strat.resistances].filter(ok);
  const mid15 = ok(read.bbUp15) && ok(read.bbLo15) ? (read.bbUp15 + read.bbLo15) / 2 : null;
  if (mid15 && turnTrade && tp.method !== 'rangeRotation') levels.push(mid15); // rotations aim past the midline
  const ahead = levels.map(l => ((l - price) * sign) / atr).filter(x => x > 0).sort((a, b) => a - b);
  const behind = levels.map(l => ((price - l) * sign) / atr).filter(x => x > 0.6 && x < 1.75).sort((a, b) => a - b);
  // Recent candle swing behind the trade: the stop goes just beyond it.
  const swing = sign > 0 ? strat.swingLow : strat.swingHigh;
  const swingAtr = ok(swing) ? ((price - swing) * sign) / atr : null;
  if (swingAtr !== null && swingAtr > 0.4 && swingAtr < 1.75) behind.push(swingAtr);
  behind.sort((a, b) => a - b);

  let targetAtr = tp.targetAtr;
  // Take profit just in front of the first obstacle (breakouts have already cleared the band).
  // Style sizing: scalp takes the nearest move, swing aims for the bigger leg.
  const baseSizing = style === 'scalp' ? { t: 0.7, st: 0.75, tMin: 0.8, tMax: 1.5, sMin: 0.8, sMax: 1.3, clear: 0.8 }
    : style === 'swing' ? { t: 1.5, st: 1.3, tMin: 1.8, tMax: 3.6, sMin: 1.5, sMax: 2.6, clear: 2.0 }
    : { t: 1, st: 1, tMin: 1.05, tMax: 2.4, sMin: 1.1, sMax: 1.9, clear: 1.2 };
  const adaptive = volatility.dir === sign && !strongOpposition &&
    ((volatility.setup === 'quietRange' && setup === 'range') || (volatility.setup === 'volatilePullback' && setup === 'pullback'));
  const scale = adaptive ? volatility.sizeScale : 1;
  // Multi-chart volatility: more stop room when 1m/5m/1h volatility is expanding, less when it compresses.
  const vol = volatility.profile;
  const S = { ...baseSizing, t: baseSizing.t * scale * vol.targetScale, st: baseSizing.st * scale * vol.stopScale,
    tMin: baseSizing.tMin * scale, tMax: baseSizing.tMax * scale,
    sMin: baseSizing.sMin * scale, sMax: baseSizing.sMax * scale };
  targetAtr *= S.t;
  // Every style respects the nearest observed obstacle, including very close levels.
  const obstacle = ahead[0];
  let tightRoom = false;
  if (obstacle !== undefined) {
    const cap = obstacle * 0.9;
    if (cap < S.tMin) tightRoom = true;
    targetAtr = Math.min(targetAtr, cap);
  }
  // A nearby barrier takes precedence over a style's preferred target distance.
  targetAtr = obstacle === undefined ? clamp(targetAtr, S.tMin, S.tMax) : Math.min(targetAtr, S.tMax, obstacle * 0.9);

  let stopAtr = (setup === 'pullback' ? 1.3 : setup === 'breakout' ? 1.4 : turnTrade ? 1.2 : 1.5) * S.st;
  const protectiveFloor = Math.max(S.sMin, behind.length ? behind[0] + 0.15 : S.sMin,
    swingAtr !== null && swingAtr > 0.4 && swingAtr < 1.75 ? swingAtr + 0.15 : S.sMin);
  if (behind.length) stopAtr = Math.max(stopAtr, protectiveFloor); // just beyond protective structure
  stopAtr = clamp(stopAtr, S.sMin, S.sMax);
  // Good trade geometry: take profit at least 1.3x the stop. Raise the target when there's room,
  // otherwise tighten the stop (never below the style minimum).
  const minRR = 1.3;
  if (targetAtr < stopAtr * minRR) {
    const roomCap = obstacle !== undefined ? obstacle * 0.9 : S.tMax;
    targetAtr = Math.min(S.tMax, roomCap, stopAtr * minRR);
    if (targetAtr < stopAtr * minRR) stopAtr = Math.max(protectiveFloor, targetAtr / minRR);
  }

  // ---- Signal strength: setup quality + how many independent strategies confirm ----
  const agree = [m15, m5, m1].filter(s => s * sign > 0).length;
  const sessionAdj = session?.quality === 'high' ? 4 : session?.quality === 'low' ? -6 : 0;
  const proW = pro.reduce((a, h) => a + h.weight, 0);
  const conW = con.reduce((a, h) => a + h.weight, 0);
  const families = new Set(pro.map(h => (h.name === 'support' || h.name === 'resistance' ? 'sr' : h.name))).size;
  let strength = (setup === 'momentum' && !pro.length ? 52 : SETUP_BASE[setup] - 10) + Math.abs(combined) * 12 + agree * 2 + sessionAdj
    + Math.min(20, proW * 5) - Math.min(18, conW * 6) + (families >= 3 ? 4 : 0);
  if (agree < 2) strength -= 6;
  if (!turnTrade && m1 * sign < 0) strength -= 5; // entry timing not yet with us
  if (tightRoom) strength -= 10;
  if (targetAtr / stopAtr < minRR) strength -= 8;
  // Counter-trend: smaller penalty when an observed direction change or spike backs the new side.
  const turnSeen = pro.some(h => TURN_SIGNALS.has(h.name));
  if (trending && setup !== 'exhaustion' && !bounceTrade && sign !== trendDir) strength -= turnSeen ? (style === 'swing' ? 6 : 2) : style === 'swing' ? 12 : 6;
  if (style === 'scalp' && m1 * sign > 0 && m5 * sign > 0) strength += 3; // fast timing lined up
  if (families >= 5) strength += 3; // many independent strategy families agree
  // Bigger picture: reward trades with the 1h trend, penalise fighting it (turn trades less so).
  const htfWith = htf * sign;
  let htfNote = '';
  if (htfWith > 0.25) { strength += style === 'swing' ? 6 : 4; htfNote = '1h trend agrees'; }
  else if (htfWith < -0.3) { strength -= turnTrade ? 2 : style === 'swing' ? 10 : style === 'scalp' ? 3 : 6; htfNote = 'against the 1h trend'; }
  // Market conditions.
  const notes: string[] = [];
  if (strat.choppy && setup !== 'range') { strength -= 5; notes.push('choppy market'); }
  if (strat.squeeze && !pro.some(h => h.name === 'squeezeFire' || h.name === 'emaCompressionBreak') && setup !== 'breakout') { strength -= 3; notes.push('volatility squeeze still building'); }
  if (setup === 'breakout' && strat.volumeRatio !== undefined && strat.volumeRatio < 0.7) { strength -= 6; notes.push('breakout on low volume'); }
  if (sharpTurn && !pullbackFiltered) notes.push('sharp direction change detected');
  if (pullbackFiltered) notes.push('fast-chart pullback filtered — following the slower trend');
  else if (strat.fastNoise && style !== 'scalp') notes.push('1m noise ignored');
  const spike = strat.spike;
  if (spike) {
    const what = `${spike.timeframe} ${spike.size}x spike`;
    if (spike.dir === sign) { strength += 2; notes.push(spike.kind === 'momentum' ? `riding the ${what}` : `${what} rejected in this direction`); }
    else { strength -= 8; notes.push(`fresh ${what} against this trade`); }
  } else if (ok(read.high1) && ok(read.low1) && read.high1 - read.low1 > atr * 1.0) { strength -= 6; notes.push('unclear 1m volatility spike'); }
  // Extreme volatility: don't chase a breakout unless a retest or pullback gives a better entry.
  if (isExtremeVolatility(read) && setup === 'breakout' && !pro.some(h => h.name === 'retestHold' || h.name === 'emaFlipRetest' || h.name === 'ema20Bounce')) { strength -= 5; notes.push('extreme volatility — not chasing the breakout'); }
  if (vol.state === 'climax' && setup === 'breakout') { strength -= 4; notes.push('volatility climax — breakout may be late'); }
  // EMA agreement: the smart EMA strategies backing (or fighting) this side.
  const emaPro = pro.filter(h => strategyInfo(h.name)?.family === 'ema').length, emaCon = con.filter(h => strategyInfo(h.name)?.family === 'ema').length;
  if (emaPro >= 3 && emaCon === 0) { strength += 3; notes.push(`${emaPro} EMA strategies agree`); }
  else if (emaCon >= 3 && emaPro === 0) { strength -= 4; notes.push(`${emaCon} EMA strategies disagree`); }
  // Agreement across independent kinds of evidence (EMA, trend, momentum, structure, levels, candles, volatility, volume).
  const proKinds = evidenceKinds(pro.map(h => h.name)), conKinds = evidenceKinds(con.map(h => h.name));
  if (proKinds >= 4) { strength += 4; notes.push(`${proKinds} kinds of evidence agree`); }
  if (conKinds >= 3) { strength -= 4; notes.push(`${conKinds} kinds of evidence disagree`); }
  strength = Math.round(clamp(strength, 50, 97));

  const regime = trending ? `trending ${trendDir > 0 ? 'up' : 'down'} (ADX ${Math.round(adx)})` : ranging ? 'ranging' : 'transitioning';
  const styleName = style === 'scalp' ? 'Scalp' : style === 'swing' ? 'Swing' : 'Normal';
  const headline = strategyLed && lead ? lead.label.replace(/^./, c => c.toUpperCase()) : SETUP_LABEL[setup];
  const confirms = pro.filter(h => h !== lead || !strategyLed).slice(0, 3).map(h => h.label);
  const tpNote = `TP ${tp.label}${tp.notes.length ? ` (${tp.notes.slice(0, 2).join(', ')})` : ''}`;
  const parts = [
    `volatility ${volatility.regime}${adaptive ? volatility.setup === 'quietRange' ? ' — adaptive range turn' : ' — adaptive pullback retest' : ''}${vol.state !== 'steady' ? ` (${vol.state})` : ''}`,
    confirms.length ? `confirmed by ${confirms.join(', ')}` : '',
    `market ${regime}`,
    agree === 3 ? 'all charts agree' : '',
    htfNote,
    families >= 3 ? `${families} strategy families confirm` : '',
    ...notes,
    con.length ? `against: ${con.slice(0, 2).map(h => h.label).join(', ')}` : '',
    tieBreak ? 'balanced — decided by latest momentum' : '',
    tpNote,
    tightRoom ? 'nearby level limits room' : '',
    targetAtr / stopAtr < minRR ? 'limited reward versus risk' : '',
    session ? session.name : '',
  ].filter(Boolean);
  // Not enough room before the next observed level: never trade a tiny target against a full stop.
  const rewardRisk = targetAtr / stopAtr;
  if (targetAtr < S.tMin * MIN_ROOM_SHARE || rewardRisk < MIN_TRADE_RR || protectiveFloor > S.sMax) {
    // Always trade (user choice): fall back to a compact protected scalp geometry
    // — style-minimum stop, target at 1.2x the stop — and lower the confidence.
    // Volatility-adaptive scaling never applies here: the compact trade keeps the full style-minimum stop.
    stopAtr = baseSizing.sMin;
    targetAtr = Math.max(targetAtr, stopAtr * 1.2);
    parts[0] = `volatility ${volatility.regime}`;
    strength = Math.max(50, strength - 8);
    const at = parts.indexOf(tpNote); if (at >= 0) parts.splice(at, 1);
    parts.push('tight room — compact target');
  }
  const reason = `${side} ${strength}% (${styleName}): ${headline} — ${parts.join('; ')}`;
  return {
    side, confidence: strength, entry: price,
    stopLoss: price - sign * atr * stopAtr,
    takeProfit: price + sign * atr * targetAtr,
    timeframe: style === 'swing' ? '15m' : '5m',
    turnConfirmed: turnWeight(sign) >= 1,
    trendSide: clearTrend ? (slowDir > 0 ? 'BUY' : 'SELL') : undefined,
    timeframeReason: [headline, ...pro.slice(0, 4).map(h => h.label)].filter((x, i, a) => a.indexOf(x) === i).join(' · '),
    reason,
  };
}
