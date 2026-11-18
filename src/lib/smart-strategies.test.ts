import { describe, expect, it } from 'vitest';
import { SCAN_TIMEFRAMES, STRATEGY_BOOK, STRATEGY_NAMES } from './smart-strategies';
import { scanStrategies } from './strategy-scan';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { volatilityProfile } from './volatility-strategy';
import type { SwingRead } from './smart-signal-policy';

const base: SwingRead = {
  price: 100, atr15: 1, atr5: 0.5, atr1: 0.25, atr60: 2,
  rating1: 0.4, rating5: 0.4, rating15: 0.4, rating60: 0.3, rating240: 0,
  ma15: 0.4, rsi15: 58, adx15: 28, ema50_15: 99, ema200_60: 95,
  macd15: 0.1, macdSig15: 0.05, mom1: 0.05,
};
const hit = (read: SwingRead, name: string, dir: number) => scanStrategies(read).hits.some(h => h.name === name && h.dir === dir);

describe('smart strategy book', () => {
  it('has at least 50 strategies', () => {
    expect(STRATEGY_NAMES.length).toBeGreaterThanOrEqual(50);
  });
  it('scans only the 1m, 5m and 15m charts', () => {
    expect([...SCAN_TIMEFRAMES]).toEqual(['1m', '5m', '15m']);
  });
  it('includes at least 15 EMA strategies', () => {
    expect(Object.values(STRATEGY_BOOK).filter(i => i.family === 'ema').length).toBeGreaterThanOrEqual(15);
  });
  it('never lets 4h readings change the robot decision', () => {
    const a = analyzeBuiltinAuto(base);
    const b = analyzeBuiltinAuto({ ...base, rating240: -1, ema50_240: 120, ema20_240: 121, ema200_240: 130, atr240: 9, rsi240: 20, adx240: 60, donHi240: 100.2, donLo240: 99.8 });
    expect(b).toEqual(a);
  });
});

describe('EMA strategies', () => {
  it('sees a fully stacked bullish EMA ribbon', () => {
    const read = { ...base, ema9_15: 99.8, ema20_15: 99.6, ema50_15: 99.2, ema100_15: 98.8, ema200_15: 98 };
    expect(hit(read, 'emaRibbon', 1)).toBe(true);
    expect(hit({ ...read, ema100_15: 99.5 }, 'emaRibbon', 1)).toBe(false);
  });
  it('calls a fresh 15m golden cross only on the cross itself, and never reads 1h', () => {
    expect(hit({ ...base, ema50_15: 99.1, ema50Prev15: 98.9, ema200_15: 99 }, 'goldenCross', 1)).toBe(true);
    expect(hit({ ...base, ema50_15: 99.3, ema50Prev15: 99.1, ema200_15: 99 }, 'goldenCross', 1)).toBe(false);
    expect(hit({ ...base, ema50_60: 96.1, ema50Prev60: 95.9, ema200_60: 96 }, 'goldenCross', 1)).toBe(false);
  });
  it('buys a 5m pullback that holds EMA20 in an uptrend', () => {
    const read = { ...base, ema20_5: 99.8, ema50_5: 99.5, open5: 99.85, high5: 100.02, low5: 99.82 };
    expect(hit(read, 'ema20Bounce', 1)).toBe(true);
    expect(hit({ ...read, low5: 99.5 }, 'ema20Bounce', 1)).toBe(false);
  });
  it('needs EMA20 over EMA50 on at least three charts for the multi-chart stack', () => {
    const read = { ...base, ema20_1: 99.95, ema50_1: 99.9, ema20_5: 99.8, ema50_5: 99.5, ema20_15: 99.6, ema20_60: 98, ema50_60: 97 };
    expect(hit(read, 'emaMtfStack', 1)).toBe(true);
    expect(hit({ ...read, ema50_5: 99.9, ema50_60: 98.5 }, 'emaMtfStack', 1)).toBe(false);
  });
});

describe('smarter volatility', () => {
  it('reads 1m/5m volatility far above normal as a climax', () => {
    expect(volatilityProfile({ ...base, atr1: 0.7 }).state).toBe('climax');
  });
  it('reads fast charts running hotter than the 15m as expanding', () => {
    expect(volatilityProfile({ ...base, atr1: 0.4, atr5: 0.8 }).state).toBe('expanding');
  });
  it('reads quiet fast charts as compressing', () => {
    expect(volatilityProfile({ ...base, atr1: 0.15, atr5: 0.35 }).state).toBe('compressing');
  });
  it('gives the stop more room when volatility expands', () => {
    const steady = analyzeBuiltinAuto({ ...base, atr1: 0.25, atr5: 0.55 });
    const fast = analyzeBuiltinAuto({ ...base, atr1: 0.4, atr5: 0.75 });
    expect(steady.side).toBe('BUY');
    expect(fast.side).toBe('BUY');
    expect(fast.entry - fast.stopLoss).toBeGreaterThan(steady.entry - steady.stopLoss);
  });
});
