import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwingRead } from './smart-signal-policy';

const mocks = vi.hoisted(() => ({ gateway: vi.fn() }));
vi.mock('@lovable.dev/ai-gateway', () => ({ generateChatCompletion: mocks.gateway }));
import { runSmartSignal } from './smart-signal.server';
import { analyzeBuiltinAuto } from './builtin-autotrader';
import { scanStrategies } from './strategy-scan';

const up: SwingRead = {
  price: 100, rating1: .4, rating5: .5, rating15: .5, rating60: .5, rating240: .5, ma15: .5,
  rsi1: 58, rsi5: 56, rsi15: 58, adx5: 25, adx15: 28, atr1: .08, atr5: .2, atr15: .5, atr60: 2, atr240: 4,
  ema20_1: 99.95, ema20_5: 99.8, ema50_5: 99.5, ema20_15: 99.6, ema50_15: 99, ema200_15: 97, ema200_60: 95,
  macd5: .05, macdSig5: .02, macd15: .1, macdSig15: .05, mom1: .05, diPlus15: 30, diMinus15: 14,
  rsi60: 55, rsi240: 55, adx60: 25, adx240: 25, ema50_60: 96, ema50_240: 94,
};
const mirror = (r: SwingRead): SwingRead => {
  const out: Record<string, number> = { ...r } as Record<string, number>;
  for (const k of Object.keys(out)) {
    if (/^(rating|ma15|macd|mom)/.test(k)) out[k] = -out[k];
    else if (/^rsi/.test(k)) out[k] = 100 - out[k];
    else if (/^ema/.test(k)) out[k] = 200 - out[k];
  }
  out.diPlus15 = r.diMinus15!; out.diMinus15 = r.diPlus15!;
  return out as unknown as SwingRead;
};
const open = { at: '2026-10-21T14:00:00Z', name: 'London / New York', active: ['London', 'New York'], quality: 'high' as const, reason: '' };

describe('built-in credit-free autotrader', () => {
  beforeEach(() => { mocks.gateway.mockReset().mockRejectedValue(new Error('Payment required')); });
  it('returns BUY in an uptrend without any paid AI request', async () => {
    const result = await runSmartSignal(up, true, open);
    expect(result.side).toBe('BUY');
    expect(result.ready).toBe(true);
    expect(mocks.gateway).not.toHaveBeenCalled();
  });
  it('returns SELL in the mirrored downtrend', async () => {
    expect((await runSmartSignal(mirror(up), true, open)).side).toBe('SELL');
  });
  it('places a quality stop and target: right side of price, reward at least 1.3x risk, within 15m volatility', () => {
    for (const r of [up, mirror(up)]) {
      const v = analyzeBuiltinAuto(r, open, 'normal');
      const sign = v.side === 'BUY' ? 1 : -1;
      const risk = (v.entry - v.stopLoss) * sign, reward = (v.takeProfit - v.entry) * sign;
      expect(risk).toBeGreaterThan(0);
      expect(reward / risk).toBeGreaterThanOrEqual(1.29);
      expect(risk).toBeLessThanOrEqual(0.5 * 1.9 + 1e-9);
      expect(reward).toBeLessThanOrEqual(0.5 * 2.4 + 1e-9);
    }
  });
  it('does not execute on a closed session', async () => {
    const result = await runSmartSignal(up, true, { ...open, active: [], quality: 'closed' });
    expect(result.ready).toBe(false);
  });
  it('waits when live data is missing', () => {
    expect(analyzeBuiltinAuto({ ...up, atr15: 0 }).side).toBe('WAIT');
  });
  it('still calls the manual AI scanner separately', async () => {
    mocks.gateway.mockResolvedValueOnce({ choices: [{ message: { content: '{}' } }] });
    await runSmartSignal(up, false, open).catch(() => null);
    expect(mocks.gateway).toHaveBeenCalledTimes(1);
  });
});

describe('strategy scanner', () => {
  it('detects trend following in a stacked uptrend', () => {
    expect(scanStrategies({ ...up, psar15: 99.2, vwap15: 99.5 }).hits.some(h => (h.name === 'psarTrend' || h.name === 'adxTrend') && h.dir === 1)).toBe(true);
  });
  it('detects a breakout above the 20-candle high on a strong close', () => {
    const r = { ...up, open15: 99.5, high15: 100.05, low15: 99.45, donHi15: 100.05, donLo15: 97 };
    expect(scanStrategies(r).hits.some(h => h.name === 'donchianBreakout' && h.dir === 1)).toBe(true);
  });
  it('detects a bounce off support with a rejection wick', () => {
    const r = { ...up, price: 99.5, pivS1: 99.3, open5: 99.45, high5: 99.52, low5: 99.28 };
    expect(scanStrategies(r).hits.some(h => h.name === 'support' && h.dir === 1)).toBe(true);
  });
  it('detects a rejection at resistance', () => {
    const r = { ...up, price: 100, pivR1: 100.2, open5: 100.05, high5: 100.22, low5: 99.98 };
    expect(scanStrategies(r).hits.some(h => h.name === 'resistance' && h.dir === -1)).toBe(true);
  });
  it('reads a bearish engulfing candle as a bearish engulfing', () => {
    const r = { ...up, price: 99.4, open15: 100.1, high15: 100.15, low15: 99.35, prevOpen15: 99.7, prevHigh15: 100.05, prevLow15: 99.65, prevClose15: 100, bearPat15: 1 };
    expect(scanStrategies(r).hits.some(h => h.name === 'engulfing' && h.dir === -1)).toBe(true);
  });
});
