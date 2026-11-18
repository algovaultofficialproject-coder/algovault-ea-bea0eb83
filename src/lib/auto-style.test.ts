import { describe, expect, it } from 'vitest';
import { pickTradeStyle, resolveTradeStyle } from './auto-style';
import type { SwingRead } from './smart-signal-policy';

const base = { ok: true, price: 100, atr15: 1, atr5: 0.55 } as unknown as SwingRead;
const trend = { ...base, adx15: 30, adx60: 25, ema20_15: 99.5, ema50_15: 99, ema20_60: 98.5, ema50_60: 98, ema20_240: 97, ema50_240: 96, bbUp15: 102, bbLo15: 97 } as SwingRead;

describe('Auto trade style', () => {
  it('picks swing in a strong trend that 15m, 1h and 4h agree on', () => {
    expect(pickTradeStyle(trend).style).toBe('swing');
  });
  it('picks normal when the 4h disagrees with the 15m trend', () => {
    expect(pickTradeStyle({ ...trend, ema20_240: 101, ema50_240: 102 } as SwingRead).style).toBe('normal');
  });
  it('picks normal when the trend is stretched 3+ ATR from the 15m EMA50', () => {
    expect(pickTradeStyle({ ...trend, ema50_15: 96.5, ema20_15: 98 } as SwingRead).style).toBe('normal');
  });
  it('picks scalp in a ranging market (ADX under 18)', () => {
    expect(pickTradeStyle({ ...trend, adx15: 15 } as SwingRead).style).toBe('scalp');
  });
  it('picks scalp in extreme volatility (5m ATR at least 2x its 15m baseline)', () => {
    expect(pickTradeStyle({ ...trend, atr5: 1.2 } as SwingRead).style).toBe('scalp');
  });
  it('picks scalp in a thin session', () => {
    const session = { at: '', name: 'Sydney', active: [], quality: 'low' as const, reason: '' };
    expect(pickTradeStyle({ ...trend, adx15: 23 } as SwingRead, session).style).toBe('scalp');
  });
  it('keeps a style fixed in settings', () => {
    expect(resolveTradeStyle('swing', { ...trend, adx15: 10 } as SwingRead).style).toBe('swing');
  });
});
