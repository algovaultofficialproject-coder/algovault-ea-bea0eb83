import { describe, expect, it } from 'vitest';
import { autoEntryRejection, autoScanInterval, rankAutoTimeframes, recommendAutoTimeframe } from './autotrader-policy';
import type { SwingRead, SignalVerdict } from './smart-signal-policy';

const read: SwingRead = { price: 100, rating5: .5, rating15: .5, rating60: .5, rating240: .5, ma15: .5, rsi15: 55, adx15: 25, ema50_15: 98, ema200_60: 95, macd15: 1, macdSig15: .5, atr15: .5, atr60: 2, atr240: 4, rsi60: 55, rsi240: 55, adx60: 25, adx240: 25, ema50_60: 96, ema50_240: 94 };
const verdict: SignalVerdict = { side: 'BUY', confidence: 80, entry: 100, stopLoss: 99.25, takeProfit: 100.75, timeframe: '4h', timeframeReason: '', reason: '' };

describe('adaptive autotrader', () => {
  it('prefers the slowest scanned chart (15m) and never picks 1h or 4h', () => {
    expect(recommendAutoTimeframe(read)?.timeframe).toBe('15m');
    expect(recommendAutoTimeframe({ ...read, adx240: 60, rating240: 1, adx60: 60, rating60: 1 })?.timeframe).toBe('15m');
  });
  it('only ranks the 1m, 5m and 15m charts', () => {
    const all = { ...read, rating1: .5, rating5: .5, atr1: .1, atr5: .25, rsi1: 55, rsi5: 55, adx1: 25, adx5: 25, ema50_1: 99.8, ema50_5: 99 };
    expect(rankAutoTimeframes(all).map(c => c.timeframe).sort()).toEqual(['15m', '1m', '5m']);
  });
  it('always returns BUY or SELL bias for readable markets', () => {
    expect(recommendAutoTimeframe(read)?.side).toBe('BUY');
    expect(recommendAutoTimeframe({ ...read, rating60: -.5, rating240: -.5, rating15: -.5, ema50_240: 106, ema50_60: 104, ema50_15: 102, rsi15: 45, rsi60: 45, rsi240: 45 })?.side).toBe('SELL');
    expect(recommendAutoTimeframe({ ...read, rating60: 0, rating240: 0, rating15: 0 })?.side).toBe('BUY');
  });
  it('selects identically across forex, metals, indices and crypto price scales', () => {
    for (const scale of [.01, 25, 200, 1000]) {
      const scaled = { ...read, price: read.price * scale, atr15: .5 * scale, atr60: 2 * scale, atr240: 4 * scale, ema50_15: 98 * scale, ema50_60: 96 * scale, ema50_240: 94 * scale };
      expect(recommendAutoTimeframe(scaled)?.timeframe).toBe('15m');
      expect(recommendAutoTimeframe(scaled)?.side).toBe('BUY');
    }
  });
  it('rejects missing market readings rather than inventing a direction', () => {
    expect(recommendAutoTimeframe({ ...read, atr15: 0, atr60: 0, atr240: 0 })).toBeNull();
  });
  it('automatically approves valid AI signals without a confidence or ADX confirmation gate', () => {
    const weak = { ...read, adx240: 10 };
    expect(recommendAutoTimeframe(weak)?.side).toBe('BUY');
    expect(autoEntryRejection(weak, { ...verdict, confidence: 50 })).toBeNull();
    expect(autoEntryRejection(read, verdict)).toBeNull();
    expect(autoEntryRejection({ ...read, rating5: -.5 }, verdict)).toBeNull();
  });
  it('scans on the selected 15m, 1h or 4h cadence', () => {
    expect(autoScanInterval('15m')).toBe(900000);
    expect(autoScanInterval('1h')).toBe(3600000);
    expect(autoScanInterval('4h')).toBe(14400000);
  });
  it('uses price movement and RSI when a weak rating contradicts both', () => {
    const falling = { ...read, rating15: .1, rating60: .1, rating240: .1, ema50_15: 102, ema50_60: 104, ema50_240: 106, rsi15: 40, rsi60: 40, rsi240: 40 };
    expect(recommendAutoTimeframe(falling)?.side).toBe('SELL');
    expect(autoEntryRejection(falling, verdict)).not.toBeNull();
  });
  it('weighs selected RSI as part of movement rather than requiring separate agreement', () => {
    expect(autoEntryRejection({ ...read, rsi240: 45 }, verdict)).toBeNull();
  });
  it('does not require separate MACD confirmation after the AI signal', () => {
    expect(autoEntryRejection({ ...read, macd15: -.5 }, verdict)).toBeNull();
  });
  it('does not require long-term EMA agreement after the AI signal', () => {
    expect(autoEntryRejection({ ...read, ema200_60: 105 }, verdict)).toBeNull();
  });
  it('fails closed for missing selected timeframe direction', () => {
    expect(autoEntryRejection({ ...read, rating240: NaN }, verdict)).toContain('incomplete');
  });
  it('confirms SELL only with downward price, RSI and MACD agreement', () => {
    const falling = { ...read, rating5: -.5, rating15: -.5, rating60: -.5, rating240: -.5, ma15: -.5, ema50_15: 102, ema200_60: 105, ema50_240: 106, rsi240: 45, macd15: -.5, macdSig15: 0 };
    expect(autoEntryRejection(falling, { ...verdict, side: 'SELL', stopLoss: 100.75, takeProfit: 99.25 })).toBeNull();
  });
  it('rejects invalid stop geometry even when automatic trading is authorized', () => {
    expect(autoEntryRejection(read, { ...verdict, stopLoss: 106 })).toContain('invalid direction');
  });
  it('rejects stale entry prices', () => {
    expect(autoEntryRejection({ ...read, price: 102 }, verdict)).toContain('stale');
  });
  it('automatically approves a valid 5m AI signal without higher timeframe agreement', () => {
    const fast = { ...read, atr5: 1, rsi5: 55, adx5: 15, ema50_5: 99, rating60: -.5, rating240: -.5 };
    expect(autoEntryRejection(fast, { ...verdict, timeframe: '5m', stopLoss: 99.5, takeProfit: 100.5, confidence: 60 })).toBeNull();
  });
});
describe('15m-sized levels', () => {
  it('rejects a far target and a wide stop measured against 15m volatility', () => {
    expect(autoEntryRejection(read, { ...verdict, takeProfit: 112 })).toContain('Target');
    expect(autoEntryRejection(read, { ...verdict, stopLoss: 96 })).toContain('Stop');
  });
  it('rejects 1h and 4h sized levels even on a 4h signal', () => {
    expect(autoEntryRejection(read, { ...verdict, stopLoss: 92, takeProfit: 105 })).toContain('Stop');
    expect(autoEntryRejection(read, { ...verdict, stopLoss: 97, takeProfit: 103 })).toContain('Stop');
  });
});
