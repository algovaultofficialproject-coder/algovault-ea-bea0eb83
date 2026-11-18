/**
 * AlgoVault smart strategy library (pure, browser + server safe, no network).
 * Every strategy reads only the 1m, 5m, 15m and 1h charts. Each one is optional: a missing
 * reading simply skips it, so nothing is ever invented. Strategies that run on several charts
 * count once per direction (the strongest chart wins) so repeats are not mistaken for confirmation.
 */
import type { SwingRead } from './smart-signal-policy';

export type Tf = '1m' | '5m' | '15m' | '1h';
/** The only charts the autotrader scans. */
export const SCAN_TIMEFRAMES: readonly Tf[] = ['1m', '5m', '15m'];
/** Slower charts carry more weight; 1m only times entries. */
export const TF_WEIGHT: Record<Tf, number> = { '1m': 0.6, '5m': 0.85, '15m': 1, '1h': 1.15 };

export type Family = 'ema' | 'trend' | 'momentum' | 'structure' | 'level' | 'candle' | 'volatility' | 'volume';
/** What kind of trade the strategy points to: with the trend, a breakout, a range edge or a turn. */
export type Role = 'trend' | 'breakout' | 'range' | 'reversal';
export interface StrategyInfo { family: Family; role: Role; title: string; tfs: readonly Tf[]; turn?: true; structural?: true }

const ALL: readonly Tf[] = SCAN_TIMEFRAMES;
const NO1M: readonly Tf[] = ['5m', '15m'];
const FAST: readonly Tf[] = ['1m', '5m'];
const MID: readonly Tf[] = ['5m', '15m'];
const SLOW: readonly Tf[] = ['15m'];
const MULTI: readonly Tf[] = ALL;

/** The full strategy book: name → family, role and the charts it scans. */
export const STRATEGY_BOOK = {
  // ---- EMA strategies ----
  emaRibbon: { family: 'ema', role: 'trend', title: 'EMA 9/20/50/100/200 ribbon fully stacked', tfs: NO1M },
  emaFastCross: { family: 'ema', role: 'trend', title: 'EMA9 crosses EMA20 with the candle', tfs: ['1m', '5m', '15m'] },
  emaTrendCross: { family: 'ema', role: 'trend', title: 'EMA20 crosses EMA50', tfs: NO1M },
  goldenCross: { family: 'ema', role: 'trend', title: 'EMA50 crosses EMA200 (golden / death cross)', tfs: ['5m', '15m', '1h'] },
  ema20Bounce: { family: 'ema', role: 'trend', title: 'Trend pullback holds EMA20', tfs: ALL },
  ema50Bounce: { family: 'ema', role: 'trend', title: 'Deeper pullback holds EMA50', tfs: NO1M },
  ema200Reclaim: { family: 'ema', role: 'reversal', title: 'Price reclaims / loses EMA200', tfs: ['5m', '15m', '1h'], structural: true },
  ema9Ride: { family: 'ema', role: 'trend', title: 'Strong trend riding EMA9', tfs: ['1m', '5m', '15m'] },
  emaFanExpansion: { family: 'ema', role: 'trend', title: 'EMA fan widening (trend accelerating)', tfs: NO1M },
  emaSlopeAlign: { family: 'ema', role: 'trend', title: 'EMA20 sloping the same way on three charts', tfs: MULTI },
  emaMtfStack: { family: 'ema', role: 'trend', title: 'EMA20 over EMA50 on 1m, 5m, 15m and 1h', tfs: MULTI },
  emaStretchSnap: { family: 'ema', role: 'reversal', title: 'Over-stretched from EMA20 and snapping back', tfs: NO1M, turn: true },
  emaCompressionBreak: { family: 'ema', role: 'breakout', title: 'Tangled EMAs released by a strong candle', tfs: MID },
  emaPullbackZone: { family: 'ema', role: 'trend', title: 'Turn inside the EMA20–EMA50 value zone', tfs: NO1M },
  emaFlipRetest: { family: 'ema', role: 'breakout', title: 'EMA50 flipped and retested', tfs: MID },
  ema1hBias: { family: 'ema', role: 'trend', title: '1h EMA50/EMA200 bias with 15m EMAs agreeing', tfs: MULTI },
  // ---- Trend ----
  adxTrend: { family: 'trend', role: 'trend', title: 'ADX trend strength with DI leadership', tfs: NO1M },
  diCross: { family: 'trend', role: 'trend', title: 'Fresh directional-index cross', tfs: ['15m'] },
  psarTrend: { family: 'trend', role: 'trend', title: 'Parabolic SAR and EMA20 agree', tfs: ['15m'] },
  ichimokuCloud: { family: 'trend', role: 'trend', title: 'Ichimoku cloud side and Tenkan/Kijun', tfs: ['15m'] },
  heikinAshi: { family: 'trend', role: 'trend', title: 'Heikin-Ashi candle with no opposing wick', tfs: NO1M },
  ratingConsensus: { family: 'trend', role: 'trend', title: 'Chart ratings agree on 1m, 5m, 15m and 1h', tfs: MULTI },
  // ---- Momentum ----
  macdCross: { family: 'momentum', role: 'trend', title: 'Fresh MACD signal-line cross', tfs: MID },
  macdZeroCross: { family: 'momentum', role: 'trend', title: 'MACD crosses the zero line', tfs: MID },
  macdHistogram: { family: 'momentum', role: 'trend', title: 'MACD histogram building on 5m and 15m', tfs: MULTI },
  rsiMomentum: { family: 'momentum', role: 'trend', title: 'RSI in the healthy momentum zone and rising', tfs: ALL },
  rsiMidline: { family: 'momentum', role: 'trend', title: 'RSI crosses 50 with the candle', tfs: ALL },
  aoShift: { family: 'momentum', role: 'trend', title: 'Awesome Oscillator zero cross or saucer', tfs: ['1m', '5m', '15m'] },
  stochTrendTurn: { family: 'momentum', role: 'trend', title: 'Stochastic turns back with the trend', tfs: NO1M },
  momentumBurst: { family: 'momentum', role: 'breakout', title: 'Momentum burst candle', tfs: FAST },
  // ---- Structure ----
  breakOfStructure: { family: 'structure', role: 'breakout', title: 'Break of structure with the trend', tfs: NO1M, structural: true },
  changeOfCharacter: { family: 'structure', role: 'reversal', title: 'Change of character against the old trend', tfs: NO1M, turn: true, structural: true },
  donchianBreakout: { family: 'structure', role: 'breakout', title: '20-candle channel breakout on a strong close', tfs: ALL },
  insideBarBreak: { family: 'structure', role: 'breakout', title: 'Inside-bar breakout', tfs: NO1M },
  liquiditySweep: { family: 'structure', role: 'reversal', title: 'Sweep of the prior extreme, then reclaim', tfs: ALL, turn: true, structural: true },
  retestHold: { family: 'structure', role: 'breakout', title: 'Broken level holds on the retest', tfs: MID },
  equalLevels: { family: 'structure', role: 'range', title: 'Double bottom / double top holds', tfs: MID },
  displacement: { family: 'structure', role: 'breakout', title: '5m displacement leaves a gap beyond the prior 15m candle', tfs: MULTI },
  structureAlign: { family: 'structure', role: 'trend', title: 'Higher highs and lows on 5m, 15m and 1h', tfs: MULTI },
  h1LevelBreak: { family: 'structure', role: 'breakout', title: 'Prior 1h high/low broken with a 5m close', tfs: MULTI },
  // ---- Levels ----
  support: { family: 'level', role: 'range', title: 'Bounce off support', tfs: MULTI },
  resistance: { family: 'level', role: 'range', title: 'Rejection at resistance', tfs: MULTI },
  vwapReclaim: { family: 'level', role: 'trend', title: 'VWAP reclaimed / lost', tfs: MID },
  vwapStretch: { family: 'level', role: 'reversal', title: 'Stretched from VWAP and turning', tfs: ['15m'], turn: true },
  premiumDiscount: { family: 'level', role: 'range', title: '1h premium / discount reaction', tfs: MULTI },
  rangeEdgeFade: { family: 'level', role: 'range', title: 'Quiet range edge fade', tfs: MID },
  // ---- Candles ----
  engulfing: { family: 'candle', role: 'reversal', title: 'Engulfing candle', tfs: NO1M },
  pinBar: { family: 'candle', role: 'reversal', title: 'Pin bar at a band or EMA', tfs: NO1M, turn: true },
  candlePatterns: { family: 'candle', role: 'reversal', title: 'Chart candle patterns', tfs: MID },
  candleAlign: { family: 'candle', role: 'trend', title: '1m, 5m, 15m and 1h candles all strong the same way', tfs: MULTI },
  vReversal: { family: 'candle', role: 'reversal', title: 'V-shaped reversal', tfs: NO1M, turn: true, structural: true },
  // ---- Volatility ----
  squeezeFire: { family: 'volatility', role: 'breakout', title: 'Bollinger-inside-Keltner squeeze firing', tfs: MID },
  bandWalk: { family: 'volatility', role: 'trend', title: 'Strong trend walking the band', tfs: SLOW },
  bandReversion: { family: 'volatility', role: 'range', title: 'Band pierce snapped back inside', tfs: ['1m', '5m', '15m'] },
  atrExpansion: { family: 'volatility', role: 'breakout', title: 'Fast-chart volatility expanding with momentum', tfs: MULTI },
  volatilityClimax: { family: 'volatility', role: 'reversal', title: 'Volatility climax being given back', tfs: MID, turn: true },
  quietBreakout: { family: 'volatility', role: 'breakout', title: 'Quiet candle followed by an expansion', tfs: NO1M },
  // ---- Volume ----
  volumeThrust: { family: 'volume', role: 'breakout', title: 'Strong candle on high relative volume', tfs: ['15m'] },
  // ---- Turns and spikes (observed, never predicted) ----
  spikeMomentum: { family: 'candle', role: 'breakout', title: 'Spike closing at its extreme', tfs: FAST, turn: true },
  spikeRejection: { family: 'structure', role: 'reversal', title: 'Spike rejected with a long wick', tfs: FAST, turn: true, structural: true },
  directionChange: { family: 'structure', role: 'reversal', title: '5m break against the 15m trend with fast momentum flipped', tfs: MULTI, turn: true, structural: true },
  trendPullbackHold: { family: 'trend', role: 'trend', title: 'Pullback inside an intact 15m trend', tfs: MULTI },
  failedTurn: { family: 'candle', role: 'trend', title: 'Counter-move failed and the trend resumed', tfs: ['5m'] },
  confirmedReversal: { family: 'structure', role: 'reversal', title: 'Two 15m candles close through EMA20 and the prior extreme', tfs: ['15m'], turn: true, structural: true },
  divergence: { family: 'momentum', role: 'reversal', title: 'New extreme without RSI / MACD confirmation', tfs: MID },
  oscillatorTurn: { family: 'momentum', role: 'reversal', title: 'Several oscillators at an extreme with a turning candle', tfs: MID, turn: true },
} as const satisfies Record<string, StrategyInfo>;

