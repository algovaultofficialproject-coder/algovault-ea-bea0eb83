import { describe, expect, it } from 'vitest';
import { scanStrategies } from './strategy-scan';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { stabilizeDirection } from './trade-style';
import type { SwingRead } from './smart-signal-policy';

// A clear 15m uptrend with the 5m chart still bullish.
const uptrend: SwingRead = {
  price: 100.3, atr15: 1, atr5: 0.5, atr1: 0.1,
  rating1: 0.4, rating5: 0.5, rating15: 0.6, rating60: 0.4, rating240: 0.3,
  ma15: 0.5, rsi15: 60, adx15: 30, diPlus15: 30, diMinus15: 14, ema20_15: 99.9, ema50_15: 99.3, ema200_60: 95,
  macd15: 0.2, macdSig15: 0.1, ema20_5: 100.1, ema50_5: 99.9, rsi5: 58,
  open5: 100.2, high5: 100.4, low5: 100.1, prevOpen5: 99.95, prevHigh5: 100.25, prevLow5: 99.9, prevClose5: 100.2,
};
// The same market a few minutes later: only the 1m chart dips (a normal-size red 1m candle).
const oneMinDip: SwingRead = { ...uptrend, price: 100.22, rating1: -0.6, mom1: -0.08, ema20_1: 100.28, rsi1: 38,
  stochK1: 20, stochD1: 35, open1: 100.3, high1: 100.31, low1: 100.21, open5: 100.25, high5: 100.4, low5: 100.15 };
const has = (read: SwingRead, name: string, dir: number) => scanStrategies(read).hits.some(h => h.name === name && h.dir === dir);

describe('anti-whipsaw: pullbacks are not reversals', () => {
  it('reads a 1m dip inside an intact 15m uptrend as a pullback hold and 1m noise', () => {
    const scan = scanStrategies(oneMinDip);
    expect(has(oneMinDip, 'trendPullbackHold', 1)).toBe(true);
    expect(scan.fastNoise).toBe(true);
  });

  it('keeps BUY in normal mode when only the 1m chart turns down', () => {
    const v = analyzeBuiltinAuto(oneMinDip, undefined, 'normal');
    expect(v.side).toBe('BUY');
    expect(v.trendSide).toBe('BUY');
  });

  it('marks 1m spikes so normal mode cannot flip on them', () => {
    const read = { ...uptrend, price: 100.04, open1: 100.3, high1: 100.31, low1: 100.03 };
    const spike = scanStrategies(read).hits.find(h => h.name === 'spikeMomentum');
    expect(spike?.tf).toBe('1m');
  });

  it('detects a failed counter-move when the 5m candle takes back the previous red candle', () => {
    const read = { ...uptrend, price: 100.3, prevOpen5: 100.2, prevHigh5: 100.22, prevLow5: 99.95, prevClose5: 100.0,
      open5: 100.0, high5: 100.32, low5: 99.98 };
    expect(has(read, 'failedTurn', 1)).toBe(true);
    expect(has({ ...read, price: 100.15, high5: 100.16 }, 'failedTurn', 1)).toBe(false);
  });

  it('confirms a 15m reversal only after two candles close down through the EMA20 and the prior low', () => {
    const read = { ...uptrend, price: 99.6, rsi15: 45, open15: 99.95, high15: 100, low15: 99.55,
      prevOpen15: 100.4, prevHigh15: 100.45, prevLow15: 99.9, prevClose15: 99.95 };
    expect(has(read, 'confirmedReversal', -1)).toBe(true);
    // Still above the prior 15m low: not confirmed.
    expect(has({ ...read, price: 99.92, low15: 99.91 }, 'confirmedReversal', -1)).toBe(false);
  });
});

describe('direction hold over time', () => {
  it('normal mode needs the opposite side for 3 minutes and 4 scans before flipping', () => {
    let m = { side: 'SELL' as const, confidence: 70 };
    let mem: Parameters<typeof stabilizeDirection>[0] = m;
    for (const t of [0, 15_000, 30_000, 45_000, 60_000]) {
      const r = stabilizeDirection(mem, 'BUY', 75, 'normal', t, { turnConfirmed: true });
      expect(r.accept).toBe(false);
      mem = r.memory;
    }
    for (let t = 75_000; t < 180_000; t += 15_000) mem = stabilizeDirection(mem, 'BUY', 75, 'normal', t, { turnConfirmed: true }).memory;
    expect(stabilizeDirection(mem, 'BUY', 75, 'normal', 180_000, { turnConfirmed: true }).accept).toBe(true);
    void m;
  });

  it('normal mode never flips against the slower trend without a confirmed turn', () => {
    let mem: Parameters<typeof stabilizeDirection>[0] = { side: 'BUY', confidence: 72 };
    for (let t = 0; t <= 600_000; t += 15_000) {
      const r = stabilizeDirection(mem, 'SELL', 80, 'normal', t, { trendSide: 'BUY', turnConfirmed: false });
      expect(r.accept).toBe(false);
      mem = r.memory;
    }
    expect(stabilizeDirection(mem, 'SELL', 80, 'normal', 615_000, { trendSide: 'BUY', turnConfirmed: true }).accept).toBe(true);
  });

  it('holds the opposite of the last signal for 30 minutes in normal mode unless strong and confirmed', () => {
    let mem: Parameters<typeof stabilizeDirection>[0] = { side: 'SELL', tradedSide: 'SELL', tradedAt: 0 };
    for (let t = 60_000; t <= 300_000; t += 15_000) mem = stabilizeDirection(mem, 'BUY', 80, 'normal', t, { turnConfirmed: true }).memory;
    expect(stabilizeDirection(mem, 'BUY', 80, 'normal', 315_000, { turnConfirmed: true }).accept).toBe(false);
    expect(stabilizeDirection(mem, 'BUY', 88, 'normal', 315_000, { turnConfirmed: true }).accept).toBe(true);
  });
});
