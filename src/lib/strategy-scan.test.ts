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

describe('additional observed market strategies', () => {
  it('detects a reclaimed low without treating a continued breakdown as a sweep', () => {
    const read = { ...base, open5: 99.95, high5: 100.1, low5: 99.4, prevOpen5: 100, prevHigh5: 100.2, prevLow5: 99.8, prevClose5: 99.9 };
    expect(hit(read, 'liquiditySweep', 1)).toBe(true);
    expect(hit({ ...read, price: 99.45 }, 'liquiditySweep', 1)).toBe(false);
  });
  it('detects a rejected high without treating a continued breakout as a sweep', () => {
    const read = { ...base, open5: 100.05, high5: 100.6, low5: 99.9, prevOpen5: 100, prevHigh5: 100.2, prevLow5: 99.8, prevClose5: 100.1 };
    expect(hit(read, 'liquiditySweep', -1)).toBe(true);
    expect(hit({ ...read, price: 100.55 }, 'liquiditySweep', -1)).toBe(false);
  });
  it('requires the prior candle to break a level before claiming a retest', () => {
    const read = { ...base, price: 100.3, pivR1: 100, open5: 100.1, high5: 100.35, low5: 99.95, prevOpen5: 99.8, prevHigh5: 100.3, prevLow5: 99.7, prevClose5: 100.2 };
    expect(hit(read, 'retestHold', 1)).toBe(true);
    expect(hit({ ...read, prevOpen5: 100.1 }, 'retestHold', 1)).toBe(false);
  });
  it('requires a weaker RSI and a bearish close before calling a divergence at a new high', () => {
    const read = { ...base, rsi15: 65, rsiPrev15: 72, open15: 100.1, high15: 100.6, low15: 99.8, prevOpen15: 99.9, prevHigh15: 100.3, prevLow15: 99.7, prevClose15: 100.1 };
    expect(hit(read, 'divergence', -1)).toBe(true);
    expect(hit({ ...read, rsiPrev15: undefined }, 'divergence', -1)).toBe(false);
  });
  it('counts the same strategy seen on several charts only once per direction', () => {
    const read = { ...base, price: 100.4, open5: 99.9, high5: 100.42, low5: 99.88, donHi5: 100.42, donLo5: 99, open15: 99.6, high15: 100.42, low15: 99.55, donHi15: 100.42, donLo15: 98 };
    const found = scanStrategies(read).hits.filter(h => h.name === 'donchianBreakout' && h.dir === 1);
    expect(found).toHaveLength(1);
  });
  it('skips malformed candles instead of silently expanding their high or low', () => {
    const read = { ...base, open5: 101, high5: 100.1, low5: 99.9, prevOpen5: 100, prevHigh5: 100.2, prevLow5: 99.8, prevClose5: 99.9 };
    expect(hit(read, 'priceAction', -1)).toBe(false);
    expect(hit(read, 'liquiditySweep', 1)).toBe(false);
  });
  it('places a BUY target before nearby resistance in every style', () => {
    for (const style of ['normal', 'scalp', 'swing'] as const) {
      const result = analyzeBuiltinAuto({ ...base, pivR1: 101.8 }, undefined, style);
      expect(result.side).toBe('BUY');
      expect(result.takeProfit).toBeGreaterThan(100);
      expect(result.takeProfit).toBeLessThan(101.8);
    }
  });
  it('places a SELL target before nearby support', () => {
    const result = analyzeBuiltinAuto({ ...base, rating1: -0.4, rating5: -0.4, rating15: -0.4, rsi15: 42, ema50_15: 101, macd15: -0.1, macdSig15: -0.05, mom1: -0.05, pivS1: 98.2 });
    expect(result.side).toBe('SELL');
    expect(result.takeProfit).toBeLessThan(100);
    expect(result.takeProfit).toBeGreaterThan(98.2);
  });
  // User choice: tight room still trades, with a compact protected target (1.2x the stop) and lower confidence.
  it('trades a compact protected target when resistance sits a fraction of volatility away', () => {
    for (const style of ['normal', 'scalp', 'swing'] as const) {
      const open = analyzeBuiltinAuto(base, undefined, style);
      const result = analyzeBuiltinAuto({ ...base, pivR1: 100.2 }, undefined, style);
      expect(result.side).toBe('BUY');
      expect(result.reason).toMatch(/tight room — compact target/);
      expect((result.takeProfit - result.entry) / (result.entry - result.stopLoss)).toBeCloseTo(1.2, 5);
      expect(result.confidence).toBeLessThan(open.confidence);
    }
  });
  it('trades a compact protected target when support sits a fraction of volatility away', () => {
    const result = analyzeBuiltinAuto({ ...base, rating1: -0.4, rating5: -0.4, rating15: -0.4, rsi15: 42, ema50_15: 101, macd15: -0.1, macdSig15: -0.05, mom1: -0.05, pivS1: 99.7 });
    expect(result.side).toBe('SELL');
    expect(result.reason).toMatch(/tight room — compact target/);
    expect((result.entry - result.takeProfit) / (result.stopLoss - result.entry)).toBeCloseTo(1.2, 5);
  });
  it('never returns a BUY or SELL with reward smaller than risk', () => {
    for (const lvl of [100.3, 100.6, 100.9, 101.2, 101.5, 102, 103]) {
      for (const style of ['normal', 'scalp', 'swing'] as const) {
        const r = analyzeBuiltinAuto({ ...base, pivR1: lvl }, undefined, style);
        if (r.side === 'WAIT') continue;
        const sign = r.side === 'BUY' ? 1 : -1;
        expect(((r.takeProfit - r.entry) * sign) / ((r.entry - r.stopLoss) * sign)).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('does not call higher highs and lows bullish structure when the close falls', () => {
    const read = { ...base, open15: 100.2, high15: 100.6, low15: 99.8, prevOpen15: 99.9, prevHigh15: 100.4, prevLow15: 99.7, prevClose15: 100.3 };
    expect(hit(read, 'structure', 1)).toBe(false);
  });
  it('does not interpret a wick rejection at the channel edge as a bullish breakout', () => {
    const read = { ...base, open15: 100.05, high15: 100.5, low15: 99.95, donHi15: 100.5, donLo15: 98 };
    expect(hit(read, 'breakout', 1)).toBe(false);
  });
});

describe('upgraded scanner strategies', () => {
  it('detects a volatility squeeze firing upward only with momentum agreement', () => {
    const read = { ...base, price: 100.9, bbUp15: 101.2, bbLo15: 99, kcUp15: 100.8, kcLo15: 99.2, open15: 100.1, high15: 100.95, low15: 100.05, ao15: 0.2 };
    expect(hit(read, 'squeezeFire', 1)).toBe(true);
    expect(hit({ ...read, ao15: -0.2 }, 'squeezeFire', 1)).toBe(false);
  });
  it('flags a coiling squeeze when Bollinger bands sit inside Keltner channels', () => {
    expect(scanStrategies({ ...base, bbUp15: 100.5, bbLo15: 99.5, kcUp15: 100.8, kcLo15: 99.2 }).squeeze).toBe(true);
    expect(scanStrategies({ ...base, bbUp15: 101, bbLo15: 99, kcUp15: 100.8, kcLo15: 99.2 }).squeeze).toBe(false);
  });
  it('reads Ichimoku direction from the cloud side and Tenkan/Kijun order', () => {
    expect(hit({ ...base, ichTenkan15: 99.8, ichKijun15: 99.5, ichSpanA15: 99.2, ichSpanB15: 99 }, 'ichimokuCloud', 1)).toBe(true);
    expect(hit({ ...base, ichTenkan15: 99.4, ichKijun15: 99.5, ichSpanA15: 99.2, ichSpanB15: 99 }, 'ichimokuCloud', 1)).toBe(false);
    expect(hit({ ...base, ichTenkan15: 100.2, ichKijun15: 100.5, ichSpanA15: 100.8, ichSpanB15: 101 }, 'ichimokuCloud', -1)).toBe(true);
  });
  it('detects fresh MACD and EMA crossovers, not ongoing alignment', () => {
    expect(hit({ ...base, macdPrev15: 0.01, macdSigPrev15: 0.02 }, 'macdCross', 1)).toBe(true);
    expect(hit({ ...base, macdPrev15: 0.08, macdSigPrev15: 0.02 }, 'macdCross', 1)).toBe(false);
    expect(hit({ ...base, ema20_15: 99.6, ema20Prev15: 98.9, ema50Prev15: 99 }, 'emaTrendCross', 1)).toBe(true);
  });
  it('does not treat the channel high the current candle is making as resistance ahead', () => {
    const read = { ...base, open15: 99.4, high15: 100.05, low15: 99.3, donHi15: 100.05, donLo15: 98 };
    expect(scanStrategies(read).resistances).not.toContain(100.05);
    expect(analyzeBuiltinAuto(read).side).toBe('BUY');
  });
  it('uses a compact target below a prior-day high just ahead of price', () => {
    const read = { ...base, open15: 99.4, high15: 100.05, low15: 99.3, donHi15: 100.05, donLo15: 98, pdHigh: 100.1 };
    expect(scanStrategies(read).resistances).toContain(100.1);
    const result = analyzeBuiltinAuto(read);
    expect(result.side).not.toBe('WAIT');
    expect(result.reason).toMatch(/tight room — compact target/);
  });
  it('treats low ADX without Aroon leadership as a choppy market', () => {
    expect(scanStrategies({ ...base, adx15: 12, aroonUp15: 40, aroonDn15: 30 }).choppy).toBe(true);
    expect(scanStrategies({ ...base, adx15: 12, aroonUp15: 90, aroonDn15: 10 }).choppy).toBe(false);
    expect(scanStrategies({ ...base, adx15: 28 }).choppy).toBe(false);
  });
  it('lowers confidence in a choppy market instead of blocking the core reading', () => {
    const clean = analyzeBuiltinAuto(base);
    const chop = analyzeBuiltinAuto({ ...base, adx15: 12, aroonUp15: 40, aroonDn15: 30 });
    expect(clean.side).toBe('BUY');
    expect(chop.side).not.toBe('SELL');
    if (chop.side === 'BUY') expect(chop.confidence).toBeLessThanOrEqual(clean.confidence);
  });
});