export type StrategyName = keyof typeof STRATEGY_BOOK;
export const STRATEGY_NAMES = Object.keys(STRATEGY_BOOK) as StrategyName[];
export const strategyInfo = (name: string): StrategyInfo | undefined => (STRATEGY_BOOK as Record<string, StrategyInfo>)[name];

/** `tf` marks evidence seen only on the 1m chart, which normal/swing never let flip the direction. */
export interface StrategyHit { name: StrategyName; dir: 1 | -1; weight: number; label: string; tf?: '1m' }
/** A forming 1m/5m candle far larger than normal: momentum (closes at its extreme) or rejection (long wick back). */
export interface SpikeRead { dir: 1 | -1; kind: 'momentum' | 'rejection'; size: number; timeframe: '1m' | '5m' }

// ---------- candles and charts ----------
export interface Candle { o: number; h: number; l: number; c: number }
export const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** Signed readings (MACD, AO, CCI, momentum): the feed reports a missing value as 0. */
export const has = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n !== 0;
export function candle(o?: number, h?: number, l?: number, c?: number): Candle | null {
  if (!ok(o) || !ok(h) || !ok(l) || !ok(c) || h <= l || h < Math.max(o, c) || l > Math.min(o, c)) return null;
  return { o, h, l, c };
}
export const range = (k: Candle) => k.h - k.l;
export const body = (k: Candle) => Math.abs(k.c - k.o);
export const upperWick = (k: Candle) => k.h - Math.max(k.o, k.c);
export const lowerWick = (k: Candle) => Math.min(k.o, k.c) - k.l;
/** 0 = closed at the low, 1 = closed at the high. */
export const closeLoc = (k: Candle) => (k.c - k.l) / range(k);
const cdir = (k: Candle): 1 | -1 => (k.c >= k.o ? 1 : -1);
/** Strong close in direction d (body and close location both agree). */
const strong = (k: Candle | null, d: number, loc = 0.6) => !!k && (k.c - k.o) * d > 0 && (d > 0 ? closeLoc(k) >= loc : closeLoc(k) <= 1 - loc);

/** One chart's live readings in a common shape so strategies can run on any timeframe. */
export interface Frame {
  tf: Tf; atr: number; cur: Candle | null; prev: Candle | null;
  ema9?: number; ema20?: number; ema50?: number; ema100?: number; ema200?: number;
  ema9Prev?: number; ema20Prev?: number; ema50Prev?: number;
  rsi?: number; rsiPrev?: number; macd?: number; macdSig?: number; macdPrev?: number; macdSigPrev?: number;
  adx?: number; diP?: number; diM?: number; diPPrev?: number; diMPrev?: number;
  k?: number; d?: number; kPrev?: number; dPrev?: number;
  bbUp?: number; bbLo?: number; kcUp?: number; kcLo?: number; donHi?: number; donLo?: number; vwap?: number;
  ao?: number; aoPrev?: number; aoPrev2?: number; cci?: number; cciPrev?: number; mom?: number; rating?: number;
  bull?: number; bear?: number;
}

/** Builds the 1m / 5m / 15m / 1h frames from one TradingView read. */
export function buildFrames(read: SwingRead): Record<Tf, Frame> | null {
  const p = read.price, a15 = read.atr15;
  if (!ok(p) || !ok(a15) || a15 >= p) return null;
  const atr5 = ok(read.atr5) && read.atr5 < p ? read.atr5 : a15 / 1.8;
  const atr1 = ok(read.atr1) && read.atr1 < p ? read.atr1 : atr5 / 2.2;
  const atr60 = ok(read.atr60) && read.atr60 < p ? read.atr60 : a15 * 2;
  return {
    '1m': { tf: '1m', atr: atr1, cur: candle(read.open1, read.high1, read.low1, p), prev: candle(read.prevOpen1, read.prevHigh1, read.prevLow1, read.prevClose1),
      ema9: read.ema9_1, ema20: read.ema20_1, ema50: read.ema50_1, ema200: read.ema200_1, ema9Prev: read.ema9Prev1, ema20Prev: read.ema20Prev1,
      rsi: read.rsi1, rsiPrev: read.rsiPrev1, macd: read.macd1, macdSig: read.macdSig1, adx: read.adx1, k: read.stochK1, d: read.stochD1,
      bbUp: read.bbUp1, bbLo: read.bbLo1, donHi: read.donHi1, donLo: read.donLo1, ao: read.ao1, aoPrev: read.aoPrev1, cci: read.cci1, mom: read.mom1, rating: read.rating1 },
    '5m': { tf: '5m', atr: atr5, cur: candle(read.open5, read.high5, read.low5, p), prev: candle(read.prevOpen5, read.prevHigh5, read.prevLow5, read.prevClose5),
      ema9: read.ema9_5, ema20: read.ema20_5, ema50: read.ema50_5, ema100: read.ema100_5, ema200: read.ema200_5,
      ema9Prev: read.ema9Prev5, ema20Prev: read.ema20Prev5, ema50Prev: read.ema50Prev5,
      rsi: read.rsi5, rsiPrev: read.rsiPrev5, macd: read.macd5, macdSig: read.macdSig5, macdPrev: read.macdPrev5, macdSigPrev: read.macdSigPrev5,
      adx: read.adx5, diP: read.diPlus5, diM: read.diMinus5, k: read.stochK5, d: read.stochD5, kPrev: read.stochKPrev5, dPrev: read.stochDPrev5,
      bbUp: read.bbUp5, bbLo: read.bbLo5, kcUp: read.kcUp5, kcLo: read.kcLo5, donHi: read.donHi5, donLo: read.donLo5, vwap: read.vwap5,
      ao: read.ao5, aoPrev: read.aoPrev5, cci: read.cci5, rating: read.rating5, bull: read.bullPat5, bear: read.bearPat5 },
    '15m': { tf: '15m', atr: a15, cur: candle(read.open15, read.high15, read.low15, p), prev: candle(read.prevOpen15, read.prevHigh15, read.prevLow15, read.prevClose15),
      ema9: read.ema9_15, ema20: read.ema20_15, ema50: read.ema50_15, ema100: read.ema100_15, ema200: read.ema200_15, ema20Prev: read.ema20Prev15, ema50Prev: read.ema50Prev15,
      rsi: read.rsi15, rsiPrev: read.rsiPrev15, macd: read.macd15, macdSig: read.macdSig15, macdPrev: read.macdPrev15, macdSigPrev: read.macdSigPrev15,
      adx: read.adx15, diP: read.diPlus15, diM: read.diMinus15, diPPrev: read.diPlusPrev15, diMPrev: read.diMinusPrev15,
      k: read.stochK15, d: read.stochD15, kPrev: read.stochKPrev15, dPrev: read.stochDPrev15,
      bbUp: read.bbUp15, bbLo: read.bbLo15, kcUp: read.kcUp15, kcLo: read.kcLo15, donHi: read.donHi15, donLo: read.donLo15, vwap: read.vwap15,
      ao: read.ao15, aoPrev: read.aoPrev15, aoPrev2: read.aoPrev2_15, cci: read.cci15, cciPrev: read.cciPrev15, mom: read.mom15, rating: read.rating15,
      bull: read.bullPat15, bear: read.bearPat15 },
    // 1h is not scanned: an empty frame makes every 1h-dependent strategy skip instead of guessing.
    '1h': { tf: '1h', atr: atr60, cur: null, prev: null },
  };
}

