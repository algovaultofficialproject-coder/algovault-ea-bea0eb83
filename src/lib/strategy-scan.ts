import type { SwingRead } from './smart-signal-policy';
import { buildFrames, ok, range, runSmartStrategies, type SpikeRead, type StrategyHit, type StrategyName } from './smart-strategies';

/**
 * Pure strategy scanner: runs the smart strategy library on the 1m, 5m, 15m and 1h charts and
 * collects the levels around price. Every strategy is optional — a missing reading simply skips it.
 * Browser + server safe, no network.
 */
export type { SpikeRead, StrategyHit, StrategyName };
export interface StrategyScan {
  hits: StrategyHit[];
  /** Signed sum of weights: positive favours BUY, negative SELL. */
  net: number;
  /** Key levels below / above price (support / resistance), sorted nearest first. */
  supports: number[];
  resistances: number[];
  /** Recent swing low / high from the latest two 5-minute candles (for stop placement). */
  swingLow?: number;
  swingHigh?: number;
  /** Bollinger bands inside Keltner channels on 15m: volatility is coiling. */
  squeeze?: boolean;
  /** Current 15m volume versus normal (1 = average); undefined when the feed has no usable volume. */
  volumeRatio?: number;
  /** Choppy, directionless 15m market (low ADX and no Aroon leadership). */
  choppy?: boolean;
  /** Largest sudden spike seen on the forming 1m/5m candle, if any. */
  spike?: SpikeRead;
  /** The 1m chart moves against the 5m and 15m trend within its normal size and without a structural turn: noise. */
  fastNoise?: boolean;
}

const RUNNING_HIGHS = new Set(['5m channel high', '15m channel high', '1h channel high', '1m channel high']);
const RUNNING_LOWS = new Set(['5m channel low', '15m channel low', '1h channel low', '1m channel low']);

/** Psychological round-number spacing scaled to the instrument (e.g. 50 pips FX, $50 gold, $500 BTC). */
export function roundStep(atr: number) {
  if (!ok(atr)) return 0;
  return 10 ** Math.round(Math.log10(atr * 10)) / 2;
}

export function scanStrategies(read: SwingRead): StrategyScan {
  const price = read.price;
  const atr = read.atr15 ?? 0;
  const empty: StrategyScan = { hits: [], net: 0, supports: [], resistances: [] };
  const frames = buildFrames(read);
  if (!frames || !ok(price) || !ok(atr)) return empty;
  const c5 = frames['5m'].cur, p5 = frames['5m'].prev, c15 = frames['15m'].cur;

  // ---- Levels from the 1m–1h charts (plus pivots and yesterday's extremes as target obstacles only) ----
  const all: Array<[number | undefined, string]> = [
    [read.donLo5, '5m channel low'], [read.donHi5, '5m channel high'], [read.donLo15, '15m channel low'], [read.donHi15, '15m channel high'],
    [read.donHi60, '1h channel high'], [read.donLo60, '1h channel low'],
    [read.prevHigh60, 'prior 1h high'], [read.prevLow60, 'prior 1h low'],
    [read.bbLo15, 'lower band'], [read.bbUp15, 'upper band'], [read.bbLo60, '1h lower band'], [read.bbUp60, '1h upper band'],
    [read.ema200_15, '15m EMA200'], [read.ema200_60, '1h EMA200'], [read.ema50_60, '1h EMA50'], [read.vwap15, 'VWAP'],
    [read.pivS2, 'S2'], [read.pivS1, 'S1'], [read.pivP, 'pivot'], [read.pivR1, 'R1'], [read.pivR2, 'R2'],
    [read.pdHigh, 'previous day high'], [read.pdLow, 'previous day low'],
  ];
  const lv = all.filter((x): x is [number, string] => ok(x[0]));
  // Running extremes: a channel high or low set by the candle forming right now is price being
  // made, not a prior level ahead. Keep it for reactions, but not as a target obstacle.
  const nowHigh = Math.max(price, ...[c5?.h, c15?.h, read.high1].filter(ok));
  const nowLow = Math.min(price, ...[c5?.l, c15?.l, read.low1].filter(ok));
  const runningHigh = (l: number, name: string) => RUNNING_HIGHS.has(name) && Math.abs(l - nowHigh) <= atr * 0.03;
  const runningLow = (l: number, name: string) => RUNNING_LOWS.has(name) && Math.abs(l - nowLow) <= atr * 0.03;
  const supports = lv.filter(([l, n]) => l < price && !runningLow(l, n)).sort((a, b) => b[0] - a[0]);
  const resistances = lv.filter(([l, n]) => l > price && !runningHigh(l, n)).sort((a, b) => a[0] - b[0]);
  // Reaction-only levels: they attract reactions but are too soft to cap a take profit.
  const step = roundStep(atr);
  const rounds: Array<[number, string]> = step > 0 ? [[Math.floor(price / step) * step, 'round number'], [Math.ceil(price / step) * step, 'round number']] : [];
  const soft = ([[read.ichKijun15, 'Kijun-sen'], [read.ema100_15, '15m EMA100'], [read.ema50_15, '15m EMA50'], [read.vwap5, '5m VWAP']] as Array<[number | undefined, string]>)
    .filter((x): x is [number, string] => ok(x[0]));
  const react = [...lv, ...soft, ...rounds.filter(([l]) => ok(l))];

  const { hits, spike, fastNoise } = runSmartStrategies({ read, price, frames, react });

  // TTM-style squeeze state (Bollinger inside Keltner on 15m).
  const squeeze = ok(read.kcUp15) && ok(read.kcLo15) && ok(read.bbUp15) && ok(read.bbLo15) && read.bbUp15 < read.kcUp15 && read.bbLo15 > read.kcLo15;
  let volumeRatio: number | undefined;
  if (ok(read.rvol15) && read.rvol15 > 0.05 && read.rvol15 < 20) volumeRatio = read.rvol15;
  else if (ok(read.vol15) && ok(read.volPrev15) && read.volPrev15 > 0) volumeRatio = Math.min(10, read.vol15 / read.volPrev15);
  // Chop: no trend strength and no Aroon leadership.
  const aroonKnown = ok(read.aroonUp15) || ok(read.aroonDn15);
  const choppy = ok(read.adx15) && read.adx15 < 16 && (!aroonKnown || ((read.aroonUp15 ?? 0) < 60 && (read.aroonDn15 ?? 0) < 60));

  // Several charts or levels repeating the same strategy are not independent confirmations.
  const strongest = new Map<string, StrategyHit>();
  for (const hit of hits) {
    const key = `${hit.name}:${hit.dir}`;
    const previous = strongest.get(key);
    if (!previous || hit.weight > previous.weight) strongest.set(key, hit);
  }
  const uniqueHits = [...strongest.values()];
  const net = uniqueHits.reduce((a, h) => a + h.dir * h.weight, 0);
  const swing = [c5, p5].filter((k) => k && range(k) > 0);
  const swingLow = swing.length ? Math.min(...swing.map((k) => k!.l)) : undefined;
  const swingHigh = swing.length ? Math.max(...swing.map((k) => k!.h)) : undefined;
  return { hits: uniqueHits, net, supports: supports.map(s => s[0]), resistances: resistances.map(r => r[0]), swingLow, swingHigh, squeeze, volumeRatio, choppy, spike, fastNoise };
}
