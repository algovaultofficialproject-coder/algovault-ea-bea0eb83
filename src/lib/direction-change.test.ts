import { describe, expect, it } from 'vitest';
import { scanStrategies } from './strategy-scan';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import type { SwingRead } from './smart-signal-policy';

const base: SwingRead = {
  price: 100, atr15: 1, atr5: 0.5, atr1: 0.1,
  rating1: 0.4, rating5: 0.4, rating15: 0.4, rating60: 0, rating240: 0,
  ma15: 0.4, rsi15: 58, adx15: 28, ema50_15: 99, ema200_60: 95,
  macd15: 0.1, macdSig15: 0.05, mom1: 0.05,
};
const hit = (read: SwingRead, name: string, dir: number) => scanStrategies(read).hits.some(h => h.name === name && h.dir === dir);

describe('direction change and spike detection', () => {
  it('reads a 1m candle at least 2.2x normal size closing at its low as a downward momentum spike', () => {
    const read = { ...base, price: 99.76, open1: 100, high1: 100.01, low1: 99.75 };
    expect(hit(read, 'spikeMomentum', -1)).toBe(true);
    expect(scanStrategies(read).spike).toMatchObject({ dir: -1, kind: 'momentum', timeframe: '1m' });
    // Same shape but only 1.5x normal size is not a spike.
    expect(hit({ ...read, atr1: 0.17 }, 'spikeMomentum', -1)).toBe(false);
  });

  it('reads a spike up that closes back near its low as a rejected spike (sell)', () => {
    const read = { ...base, price: 99.99, open1: 99.97, high1: 100.3, low1: 99.96 };
    expect(hit(read, 'spikeRejection', -1)).toBe(true);
    expect(hit(read, 'spikeMomentum', 1)).toBe(false);
  });

  it('flags a 15m uptrend turning down only when the prior 5m low breaks and 4+ fast signals flip', () => {
    const read: SwingRead = { ...base, price: 99.5, ema20_15: 99.8, ema50_15: 99.2, ema20_1: 99.7, mom1: -0.1,
      macd5: -0.05, macdSig5: 0.02, rsi5: 42, rsiPrev5: 55, open5: 99.95, high5: 100, low5: 99.45,
      prevOpen5: 99.8, prevHigh5: 100.05, prevLow5: 99.75, prevClose5: 99.95 };
    expect(hit(read, 'directionChange', -1)).toBe(true);
    // Prior 5m low not broken: no direction change.
    expect(hit({ ...read, prevLow5: 99.4 }, 'directionChange', -1)).toBe(false);
  });

  it('detects a 5m V-shaped reversal when 60%+ of a strong drop is taken back', () => {
    const read = { ...base, price: 100.5, open5: 99.5, high5: 100.55, low5: 99.45,
      prevOpen5: 100.3, prevHigh5: 100.35, prevLow5: 99.4, prevClose5: 99.5 };
    expect(hit(read, 'vReversal', 1)).toBe(true);
    expect(hit({ ...read, price: 99.8, high5: 99.85 }, 'vReversal', 1)).toBe(false);
  });

  it('detects a 15m RSI cross above 50 with a bullish candle', () => {
    const read = { ...base, rsi15: 53, rsiPrev15: 47, open15: 99.6, high15: 100.05, low15: 99.5 };
    expect(hit(read, 'rsiMidline', 1)).toBe(true);
    expect(hit({ ...read, rsiPrev15: 51 }, 'rsiMidline', 1)).toBe(false);
  });

  it('flips the robot to SELL when a confirmed 5m direction change opposes its bullish read', () => {
    const bullish: SwingRead = { ...base, rating1: 0.5, rating5: 0.5, rating15: 0.5, adx15: 30, diPlus15: 30, diMinus15: 15,
      ema20_15: 99.8, ema50_15: 99.2, rsi15: 60 };
    const turning: SwingRead = { ...bullish, price: 99.5, ema20_1: 99.7, mom1: -0.1, atr1: 0.1,
      open1: 99.75, high1: 99.76, low1: 99.49,
      macd5: -0.05, macdSig5: 0.02, rsi5: 42, rsiPrev5: 55, open5: 99.95, high5: 100, low5: 99.45,
      prevOpen5: 99.8, prevHigh5: 100.05, prevLow5: 99.75, prevClose5: 99.95 };
    const v = analyzeBuiltinAuto(turning);
    expect(v.side).toBe('SELL');
    // Normal mode: the 5m direction change (not the 1m spike) is what allows the flip.
    expect(v.reason).toMatch(/Direction change: 15m uptrend turning down/);
    expect(v.turnConfirmed).toBe(true);
    expect(v.stopLoss).toBeGreaterThan(v.entry);
    expect(v.takeProfit).toBeLessThan(v.entry);
  });
});
