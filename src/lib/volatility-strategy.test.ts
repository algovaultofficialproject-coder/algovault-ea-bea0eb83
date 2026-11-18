import { describe, expect, it } from 'vitest';
import { volatilityStrategy } from './volatility-strategy';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import type { SwingRead } from './smart-signal-policy';

const quiet: SwingRead = {
  price: 100, atr15: 1, atr5: 0.3, atr1: 0.1, bbLo15: 99.8, bbUp15: 102.2,
  rating1: 0.5, rating5: 0.5, rating15: 0, rating60: 0, rating240: 0, ma15: 0,
  rsi15: 50, adx15: 15, ema50_15: 98, ema200_60: 95, macd15: 0, macdSig15: 0,
};
const fast: SwingRead = {
  ...quiet, atr5: 1, bbLo15: undefined, bbUp15: undefined, adx15: 28,
  rating15: 0.5, rsi15: 58, ema50_15: 99, ema20_5: 99.8,
  open5: 99.7, low5: 99.5, high5: 100.1,
};
const scores = { m15: 0.5, m5: 0.5, m1: 0.5 };

describe('high and low volatility adaptive scanning', () => {
  it('finds a supported BUY in low volatility that previously lacked normal-style room', () => {
    expect(volatilityStrategy(quiet, scores).setup).toBe('quietRange');
    const result = analyzeBuiltinAuto(quiet);
    expect(result.side).toBe('BUY');
    expect(result.takeProfit).toBeLessThan(quiet.bbUp15 ?? 0);
    expect(result.entry - result.stopLoss).toBeCloseTo(0.825);
  });
  it('finds a supported SELL at a quiet range upper edge', () => {
    const read = { ...quiet, bbLo15: 97.8, bbUp15: 100.2, ema50_15: 102, rating1: -0.5, rating5: -0.5 };
    expect(volatilityStrategy(read, { m15: 0, m5: -0.5, m1: -0.5 }).dir).toBe(-1);
    expect(analyzeBuiltinAuto(read).side).toBe('SELL');
  });
  it('does not invent a quiet-range setup in the centre', () => {
    expect(volatilityStrategy({ ...quiet, bbLo15: 99, bbUp15: 101 }, scores).setup).toBeUndefined();
  });
  it('requires both fast charts to turn before adapting a quiet-range entry', () => {
    expect(volatilityStrategy(quiet, { ...scores, m5: -0.1 }).setup).toBeUndefined();
    expect(volatilityStrategy(quiet, { ...scores, m1: 0 }).setup).toBeUndefined();
  });
  it('finds a high-volatility retest and widens protected risk distances', () => {
    expect(volatilityStrategy(fast, scores).setup).toBe('volatilePullback');
    const result = analyzeBuiltinAuto(fast);
    expect(result.side).toBe('BUY');
    expect(result.entry - result.stopLoss).toBeGreaterThan(1.3);
    expect((result.takeProfit - result.entry) / (result.entry - result.stopLoss)).toBeGreaterThanOrEqual(1);
  });
  it('requires an observed retest instead of chasing a fast move', () => {
    expect(volatilityStrategy({ ...fast, low5: 99.9, open5: 99.95 }, scores).setup).toBeUndefined();
  });
  it('does not adapt a high-volatility retest during a one-minute shock', () => {
    expect(volatilityStrategy({ ...fast, high1: 100.5, low1: 99.2 }, scores).setup).toBeUndefined();
  });
  it('does not make missing optional volatility data a mandatory WAIT', () => {
    const read = { ...fast, atr5: undefined };
    expect(volatilityStrategy(read, scores).regime).toBe('normal');
    expect(analyzeBuiltinAuto(read).side).toBe('BUY');
  });
  it('still waits for missing core volatility', () => {
    expect(analyzeBuiltinAuto({ ...fast, atr15: 0 }).side).toBe('WAIT');
  });
  it('never adapts through a nearby obstacle: it falls back to a compact protected target', () => {
    for (const read of [quiet, fast]) {
      const result = analyzeBuiltinAuto({ ...read, pivR1: 100.2 });
      expect(result.reason).not.toMatch(/adaptive/);
      expect(result.reason).toMatch(/tight room — compact target/);
      expect(result.entry - result.stopLoss).toBeCloseTo(1.1); // full normal-style stop, not the adaptive one
    }
  });
  it('keeps the stop beyond observed protective structure when fitting reward', () => {
    const result = analyzeBuiltinAuto({ ...fast, low5: 98.5, pivR1: 101.9 });
    expect(result.side).toBe('BUY');
    expect(result.stopLoss).toBeLessThan(98.5);
    expect((result.takeProfit - result.entry) / (result.entry - result.stopLoss)).toBeGreaterThanOrEqual(1);
  });
  it('scales supported risk with instrument prices without a fixed pip threshold', () => {
    const scaled = Object.fromEntries(Object.entries(fast).map(([key, value]) => [key,
      typeof value === 'number' && /^(price|atr|ema|open|high|low)/.test(key) ? value * 10 : value])) as SwingRead;
    const original = analyzeBuiltinAuto(fast), result = analyzeBuiltinAuto(scaled);
    expect(result.side).toBe(original.side);
    expect(result.stopLoss).toBeCloseTo(original.stopLoss * 10);
    expect(result.takeProfit).toBeCloseTo(original.takeProfit * 10);
  });
});