/** EMA trend of one chart: +1 EMA20 over EMA50, -1 under, 0 unknown. */
export const emaTrend = (f: Frame): 0 | 1 | -1 => (ok(f.ema20) && ok(f.ema50) ? (f.ema20 > f.ema50 ? 1 : f.ema20 < f.ema50 ? -1 : 0) : 0);

export interface StrategyContext {
  read: SwingRead; price: number; frames: Record<Tf, Frame>;
  /** Reaction levels (support / resistance candidates) from the 1m–1h charts. */
  react: Array<[number, string]>;
}

/** Runs every strategy in the book. Returns raw hits (the scanner keeps the strongest per name and direction). */
export function runSmartStrategies(ctx: StrategyContext): { hits: StrategyHit[]; spike?: SpikeRead; fastNoise: boolean } {
  const { read, price, frames, react } = ctx;
  const F = frames;
  const hits: StrategyHit[] = [];
  const add = (name: StrategyName, dir: 1 | -1, weight: number, label: string, tf?: Tf) => {
    const w = weight * (tf ? TF_WEIGHT[tf] : 1);
    hits.push({ name, dir, weight: Math.round(w * 100) / 100, label, ...(tf === '1m' ? { tf: '1m' as const } : {}) });
  };
  const on = (name: StrategyName) => STRATEGY_BOOK[name].tfs.filter((t) => SCAN_TIMEFRAMES.includes(t)).map((t) => F[t]);
  const word = (d: number) => (d > 0 ? 'up' : 'down');
  const trend15 = emaTrend(F['15m']);
  const c1 = F['1m'].cur, c5 = F['5m'].cur, p5 = F['5m'].prev, c15 = F['15m'].cur, p15 = F['15m'].prev, c60 = F['1h'].cur, p60 = F['1h'].prev;
  const atr = F['15m'].atr;

  // ================= EMA strategies =================
  for (const f of on('emaRibbon')) {
    if (![f.ema9, f.ema20, f.ema50, f.ema100, f.ema200].every(ok) && ![f.ema20, f.ema50, f.ema100, f.ema200].every(ok)) continue;
    const seq = [f.ema9, f.ema20, f.ema50, f.ema100, f.ema200].filter(ok) as number[];
    const up = price > seq[0] && seq.every((v, i) => i === 0 || seq[i - 1] > v);
    const dn = price < seq[0] && seq.every((v, i) => i === 0 || seq[i - 1] < v);
    if (up || dn) add('emaRibbon', up ? 1 : -1, 1, `full ${up ? 'bullish' : 'bearish'} EMA ribbon on ${f.tf}`, f.tf);
  }
  const crossed = (a0?: number, b0?: number, a?: number, b?: number): 0 | 1 | -1 => {
    if (![a0, b0, a, b].every(ok)) return 0;
    if (a0! <= b0! && a! > b!) return 1;
    if (a0! >= b0! && a! < b!) return -1;
    return 0;
  };
  for (const f of on('emaFastCross')) {
    const x = crossed(f.ema9Prev, f.ema20Prev, f.ema9, f.ema20);
    if (x && strong(f.cur, x, 0.55)) add('emaFastCross', x, 0.85, `${f.tf} EMA9 crossed ${x > 0 ? 'above' : 'below'} EMA20`, f.tf);
  }
  for (const f of on('emaTrendCross')) {
    const x = crossed(f.ema20Prev, f.ema50Prev, f.ema20, f.ema50);
    if (x && (price - f.ema50!) * x > 0) add('emaTrendCross', x, 1.05, `${f.tf} EMA20 crossed ${x > 0 ? 'above' : 'below'} EMA50`, f.tf);
  }
  for (const f of on('goldenCross')) {
    const x = crossed(f.ema50Prev, f.ema200, f.ema50, f.ema200);
    if (x && (price - f.ema200!) * x > 0) add('goldenCross', x, 1.15, `${f.tf} ${x > 0 ? 'golden' : 'death'} cross: EMA50 ${x > 0 ? 'above' : 'below'} EMA200`, f.tf);
  }
  const bounce = (f: Frame, e: number | undefined, d: number, tol: number) => {
    const k = f.cur;
    if (!k || !ok(e)) return false;
    return d > 0 ? k.l <= e + f.atr * tol && k.l >= e - f.atr * 0.4 && price > e + f.atr * 0.03 && closeLoc(k) >= 0.6
      : k.h >= e - f.atr * tol && k.h <= e + f.atr * 0.4 && price < e - f.atr * 0.03 && closeLoc(k) <= 0.4;
  };
  for (const f of on('ema20Bounce')) {
    const d = emaTrend(f);
    if (d && bounce(f, f.ema20, d, 0.12)) add('ema20Bounce', d, 1.1, `${f.tf} pullback ${d > 0 ? 'held' : 'rejected'} EMA20 in the ${word(d)}trend`, f.tf);
  }
  for (const f of on('ema50Bounce')) {
    const d = ok(f.ema50) && ok(f.ema200) ? (f.ema50 > f.ema200 ? 1 : -1) : emaTrend(f);
    if (d && bounce(f, f.ema50, d, 0.15) && (f.adx ?? 20) >= 18) add('ema50Bounce', d, 1.05, `${f.tf} EMA50 ${d > 0 ? 'support' : 'resistance'} held`, f.tf);
  }
  for (const f of on('ema200Reclaim')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || !ok(f.ema200)) continue;
    if (pk.c < f.ema200 && price > f.ema200 + f.atr * 0.05 && strong(k, 1)) add('ema200Reclaim', 1, 1.1, `${f.tf} reclaimed EMA200`, f.tf);
    if (pk.c > f.ema200 && price < f.ema200 - f.atr * 0.05 && strong(k, -1)) add('ema200Reclaim', -1, 1.1, `${f.tf} lost EMA200`, f.tf);
  }
  for (const f of on('ema9Ride')) {
    const k = f.cur, pk = f.prev, d = emaTrend(f);
    if (!k || !pk || !d || !ok(f.ema9) || (f.adx ?? 0) < 25) continue;
    const prevE = ok(f.ema9Prev) ? f.ema9Prev : f.ema9;
    const held = d > 0 ? pk.l > prevE && k.l > f.ema9 : pk.h < prevE && k.h < f.ema9;
    if (held && (k.c - k.o) * d > 0) add('ema9Ride', d, 0.85, `${f.tf} strong ${word(d)}trend riding EMA9`, f.tf);
  }
  for (const f of on('emaFanExpansion')) {
    const fast = ok(f.ema9) ? f.ema9 : f.ema20, fastPrev = ok(f.ema9Prev) ? f.ema9Prev : f.ema20Prev;
    if (!ok(fast) || !ok(fastPrev) || !ok(f.ema50) || !ok(f.ema50Prev)) continue;
    const gap = (fast - f.ema50) / f.atr, gapPrev = (fastPrev - f.ema50Prev) / f.atr;
    if (Math.abs(gap) >= 0.3 && Math.abs(gap) < 2.5 && Math.sign(gap) === Math.sign(gapPrev) && Math.abs(gap) > Math.abs(gapPrev) + 0.04 && (price - fast) * gap > 0)
      add('emaFanExpansion', gap > 0 ? 1 : -1, 0.85, `${f.tf} EMA fan widening ${word(gap)}`, f.tf);
  }
  {
    const slopes = (['1m', '5m', '15m', '1h'] as const).map((t) => {
      const f = F[t];
      if (!ok(f.ema20) || !ok(f.ema20Prev)) return 0;
      const s = (f.ema20 - f.ema20Prev) / f.atr;
      return Math.abs(s) >= 0.04 && (price - f.ema20) * s > 0 ? Math.sign(s) : 0;
    });
    const upN = slopes.filter((s) => s > 0).length, dnN = slopes.filter((s) => s < 0).length;
    if (upN >= 3 && dnN === 0) add('emaSlopeAlign', 1, 1, `EMA20 rising on ${upN} charts`);
    if (dnN >= 3 && upN === 0) add('emaSlopeAlign', -1, 1, `EMA20 falling on ${dnN} charts`);
  }
  {
    const stack = SCAN_TIMEFRAMES.map((t) => emaTrend(F[t]));
    const known = stack.filter((s) => s !== 0);
    if (known.length >= 3 && known.every((s) => s === known[0]) && ok(F['15m'].ema20) && (price - F['15m'].ema20!) * known[0] > 0)
      add('emaMtfStack', known[0] as 1 | -1, 1.1 + (known.length === 4 ? 0.15 : 0), `EMA20 ${known[0] > 0 ? 'over' : 'under'} EMA50 on ${known.length} charts`);
  }
  for (const f of on('emaStretchSnap')) {
    const k = f.cur;
    if (!k || !ok(f.ema20)) continue;
    const st = (price - f.ema20) / f.atr;
    if (st > 2.5 && strong(k, -1, 0.6) && upperWick(k) >= range(k) * 0.3) add('emaStretchSnap', -1, 0.9, `${f.tf} ${st.toFixed(1)} ATR above EMA20 and snapping back`, f.tf);
    if (st < -2.5 && strong(k, 1, 0.6) && lowerWick(k) >= range(k) * 0.3) add('emaStretchSnap', 1, 0.9, `${f.tf} ${(-st).toFixed(1)} ATR below EMA20 and snapping back`, f.tf);
  }
  for (const f of on('emaCompressionBreak')) {
    const k = f.cur;
    if (!k || !ok(f.ema9) || !ok(f.ema20) || !ok(f.ema50)) continue;
    const spread = (Math.max(f.ema9, f.ema20, f.ema50) - Math.min(f.ema9, f.ema20, f.ema50)) / f.atr;
    if (spread > 0.3 || range(k) < f.atr * 0.8 || body(k) < range(k) * 0.65) continue;
    const d = cdir(k);
    const beyond = d > 0 ? price > Math.max(f.ema9, f.ema20, f.ema50) : price < Math.min(f.ema9, f.ema20, f.ema50);
    if (beyond && strong(k, d, 0.7)) add('emaCompressionBreak', d, 1, `${f.tf} tangled EMAs released ${word(d)}`, f.tf);
  }
  for (const f of on('emaPullbackZone')) {
    const k = f.cur, d = emaTrend(f);
    if (!k || !d || !ok(f.ema20) || !ok(f.ema50)) continue;
    const lo = Math.min(f.ema20, f.ema50), hi = Math.max(f.ema20, f.ema50);
    const touched = d > 0 ? k.l <= hi && k.l >= lo - f.atr * 0.1 : k.h >= lo && k.h <= hi + f.atr * 0.1;
    if (touched && strong(k, d, 0.62) && (d > 0 ? price > f.ema20 : price < f.ema20)) add('emaPullbackZone', d, 1, `${f.tf} turned ${word(d)} from the EMA20–EMA50 value zone`, f.tf);
  }
  for (const f of on('emaFlipRetest')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || !ok(f.ema50)) continue;
    const e = f.ema50;
    if (pk.o < e && pk.c > e + f.atr * 0.05 && k.l <= e + f.atr * 0.12 && k.l >= e - f.atr * 0.15 && price > e && closeLoc(k) > 0.6) add('emaFlipRetest', 1, 1.05, `${f.tf} EMA50 flipped to support and retested`, f.tf);
    if (pk.o > e && pk.c < e - f.atr * 0.05 && k.h >= e - f.atr * 0.12 && k.h <= e + f.atr * 0.15 && price < e && closeLoc(k) < 0.4) add('emaFlipRetest', -1, 1.05, `${f.tf} EMA50 flipped to resistance and retested`, f.tf);
  }
  {
    const h = F['1h'], m = F['15m'];
    if (ok(h.ema50) && ok(h.ema200) && emaTrend(m) !== 0) {
      const d = price > h.ema50 && h.ema50 > h.ema200 ? 1 : price < h.ema50 && h.ema50 < h.ema200 ? -1 : 0;
      if (d && emaTrend(m) === d) add('ema1hBias', d, 1, `1h ${d > 0 ? 'above' : 'below'} EMA50 and EMA200 with 15m EMAs agreeing`);
    }
  }

  // ================= Trend =================
  for (const f of on('adxTrend')) {
    if (!ok(f.adx) || !ok(f.diP) || !ok(f.diM) || f.adx < 25 || Math.abs(f.diP - f.diM) < 8) continue;
    const d = f.diP > f.diM ? 1 : -1;
    if (emaTrend(f) === 0 || emaTrend(f) === d) add('adxTrend', d, 0.9 + (f.adx >= 35 ? 0.2 : 0), `${f.tf} ADX ${Math.round(f.adx)} trend ${word(d)}`, f.tf);
  }
  {
    const f = F['15m'];
    if ((f.adx ?? 0) >= 18) {
      const x = crossed(f.diPPrev, f.diMPrev, f.diP, f.diM);
      if (x) add('diCross', x, 0.9, `directional index flipped ${x > 0 ? 'bullish' : 'bearish'}`, '15m');
    }
    if (ok(read.psar15) && ok(f.ema20)) {
      const d = read.psar15 < price && price > f.ema20 ? 1 : read.psar15 > price && price < f.ema20 ? -1 : 0;
      if (d && (f.adx ?? 0) >= 20) add('psarTrend', d, 0.75, `Parabolic SAR ${d > 0 ? 'below' : 'above'} price with EMA20 agreeing`, '15m');
    }
    if (ok(read.ichTenkan15) && ok(read.ichKijun15) && ok(read.ichSpanA15) && ok(read.ichSpanB15)) {
      const top = Math.max(read.ichSpanA15, read.ichSpanB15), bot = Math.min(read.ichSpanA15, read.ichSpanB15);
      if (price > top && read.ichTenkan15 > read.ichKijun15 && price > read.ichKijun15) add('ichimokuCloud', 1, 1, 'Ichimoku: above the cloud, Tenkan over Kijun', '15m');
      if (price < bot && read.ichTenkan15 < read.ichKijun15 && price < read.ichKijun15) add('ichimokuCloud', -1, 1, 'Ichimoku: below the cloud, Tenkan under Kijun', '15m');
    }
  }
  for (const f of on('heikinAshi')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk) continue;
    const haC = (k.o + k.h + k.l + k.c) / 4, haO = (pk.o + pk.c) / 2;
    const d: 1 | -1 = haC > haO ? 1 : -1;
    const noWick = d > 0 ? Math.min(haO, haC) - k.l <= f.atr * 0.03 : k.h - Math.max(haO, haC) <= f.atr * 0.03;
    if (Math.abs(haC - haO) >= f.atr * 0.25 && noWick && (emaTrend(f) === 0 || emaTrend(f) === d)) add('heikinAshi', d, 0.75, `${f.tf} Heikin-Ashi ${d > 0 ? 'bullish' : 'bearish'} candle with no opposing wick`, f.tf);
  }
  {
    const r = SCAN_TIMEFRAMES.map((t) => F[t].rating).filter(has) as number[];
    if (r.length >= 3) {
      if (r.every((v) => v >= 0.2)) add('ratingConsensus', 1, 0.9, `chart ratings bullish on ${r.length} charts`);
      if (r.every((v) => v <= -0.2)) add('ratingConsensus', -1, 0.9, `chart ratings bearish on ${r.length} charts`);
    }
  }

  // ================= Momentum =================
  for (const f of on('macdCross')) {
    if (![f.macd, f.macdSig, f.macdPrev, f.macdSigPrev].every(has)) continue;
    const x = f.macdPrev! <= f.macdSigPrev! && f.macd! > f.macdSig! ? 1 : f.macdPrev! >= f.macdSigPrev! && f.macd! < f.macdSig! ? -1 : 0;
    if (x) add('macdCross', x, 1, `${f.tf} MACD crossed ${x > 0 ? 'above' : 'below'} its signal`, f.tf);
  }
  for (const f of on('macdZeroCross')) {
    if (!has(f.macd) || !has(f.macdPrev)) continue;
    if (f.macdPrev <= 0 && f.macd > 0) add('macdZeroCross', 1, 0.9, `${f.tf} MACD crossed above zero`, f.tf);
    if (f.macdPrev >= 0 && f.macd < 0) add('macdZeroCross', -1, 0.9, `${f.tf} MACD crossed below zero`, f.tf);
  }
  {
    const m5 = F['5m'], m15 = F['15m'];
    if ([m5.macd, m5.macdSig, m5.macdPrev, m5.macdSigPrev, m15.macd, m15.macdSig, m15.macdPrev, m15.macdSigPrev].every(has)) {
      const h5 = m5.macd! - m5.macdSig!, g5 = h5 - (m5.macdPrev! - m5.macdSigPrev!);
      const h15 = m15.macd! - m15.macdSig!, g15 = h15 - (m15.macdPrev! - m15.macdSigPrev!);
      const h60 = has(F['1h'].macd) && has(F['1h'].macdSig) ? F['1h'].macd! - F['1h'].macdSig! : 0;
      if (h5 > 0 && h15 > 0 && g5 > 0 && g15 > 0 && h60 >= 0) add('macdHistogram', 1, 0.95, 'MACD histogram building up on 5m and 15m');
      if (h5 < 0 && h15 < 0 && g5 < 0 && g15 < 0 && h60 <= 0) add('macdHistogram', -1, 0.95, 'MACD histogram building down on 5m and 15m');
    }
  }
  for (const f of on('rsiMomentum')) {
    if (!ok(f.rsi) || !ok(f.rsiPrev)) continue;
    if (f.rsi > 55 && f.rsi < 70 && f.rsi > f.rsiPrev + 1 && (f.cur ? (f.cur.c - f.cur.o) > 0 : true)) add('rsiMomentum', 1, 0.75, `${f.tf} RSI ${Math.round(f.rsi)} rising in the momentum zone`, f.tf);
    if (f.rsi < 45 && f.rsi > 30 && f.rsi < f.rsiPrev - 1 && (f.cur ? (f.cur.c - f.cur.o) < 0 : true)) add('rsiMomentum', -1, 0.75, `${f.tf} RSI ${Math.round(f.rsi)} falling in the momentum zone`, f.tf);
  }
  for (const f of on('rsiMidline')) {
    if (!ok(f.rsi) || !ok(f.rsiPrev) || !f.cur) continue;
    const w = f.tf === '15m' ? 0.75 : 0.65;
    if (f.rsiPrev < 50 && f.rsi > 50 && f.cur.c > f.cur.o) add('rsiMidline', 1, w, `${f.tf} RSI crossed above 50`, f.tf);
    if (f.rsiPrev > 50 && f.rsi < 50 && f.cur.c < f.cur.o) add('rsiMidline', -1, w, `${f.tf} RSI crossed below 50`, f.tf);
  }
  for (const f of on('aoShift')) {
    if (!has(f.ao) || !has(f.aoPrev)) continue;
    if (f.aoPrev <= 0 && f.ao > 0) add('aoShift', 1, 0.85, `${f.tf} Awesome Oscillator crossed above zero`, f.tf);
    else if (f.aoPrev >= 0 && f.ao < 0) add('aoShift', -1, 0.85, `${f.tf} Awesome Oscillator crossed below zero`, f.tf);
    else if (has(f.aoPrev2)) {
      if (f.ao > 0 && f.aoPrev2 > f.aoPrev && f.ao > f.aoPrev) add('aoShift', 1, 0.75, `${f.tf} Awesome Oscillator bullish saucer`, f.tf);
      if (f.ao < 0 && f.aoPrev2 < f.aoPrev && f.ao < f.aoPrev) add('aoShift', -1, 0.75, `${f.tf} Awesome Oscillator bearish saucer`, f.tf);
    }
  }
  for (const f of on('stochTrendTurn')) {
    const d = emaTrend(f);
    if (!d || !ok(f.k) || !ok(f.d)) continue;
    const kPrev = ok(f.kPrev) ? f.kPrev : undefined, dPrev = ok(f.dPrev) ? f.dPrev : undefined;
    const freshUp = kPrev !== undefined && dPrev !== undefined ? kPrev <= dPrev && f.k > f.d : f.k > f.d + 3;
    const freshDn = kPrev !== undefined && dPrev !== undefined ? kPrev >= dPrev && f.k < f.d : f.k < f.d - 3;
    if (d > 0 && freshUp && f.k < 40) add('stochTrendTurn', 1, 0.85, `${f.tf} stochastic turned up from a dip in the uptrend`, f.tf);
    if (d < 0 && freshDn && f.k > 60) add('stochTrendTurn', -1, 0.85, `${f.tf} stochastic turned down from a rally in the downtrend`, f.tf);
  }
  for (const f of on('momentumBurst')) {
    const k = f.cur;
    if (!k || range(k) < f.atr * 1.2 || range(k) >= f.atr * 2.2 || body(k) < range(k) * 0.7) continue;
    const d = cdir(k);
    const momOk = has(f.mom) ? f.mom * d > 0 : has(f.rating) ? f.rating * d > 0 : true;
    if (momOk && strong(k, d, 0.75)) add('momentumBurst', d, 0.8, `${f.tf} momentum burst ${word(d)} (${(range(k) / f.atr).toFixed(1)}x normal)`, f.tf);
  }

  // ================= Structure =================
  for (const f of on('breakOfStructure')) {
    const k = f.cur, pk = f.prev, d0 = emaTrend(f);
    if (!k || !pk || !d0) continue;
    if (price > pk.h + f.atr * 0.05 && price - pk.h < f.atr * 0.9 && strong(k, 1)) {
      if (d0 > 0) add('breakOfStructure', 1, 1.15, `${f.tf} break of structure above the prior high, with the trend`, f.tf);
      else if (ok(f.ema20) && price > f.ema20) add('changeOfCharacter', 1, 1.05, `${f.tf} change of character: the downtrend broke its prior high`, f.tf);
    }
    if (price < pk.l - f.atr * 0.05 && pk.l - price < f.atr * 0.9 && strong(k, -1)) {
      if (d0 < 0) add('breakOfStructure', -1, 1.15, `${f.tf} break of structure below the prior low, with the trend`, f.tf);
      else if (ok(f.ema20) && price < f.ema20) add('changeOfCharacter', -1, 1.05, `${f.tf} change of character: the uptrend broke its prior low`, f.tf);
    }
  }
  const stretched15 = ok(F['15m'].ema50) ? Math.abs(price - F['15m'].ema50!) / atr > 3 : false;
  for (const f of on('donchianBreakout')) {
    const k = f.cur;
    if (!k || !ok(f.donHi) || !ok(f.donLo) || stretched15) continue;
    if (k.h >= f.donHi - f.atr * 0.05 && price >= f.donHi - f.atr * 0.1 && strong(k, 1, 0.68) && body(k) >= range(k) * 0.5) add('donchianBreakout', 1, 1.15, `${f.tf} 20-candle channel breakout up`, f.tf);
    if (k.l <= f.donLo + f.atr * 0.05 && price <= f.donLo + f.atr * 0.1 && strong(k, -1, 0.68) && body(k) >= range(k) * 0.5) add('donchianBreakout', -1, 1.15, `${f.tf} 20-candle channel breakdown`, f.tf);
  }
  for (const f of on('insideBarBreak')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || range(pk) >= f.atr * 0.8 || range(pk) < f.atr * 0.15) continue;
    if (price > pk.h && k.c > k.o) add('insideBarBreak', 1, 0.8, `${f.tf} inside-bar breakout up`, f.tf);
    if (price < pk.l && k.c < k.o) add('insideBarBreak', -1, 0.8, `${f.tf} inside-bar breakout down`, f.tf);
  }
  for (const f of on('liquiditySweep')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk) continue;
    const v = f.atr;
    if (k.l < pk.l - v * 0.08 && price > pk.l + v * 0.05 && closeLoc(k) > 0.6 && lowerWick(k) > range(k) * 0.35)
      add('liquiditySweep', 1, 1.35, `${f.tf} failed breakdown — prior low swept and reclaimed`, f.tf);
    if (k.h > pk.h + v * 0.08 && price < pk.h - v * 0.05 && closeLoc(k) < 0.4 && upperWick(k) > range(k) * 0.35)
      add('liquiditySweep', -1, 1.35, `${f.tf} failed breakout — prior high swept and rejected`, f.tf);
  }
  for (const f of on('retestHold')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk) continue;
    for (const [level, name] of react) {
      if (pk.o < level && pk.c > level + atr * 0.05 && k.l <= level + atr * 0.12 && k.l >= level - atr * 0.15 && price > level + atr * 0.05 && closeLoc(k) > 0.6)
        add('retestHold', 1, 1.15, `broken ${name} holds as support`, f.tf);
      if (pk.o > level && pk.c < level - atr * 0.05 && k.h >= level - atr * 0.12 && k.h <= level + atr * 0.15 && price < level - atr * 0.05 && closeLoc(k) < 0.4)
        add('retestHold', -1, 1.15, `broken ${name} holds as resistance`, f.tf);
    }
  }
  for (const f of on('equalLevels')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk) continue;
    const tol = f.atr * 0.12;
    if (Math.abs(k.l - pk.l) <= tol && strong(k, 1, 0.65)) add('equalLevels', 1, 0.9, `${f.tf} double bottom held`, f.tf);
    if (Math.abs(k.h - pk.h) <= tol && strong(k, -1, 0.65)) add('equalLevels', -1, 0.9, `${f.tf} double top held`, f.tf);
  }
  if (c5 && p15 && c15 && range(c5) > F['5m'].atr * 0.5) {
    if (c5.l > p15.h && closeLoc(c5) > 0.6 && c15.c > c15.o) add('displacement', 1, 1.1, 'bullish displacement: unfilled gap above the prior 15m candle');
    if (c5.h < p15.l && closeLoc(c5) < 0.4 && c15.c < c15.o) add('displacement', -1, 1.1, 'bearish displacement: unfilled gap below the prior 15m candle');
  }
  {
    const pairs = (['5m', '15m', '1h'] as const).map((t) => [F[t].cur, F[t].prev] as const).filter(([a, b]) => a && b) as Array<readonly [Candle, Candle]>;
    if (pairs.length >= 2) {
      if (pairs.every(([k, pk]) => k.h > pk.h && k.l > pk.l && k.c > pk.c)) add('structureAlign', 1, 1, `higher highs and higher lows on ${pairs.length} charts`);
      if (pairs.every(([k, pk]) => k.h < pk.h && k.l < pk.l && k.c < pk.c)) add('structureAlign', -1, 1, `lower highs and lower lows on ${pairs.length} charts`);
    }
  }
  if (p60 && c5) {
    if (price > p60.h + atr * 0.05 && price - p60.h < atr * 0.8 && strong(c5, 1, 0.65)) add('h1LevelBreak', 1, 1.1, 'prior 1h high broken with a strong 5m close');
    if (price < p60.l - atr * 0.05 && p60.l - price < atr * 0.8 && strong(c5, -1, 0.65)) add('h1LevelBreak', -1, 1.1, 'prior 1h low broken with a strong 5m close');
  }

  // ================= Levels =================
  {
    const lowTouch = Math.min(c5?.l ?? price, p5?.l ?? price);
    const highTouch = Math.max(c5?.h ?? price, p5?.h ?? price);
    const cluster = (lvl: number) => new Set(react.filter(([l]) => Math.abs(l - lvl) <= atr * 0.25).map(([, n]) => n)).size;
    const zoneTag = (n: number) => (n >= 2 ? ` (confluence zone of ${n} levels)` : '');
    const bullish5 = (c5 && closeLoc(c5) > 0.6) || (read.bullPat5 ?? 0) > 0;
    const bearish5 = (c5 && closeLoc(c5) < 0.4) || (read.bearPat5 ?? 0) > 0;
    const sup = react.filter(([l]) => lowTouch <= l + atr * 0.15 && price > l && price - l < atr * 0.6).sort((a, b) => b[0] - a[0])[0];
    if (sup && bullish5) { const n = cluster(sup[0]); add('support', 1, 1.2 + Math.min(0.45, (n - 1) * 0.15), `bounce off ${sup[1]} support${zoneTag(n)}`); }
    const res = react.filter(([l]) => highTouch >= l - atr * 0.15 && price < l && l - price < atr * 0.6).sort((a, b) => a[0] - b[0])[0];
    if (res && bearish5) { const n = cluster(res[0]); add('resistance', -1, 1.2 + Math.min(0.45, (n - 1) * 0.15), `rejection at ${res[1]} resistance${zoneTag(n)}`); }
  }
  for (const f of on('vwapReclaim')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || !ok(f.vwap)) continue;
    if (pk.c < f.vwap && price > f.vwap && k.c > k.o) add('vwapReclaim', 1, 0.9, `${f.tf} price reclaimed VWAP`, f.tf);
    if (pk.c > f.vwap && price < f.vwap && k.c < k.o) add('vwapReclaim', -1, 0.9, `${f.tf} price lost VWAP`, f.tf);
  }
  if (ok(read.vwap15) && c5) {
    const dist = (price - read.vwap15) / atr;
    if (dist > 2.2 && strong(c5, -1, 0.65)) add('vwapStretch', -1, 0.85, `stretched ${dist.toFixed(1)} ATR above VWAP and turning down`, '15m');
    if (dist < -2.2 && strong(c5, 1, 0.65)) add('vwapStretch', 1, 0.85, `stretched ${(-dist).toFixed(1)} ATR below VWAP and turning up`, '15m');
  }
  if (c5 && ok(read.donHi60) && ok(read.donLo60) && read.donHi60 - read.donLo60 > atr) {
    const pos = (price - read.donLo60) / (read.donHi60 - read.donLo60);
    if (pos <= 0.25 && strong(c5, 1, 0.6)) add('premiumDiscount', 1, 0.9, 'bullish reaction in the 1h discount zone');
    if (pos >= 0.75 && strong(c5, -1, 0.6)) add('premiumDiscount', -1, 0.9, 'bearish reaction in the 1h premium zone');
  }
  for (const f of on('rangeEdgeFade')) {
    const k = f.cur;
    if (!k || !ok(f.donHi) || !ok(f.donLo) || (F['15m'].adx ?? 30) >= 20) continue;
    const span = f.donHi - f.donLo;
    if (span < f.atr * 2) continue;
    const pos = (price - f.donLo) / span;
    if (pos <= 0.15 && lowerWick(k) >= range(k) * 0.4 && closeLoc(k) >= 0.6) add('rangeEdgeFade', 1, 0.9, `${f.tf} quiet range low rejected`, f.tf);
    if (pos >= 0.85 && upperWick(k) >= range(k) * 0.4 && closeLoc(k) <= 0.4) add('rangeEdgeFade', -1, 0.9, `${f.tf} quiet range high rejected`, f.tf);
  }

  // ================= Candles =================
  for (const f of on('engulfing')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || range(k) < f.atr * 0.35) continue;
    if (k.c > k.o && pk.c < pk.o && k.c >= pk.o && k.o <= pk.c && body(k) > body(pk)) add('engulfing', 1, 1, `${f.tf} bullish engulfing`, f.tf);
    if (k.c < k.o && pk.c > pk.o && k.c <= pk.o && k.o >= pk.c && body(k) > body(pk)) add('engulfing', -1, 1, `${f.tf} bearish engulfing`, f.tf);
  }
  const atZone = (f: Frame, d: number, k: Candle) => [
    ok(f.bbLo) && ok(f.bbUp) && (d > 0 ? k.l <= f.bbLo + f.atr * 0.15 : k.h >= f.bbUp - f.atr * 0.15),
    ok(f.ema50) && Math.abs((d > 0 ? k.l : k.h) - f.ema50) <= f.atr * 0.15,
    ok(f.rsi) && (d > 0 ? f.rsi < 42 : f.rsi > 58),
    react.some(([l]) => Math.abs((d > 0 ? k.l : k.h) - l) <= atr * 0.15),
  ].filter(Boolean).length;
  for (const f of on('pinBar')) {
    const k = f.cur;
    if (!k || range(k) < f.atr * 0.4) continue;
    if (lowerWick(k) > body(k) * 2 && lowerWick(k) > range(k) * 0.55 && closeLoc(k) > 0.6 && atZone(f, 1, k) >= 1) add('pinBar', 1, 1, `${f.tf} bullish pin bar at a turn zone`, f.tf);
    if (upperWick(k) > body(k) * 2 && upperWick(k) > range(k) * 0.55 && closeLoc(k) < 0.4 && atZone(f, -1, k) >= 1) add('pinBar', -1, 1, `${f.tf} bearish pin bar at a turn zone`, f.tf);
  }
  for (const f of on('candlePatterns')) {
    const net = (f.bull ?? 0) - (f.bear ?? 0);
    if (net >= 1 && (!f.cur || f.cur.c >= f.cur.o)) add('candlePatterns', 1, 0.7 + Math.min(0.3, (net - 1) * 0.15), `${f.tf} bullish candle pattern`, f.tf);
    if (net <= -1 && (!f.cur || f.cur.c <= f.cur.o)) add('candlePatterns', -1, 0.7 + Math.min(0.3, (-net - 1) * 0.15), `${f.tf} bearish candle pattern`, f.tf);
  }
  {
    const ks = [c1, c5, c15, c60].filter(Boolean) as Candle[];
    if (ks.length >= 3) {
      if (ks.every((k) => strong(k, 1, 0.6))) add('candleAlign', 1, 1, `${ks.length} charts' candles all bullish`);
      if (ks.every((k) => strong(k, -1, 0.6))) add('candleAlign', -1, 1, `${ks.length} charts' candles all bearish`);
    }
  }
  for (const f of on('vReversal')) {
    const pk = f.prev, k = f.cur;
    if (!pk || !k || range(pk) < f.atr * 1.2 || body(pk) < range(pk) * 0.6) continue;
    const down = pk.c < pk.o;
    if (down ? k.c <= k.o : k.c >= k.o) continue;
    const recovered = (down ? k.c - pk.c : pk.c - k.c) / body(pk);
    if (recovered >= 0.6 && (down ? closeLoc(k) > 0.7 : closeLoc(k) < 0.3))
      add('vReversal', down ? 1 : -1, (f.tf === '5m' ? 1.05 : 1.1) + (recovered >= 1 ? 0.2 : 0), `${f.tf} V-shaped reversal: ${Math.min(100, Math.round(recovered * 100))}% of the ${down ? 'drop' : 'rally'} taken back`, f.tf);
  }

  // ================= Volatility =================
  for (const f of on('squeezeFire')) {
    const k = f.cur;
    if (!k || !ok(f.kcUp) || !ok(f.kcLo) || !ok(f.bbUp) || !ok(f.bbLo) || body(k) < range(k) * 0.55) continue;
    const width = (f.bbUp - f.bbLo) / f.atr;
    if (width >= 3.4) continue;
    const momo = has(f.ao) ? f.ao : has(f.mom) ? f.mom : has(f.macd) && has(f.macdSig) ? f.macd - f.macdSig : 0;
    if (price > f.kcUp && k.c > k.o && momo > 0) add('squeezeFire', 1, 1.15, `${f.tf} volatility squeeze firing upward`, f.tf);
    if (price < f.kcLo && k.c < k.o && momo < 0) add('squeezeFire', -1, 1.15, `${f.tf} volatility squeeze firing downward`, f.tf);
  }
  for (const f of on('bandWalk')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || !ok(f.bbUp) || !ok(f.bbLo) || (f.adx ?? 0) < 28 || !ok(f.rsi)) continue;
    if (price > f.bbUp && strong(k, 1) && k.h > pk.h && k.l > pk.l && f.rsi < 80) add('bandWalk', 1, 0.95, `${f.tf} strong uptrend riding the upper band`, f.tf);
    if (price < f.bbLo && strong(k, -1) && k.h < pk.h && k.l < pk.l && f.rsi > 20) add('bandWalk', -1, 0.95, `${f.tf} strong downtrend riding the lower band`, f.tf);
  }
  for (const f of on('bandReversion')) {
    const k = f.cur, pk = f.prev ?? f.cur;
    if (!k || !pk || !ok(f.bbUp) || !ok(f.bbLo)) continue;
    if (pk.l < f.bbLo && price > f.bbLo && strong(k, 1, 0.6) && (f.adx ?? 20) < 30) add('bandReversion', 1, 0.85, `${f.tf} snapped back inside the lower band`, f.tf);
    if (pk.h > f.bbUp && price < f.bbUp && strong(k, -1, 0.6) && (f.adx ?? 20) < 30) add('bandReversion', -1, 0.85, `${f.tf} snapped back inside the upper band`, f.tf);
  }
  if (ok(read.atr1) && ok(read.atr5) && c5) {
    const fast = (read.atr1 * Math.sqrt(5)) / read.atr5, mid = ok(read.atr15) ? (read.atr5 * Math.sqrt(3)) / read.atr15 : 1;
    const d = cdir(c5);
    const momo = has(read.mom1) ? read.mom1 * d > 0 : ok(read.ema20_1) ? (price - read.ema20_1) * d > 0 : false;
    if (fast >= 1.35 && mid >= 1.1 && mid < 2 && strong(c5, d, 0.65) && momo) add('atrExpansion', d, 0.85, `volatility expanding ${word(d)} (${fast.toFixed(1)}x on the fast charts)`);
  }
  for (const f of on('volatilityClimax')) {
    const pk = f.prev, k = f.cur;
    const min = f.tf === '15m' ? 1.8 : 2.5;
    if (!pk || !k || range(pk) < f.atr * min || body(pk) < range(pk) * 0.6) continue;
    const d: 1 | -1 = pk.c > pk.o ? 1 : -1;
    const stretched = (ok(f.rsiPrev) && (d > 0 ? f.rsiPrev >= 68 : f.rsiPrev <= 32)) || (ok(f.bbUp) && ok(f.bbLo) && (d > 0 ? pk.h > f.bbUp : pk.l < f.bbLo));
    const givenBack = ((pk.c - price) * d) / body(pk);
    if (!stretched || givenBack < 0.35 || (k.c - k.o) * d >= 0 || (d > 0 ? closeLoc(k) > 0.4 : closeLoc(k) < 0.6)) continue;
    add('volatilityClimax', -d as 1 | -1, 1.1 + (givenBack >= 0.6 ? 0.15 : 0), `${f.tf} volatility climax: ${(range(pk) / f.atr).toFixed(1)}x ATR ${d > 0 ? 'rally' : 'drop'} exhausted`, f.tf);
  }
  for (const f of on('quietBreakout')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || range(pk) > f.atr * 0.7 || range(k) < Math.max(range(pk) * 1.6, f.atr * 0.9) || body(k) < range(k) * 0.6) continue;
    const d = cdir(k);
    const through = d > 0 ? price > pk.h && closeLoc(k) >= 0.7 : price < pk.l && closeLoc(k) <= 0.3;
    if (through && range(k) < f.atr * 2.2) add('quietBreakout', d, 1.05, `${f.tf} quiet candle followed by a ${(range(k) / f.atr).toFixed(1)}x ATR expansion ${word(d)}`, f.tf);
  }
  {
    let ratio: number | undefined;
    if (ok(read.rvol15) && read.rvol15 > 0.05 && read.rvol15 < 20) ratio = read.rvol15;
    else if (ok(read.vol15) && ok(read.volPrev15)) ratio = Math.min(10, read.vol15 / read.volPrev15);
    if (ratio !== undefined && ratio >= 1.5 && c15 && body(c15) > range(c15) * 0.6 && range(c15) > atr * 0.5)
      add('volumeThrust', cdir(c15), Math.min(1.2, 0.6 + (ratio - 1.5) * 0.3), `${c15.c > c15.o ? 'bullish' : 'bearish'} candle on ${ratio.toFixed(1)}x volume`, '15m');
  }

  // ================= Turns, spikes and anti-whipsaw =================
  let spike: SpikeRead | undefined;
  const up15 = trend15 === 0 ? null : trend15 > 0;
  const trendWord = (d: 1 | -1) => (up15 === null ? '' : (d > 0) !== up15 ? ` against the 15m ${up15 ? 'uptrend' : 'downtrend'}` : ' with the 15m trend');
  const spikeOf = (k: Candle | null, norm: number, tf: '1m' | '5m', w: number) => {
    if (!k || !ok(norm) || range(k) < norm * 2.2) return;
    const size = Math.round((range(k) / norm) * 10) / 10;
    const extra = Math.min(0.4, (size - 2.2) * 0.15);
    let found: SpikeRead | undefined;
    if (body(k) >= range(k) * 0.6 && (closeLoc(k) >= 0.75 || closeLoc(k) <= 0.25)) {
      const d: 1 | -1 = k.c > k.o ? 1 : -1;
      hits.push({ name: 'spikeMomentum', dir: d, weight: Math.round((w + extra) * 100) / 100, label: `${tf} ${word(d)} spike ${size}x normal size, closing at its ${d > 0 ? 'high' : 'low'}${trendWord(d)}`, ...(tf === '1m' ? { tf } : {}) });
      found = { dir: d, kind: 'momentum', size, timeframe: tf };
    } else if (upperWick(k) >= range(k) * 0.55 && closeLoc(k) <= 0.4) {
      hits.push({ name: 'spikeRejection', dir: -1, weight: Math.round((w + 0.15 + extra) * 100) / 100, label: `${tf} spike up ${size}x normal size rejected — long upper wick${trendWord(-1)}`, ...(tf === '1m' ? { tf } : {}) });
      found = { dir: -1, kind: 'rejection', size, timeframe: tf };
    } else if (lowerWick(k) >= range(k) * 0.55 && closeLoc(k) >= 0.6) {
      hits.push({ name: 'spikeRejection', dir: 1, weight: Math.round((w + 0.15 + extra) * 100) / 100, label: `${tf} spike down ${size}x normal size rejected — long lower wick${trendWord(1)}`, ...(tf === '1m' ? { tf } : {}) });
      found = { dir: 1, kind: 'rejection', size, timeframe: tf };
    }
    if (found && (!spike || (found.timeframe === '5m' && spike.timeframe === '1m') || found.size > spike.size)) spike = found;
  };
  spikeOf(c1, F['1m'].atr, '1m', 0.75);
  spikeOf(c5, F['5m'].atr, '5m', 1.05);

  // Direction change: the 15m trend still points one way, but the 5m candle broke the prior 5m
  // extreme the other way and most fast momentum readings have flipped with it.
  if (up15 !== null && c5 && p5 && range(c5) > F['5m'].atr * 0.3) {
    const flips = (d: 1 | -1) => [
      has(read.macd5) && has(read.macdSig5) && (read.macd5 - read.macdSig5) * d > 0,
      ok(read.rsi5) && (d > 0 ? read.rsi5 > 52 : read.rsi5 < 48),
      ok(read.ema20_15) && (price - read.ema20_15) * d > 0,
      has(read.mom1) && read.mom1 * d > 0,
      ok(read.ema20_1) && (price - read.ema20_1) * d > 0,
      has(read.ao5) && has(read.aoPrev5) && (read.ao5 - read.aoPrev5) * d > 0,
      ok(read.rsi5) && ok(read.rsiPrev5) && (read.rsi5 - read.rsiPrev5) * d > 3,
    ].filter(Boolean).length;
    if (up15 && price < p5.l && c5.c < c5.o && closeLoc(c5) < 0.35) {
      const n = flips(-1);
      if (n >= 4) add('directionChange', -1, 1 + Math.min(0.45, (n - 4) * 0.15), `direction change: 15m uptrend turning down (${n} of 7 turn signals, prior 5m low broken)`);
    }
    if (!up15 && price > p5.h && c5.c > c5.o && closeLoc(c5) > 0.65) {
      const n = flips(1);
      if (n >= 4) add('directionChange', 1, 1 + Math.min(0.45, (n - 4) * 0.15), `direction change: 15m downtrend turning up (${n} of 7 turn signals, prior 5m high broken)`);
    }
  }

  // Anti-whipsaw: tell a pullback inside a trend from a real reversal.
  const turnedAgainst = (d: number) => hits.some((h) => h.dir === -d && h.tf !== '1m'
    && (h.name === 'directionChange' || h.name === 'changeOfCharacter' || h.name === 'breakOfStructure' || h.name === 'vReversal'));
  let fastNoise = false;
  if (trend15 !== 0 && c5 && p5) {
    const d = trend15;
    const w = d > 0 ? 'uptrend' : 'downtrend';
    const aboveValue = ok(read.ema50_15) && (price - read.ema50_15) * d > 0;
    const structureIntact = d > 0 ? price > p5.l : price < p5.h;
    const fastAgainst = (has(read.mom1) && read.mom1 * d < 0) || (ok(read.ema20_1) && (price - read.ema20_1) * d < 0) || (c5.c - c5.o) * d < 0;
    if (aboveValue && structureIntact && fastAgainst && !turnedAgainst(d) && (read.adx15 ?? 0) >= 18)
      add('trendPullbackHold', d, 0.9, `pullback inside the intact 15m ${w} — not a reversal`);
    if ((p5.c - p5.o) * d < 0 && body(p5) >= range(p5) * 0.4 && (price - p5.o) * d > 0 && (d > 0 ? closeLoc(c5) > 0.65 : closeLoc(c5) < 0.35))
      add('failedTurn', d, 1.0, `counter-move failed — the ${w} resumed`, '5m');
    const oneMinAgainst = (has(read.rating1) && read.rating1 * d < 0) || (has(read.mom1) && read.mom1 * d < 0);
    const fiveWith = (has(read.rating5) && read.rating5 * d > 0) || (ok(read.ema20_5) && (price - read.ema20_5) * d > 0);
    const normalSize = !c1 || range(c1) < F['1m'].atr * 1.5;
    fastNoise = oneMinAgainst && fiveWith && normalSize && structureIntact && !turnedAgainst(d);
  }
  if (trend15 !== 0 && c15 && p15 && ok(read.ema20_15) && ok(read.rsi15)) {
    const d = -trend15 as 1 | -1;
    if ((p15.c - p15.o) * d > 0 && (price - p15.c) * d > 0 && (d > 0 ? price > p15.h : price < p15.l)
      && (price - read.ema20_15) * d > 0 && (d > 0 ? read.rsi15 > 50 : read.rsi15 < 50))
      add('confirmedReversal', d, 1.3, `confirmed 15m reversal ${word(d)}: two candles closing through the EMA20 and the prior ${d > 0 ? 'high' : 'low'}`);
  }
  for (const f of on('divergence')) {
    const k = f.cur, pk = f.prev;
    if (!k || !pk || !ok(f.rsi) || !ok(f.rsiPrev)) continue;
    const macdOk = (d: number) => !has(f.macd) || !has(f.macdPrev) || (f.macd - f.macdPrev) * d > 0;
    if (k.h > pk.h && f.rsi < f.rsiPrev - 2 && f.rsiPrev >= 62 && macdOk(-1) && closeLoc(k) < 0.45) add('divergence', -1, 0.9, `${f.tf} bearish divergence: new high without RSI`, f.tf);
    if (k.l < pk.l && f.rsi > f.rsiPrev + 2 && f.rsiPrev <= 38 && macdOk(1) && closeLoc(k) > 0.55) add('divergence', 1, 0.9, `${f.tf} bullish divergence: new low without RSI`, f.tf);
  }
  for (const f of on('oscillatorTurn')) {
    const k = f.cur;
    if (!k) continue;
    const is15 = f.tf === '15m';
    const oversold = [ok(f.rsi) && f.rsi < 32, has(f.cci) && f.cci < -120, ok(f.k) && f.k < 15,
      is15 && has(read.wr15) && read.wr15 < -85, is15 && ok(read.stochRsi15) && read.stochRsi15 < 10, is15 && ok(read.uo15) && read.uo15 < 32,
      !is15 && has(read.wr5) && read.wr5 < -85].filter(Boolean).length;
    const overbought = [ok(f.rsi) && f.rsi > 68, has(f.cci) && f.cci > 120, ok(f.k) && f.k > 85,
      is15 && has(read.wr15) && read.wr15 > -15, is15 && ok(read.stochRsi15) && read.stochRsi15 > 90, is15 && ok(read.uo15) && read.uo15 > 68,
      !is15 && has(read.wr5) && read.wr5 > -15].filter(Boolean).length;
    if (oversold >= 3 && strong(k, 1, 0.6)) add('oscillatorTurn', 1, 0.9 + oversold * 0.08, `${f.tf} oversold on ${oversold} oscillators with a turning candle`, f.tf);
    if (overbought >= 3 && strong(k, -1, 0.6)) add('oscillatorTurn', -1, 0.9 + overbought * 0.08, `${f.tf} overbought on ${overbought} oscillators with a turning candle`, f.tf);
  }

  return { hits, spike, fastNoise };
}
